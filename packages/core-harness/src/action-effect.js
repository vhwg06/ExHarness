import { invariant, requireText } from "./contracts.js";
import { ActionIntentStatus, ActionIntentTargetKind } from "./deliberation.js";
import {
  EffectOperationStatus,
  EffectRecoveryAction,
  EffectRecoveryRequiredError,
  reconcileEffectOperation
} from "./effect-reconciliation.js";

export const EffectOperationArtifactKind = "EFFECT_OPERATION";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function intentId(ref) {
  if (typeof ref === "string") return requireText(ref, "action intent id");
  invariant(ref && typeof ref === "object", "action intent ref is required");
  return requireText(ref.id, "action intent id");
}

function operationId(value) {
  if (typeof value === "string") return requireText(value, "effect operation id");
  invariant(value && typeof value === "object", "effect operation is required");
  return requireText(value.operationId, "effect operation id");
}

function refKey(ref) {
  return `${ref.kind}:${ref.id}:${ref.revision ?? ""}`;
}

function mergeRefs(...groups) {
  const output = [];
  const seen = new Set();
  for (const group of groups) {
    invariant(Array.isArray(group), "action effect outcome refs must be arrays");
    for (const ref of group) {
      invariant(ref && typeof ref === "object", "action effect outcome ref must be an object");
      const key = refKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(clone(ref));
    }
  }
  return output;
}

function requireEffectCapability(capability) {
  invariant(capability && typeof capability === "object", "action effect execution requires capability");
  requireText(capability.name, "effect capability name");
  invariant(typeof capability.execute === "function", `effect capability ${capability.name} requires execute()`);
  invariant(capability.effect && typeof capability.effect === "object", `capability ${capability.name} requires effect semantics`);
  invariant(typeof capability.effect.operationKey === "function", `capability ${capability.name} requires effect.operationKey()`);
  return capability;
}

function requireCapabilityIntent(actionIntent, capability) {
  invariant(
    actionIntent.action.target === ActionIntentTargetKind.CAPABILITY,
    "action effect execution requires a CAPABILITY action intent"
  );
  invariant(
    actionIntent.action.name === capability.name,
    `action intent capability ${actionIntent.action.name} does not match effect capability ${capability.name}`
  );
}

function effectRuntime(actionIntent, runtime) {
  invariant(runtime && typeof runtime === "object", "action effect runtime must be an object");
  return Object.freeze({
    ...clone(runtime),
    callId: runtime.callId ?? actionIntent.callId,
    turn: runtime.turn ?? (actionIntent.turn == null ? null : { number: actionIntent.turn }),
    actionIntentRef: clone(actionIntent.artifactRef),
    deliberationRef: clone(actionIntent.deliberationRef)
  });
}

function recoveryPending(operation) {
  return operation != null && [
    EffectOperationStatus.INTENDED,
    EffectOperationStatus.DISPATCHED,
    EffectOperationStatus.UNKNOWN
  ].includes(operation.status);
}

export function effectOperationRef(value) {
  return Object.freeze({
    kind: EffectOperationArtifactKind,
    id: operationId(value)
  });
}

export function createActionIntentEffectController({
  deliberation,
  journal
} = {}) {
  invariant(deliberation && typeof deliberation.authorize === "function", "action effect controller requires deliberation.authorize()");
  invariant(typeof deliberation.complete === "function", "action effect controller requires deliberation.complete()");
  invariant(typeof deliberation.linkOutcome === "function", "action effect controller requires deliberation.linkOutcome()");
  invariant(typeof deliberation.getActionIntent === "function", "action effect controller requires deliberation.getActionIntent()");
  invariant(journal && typeof journal.get === "function", "action effect controller requires journal.get()");

  function linkOperation(id, value) {
    return deliberation.linkOutcome(id, effectOperationRef(value));
  }

  async function resolveOperationId(capability, input, runtime) {
    return requireText(
      await capability.effect.operationKey({ input: clone(input), runtime: clone(runtime) }),
      `capability ${capability.name} effect operation id`
    );
  }

  return Object.freeze({
    async execute(ref, capability, {
      runtime = {},
      context = null,
      outcomeRefs = []
    } = {}) {
      const resolvedCapability = requireEffectCapability(capability);
      const id = intentId(ref);
      const before = deliberation.getActionIntent(id);
      invariant(before, `action intent not found: ${id}`);
      invariant(
        [ActionIntentStatus.PROPOSED, ActionIntentStatus.AUTHORIZED].includes(before.status),
        "only proposed or authorized action intent may execute an effect"
      );

      const authorized = await deliberation.authorize(id, { context });
      requireCapabilityIntent(authorized, resolvedCapability);
      const input = clone(authorized.action.input);
      const resolvedRuntime = effectRuntime(authorized, runtime);

      let resolvedOperationId;
      try {
        resolvedOperationId = await resolveOperationId(resolvedCapability, input, resolvedRuntime);
      } catch (error) {
        deliberation.complete(id, { outcomeRefs, error });
        throw error;
      }

      try {
        const result = await resolvedCapability.execute(input, resolvedRuntime);
        const operation = await journal.get(resolvedOperationId);
        invariant(operation, `effect operation not found after execution: ${resolvedOperationId}`);
        invariant(
          operation.status === EffectOperationStatus.CONFIRMED,
          `effect operation did not confirm after execution: ${resolvedOperationId}`
        );
        const linked = linkOperation(id, operation);
        const completed = deliberation.complete(id, {
          outcomeRefs: mergeRefs(linked.outcomeRefs, outcomeRefs)
        });
        return Object.freeze({
          result: clone(result),
          effectOperation: clone(operation),
          actionIntent: clone(completed)
        });
      } catch (error) {
        const operation = await journal.get(resolvedOperationId);
        if (recoveryPending(operation)) {
          linkOperation(id, operation);
          if (error instanceof EffectRecoveryRequiredError) throw error;
          throw new EffectRecoveryRequiredError({
            operationId: resolvedOperationId,
            capability: resolvedCapability.name,
            status: operation.status
          });
        }

        const current = deliberation.getActionIntent(id);
        if (current?.status === ActionIntentStatus.AUTHORIZED) {
          deliberation.complete(id, { outcomeRefs: mergeRefs(current.outcomeRefs, outcomeRefs), error });
        }
        throw error;
      }
    },

    async reconcile(ref, capability, value) {
      const resolvedCapability = requireEffectCapability(capability);
      const id = intentId(ref);
      const current = deliberation.getActionIntent(id);
      invariant(current, `action intent not found: ${id}`);
      invariant(
        [ActionIntentStatus.AUTHORIZED, ActionIntentStatus.EXECUTED].includes(current.status),
        "effect reconciliation requires an authorized or executed action intent"
      );
      requireCapabilityIntent(current, resolvedCapability);

      const resolvedOperationId = operationId(value);
      const refToOperation = effectOperationRef(resolvedOperationId);
      invariant(
        current.outcomeRefs.some((ref) => refKey(ref) === refKey(refToOperation)),
        `effect operation ${resolvedOperationId} is not linked to action intent ${id}`
      );

      const recovery = await reconcileEffectOperation({
        capability: resolvedCapability,
        journal,
        operationId: resolvedOperationId
      });

      let actionIntent = deliberation.getActionIntent(id);
      if (
        recovery.action === EffectRecoveryAction.CONTINUE &&
        recovery.operation.status === EffectOperationStatus.CONFIRMED &&
        actionIntent.status === ActionIntentStatus.AUTHORIZED
      ) {
        actionIntent = deliberation.complete(id, { outcomeRefs: actionIntent.outcomeRefs });
      }

      return Object.freeze({
        ...recovery,
        operation: clone(recovery.operation),
        actionIntent: clone(actionIntent)
      });
    }
  });
}
