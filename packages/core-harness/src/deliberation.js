import { randomUUID } from "node:crypto";

import { invariant, requireText } from "./contracts.js";

export const DeliberationArtifactKind = "DELIBERATION";
export const ActionIntentArtifactKind = "ACTION_INTENT";

export const ActionIntentStatus = Object.freeze({
  PROPOSED: "PROPOSED",
  AUTHORIZED: "AUTHORIZED",
  EXECUTED: "EXECUTED",
  REJECTED: "REJECTED",
  FAILED: "FAILED"
});

export const ActionIntentAuthorizationDecision = Object.freeze({
  ALLOW: "ALLOW",
  DENY: "DENY"
});

export const ActionIntentTargetKind = Object.freeze({
  CAPABILITY: "CAPABILITY",
  RESOURCE: "RESOURCE",
  RESOURCE_DESCRIBE: "RESOURCE_DESCRIBE",
  LIVE_OBJECT: "LIVE_OBJECT",
  LIVE_OBJECT_READ: "LIVE_OBJECT_READ",
  EXECUTOR: "EXECUTOR",
  CUSTOM: "CUSTOM"
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeOptionalTurn(value) {
  if (value == null) return null;
  invariant(Number.isInteger(value) && value > 0, "deliberation turn must be a positive integer or null");
  return value;
}

function normalizeArtifactRef(ref, label) {
  invariant(ref && typeof ref === "object" && !Array.isArray(ref), `${label} must be an object`);
  const revision = ref.revision ?? null;
  invariant(
    revision == null || (Number.isInteger(revision) && revision > 0),
    `${label} revision must be a positive integer or null`
  );
  return Object.freeze({
    kind: requireText(ref.kind, `${label} kind`),
    id: requireText(ref.id, `${label} id`),
    ...(revision == null ? {} : { revision })
  });
}

function normalizeRefs(refs, label) {
  invariant(Array.isArray(refs), `${label} must be an array`);
  const seen = new Set();
  return Object.freeze(refs.map((ref) => {
    const normalized = normalizeArtifactRef(ref, `${label} ref`);
    const key = `${normalized.kind}:${normalized.id}:${normalized.revision ?? ""}`;
    invariant(!seen.has(key), `${label} contains duplicate ref: ${key}`);
    seen.add(key);
    return normalized;
  }));
}

function normalizeConstraints(value = []) {
  invariant(Array.isArray(value), "deliberation constraints must be an array");
  return Object.freeze(clone(value));
}

function normalizeActionTarget(action) {
  invariant(action && typeof action === "object" && !Array.isArray(action), "action intent action is required");
  const target = requireText(action.target, "action intent target");
  invariant(Object.values(ActionIntentTargetKind).includes(target), "action intent target is invalid");

  if (target === ActionIntentTargetKind.CAPABILITY) {
    return Object.freeze({
      target,
      name: requireText(action.name, "action intent capability name"),
      input: clone(action.input ?? null)
    });
  }
  if (target === ActionIntentTargetKind.RESOURCE) {
    invariant(action.ref && typeof action.ref === "object", "resource action intent requires ref");
    return Object.freeze({
      target,
      ref: clone(action.ref),
      operation: requireText(action.operation, "action intent resource operation"),
      input: clone(action.input ?? null)
    });
  }
  if (target === ActionIntentTargetKind.RESOURCE_DESCRIBE) {
    invariant(action.ref && typeof action.ref === "object", "resource describe action intent requires ref");
    return Object.freeze({ target, ref: clone(action.ref) });
  }
  if (target === ActionIntentTargetKind.LIVE_OBJECT) {
    invariant(action.ref && typeof action.ref === "object", "live-object action intent requires ref");
    invariant(Array.isArray(action.args ?? []), "live-object action intent args must be an array");
    return Object.freeze({
      target,
      ref: clone(action.ref),
      member: requireText(action.member, "action intent live-object member"),
      args: Object.freeze(clone(action.args ?? []))
    });
  }
  if (target === ActionIntentTargetKind.LIVE_OBJECT_READ) {
    invariant(action.ref && typeof action.ref === "object", "live-object read action intent requires ref");
    return Object.freeze({
      target,
      ref: clone(action.ref),
      member: requireText(action.member, "action intent live-object member")
    });
  }
  if (target === ActionIntentTargetKind.EXECUTOR) {
    return Object.freeze({ target, request: clone(action.request ?? null) });
  }

  return Object.freeze({
    target,
    name: requireText(action.name, "custom action intent name"),
    payload: clone(action.payload ?? null)
  });
}

export function defineDeliberationPolicy({
  maxSourceRefs = 16,
  maxContextRefs = 16,
  maxOutcomeRefs = 16,
  maxSerializedChars = 16_384
} = {}) {
  for (const [label, value] of [
    ["maxSourceRefs", maxSourceRefs],
    ["maxContextRefs", maxContextRefs],
    ["maxOutcomeRefs", maxOutcomeRefs],
    ["maxSerializedChars", maxSerializedChars]
  ]) {
    invariant(Number.isInteger(value) && value > 0, `deliberation ${label} must be a positive integer`);
  }
  return Object.freeze({ maxSourceRefs, maxContextRefs, maxOutcomeRefs, maxSerializedChars });
}

export function defineActionIntentPolicy({
  name = "kernel-default-allow",
  revision = "1",
  authorize = async () => ({
    decision: ActionIntentAuthorizationDecision.ALLOW,
    reason: "no stricter action-intent policy configured"
  })
} = {}) {
  invariant(typeof authorize === "function", "action intent policy requires authorize()");
  return Object.freeze({
    name: requireText(name, "action intent policy name"),
    revision: requireText(revision, "action intent policy revision"),
    authorize
  });
}

export function defineActionIntentAuthorization(value, policy) {
  invariant(value && typeof value === "object", "action intent authorization is required");
  invariant(
    Object.values(ActionIntentAuthorizationDecision).includes(value.decision),
    "action intent authorization decision is invalid"
  );
  return Object.freeze({
    decision: value.decision,
    reason: requireText(value.reason, "action intent authorization reason"),
    evidenceRefs: normalizeRefs(value.evidenceRefs ?? [], "action intent authorization evidenceRefs"),
    policy: Object.freeze({
      name: requireText(policy.name, "action intent policy name"),
      revision: requireText(policy.revision, "action intent policy revision")
    })
  });
}

function normalizeSeedDeliberation(record) {
  invariant(record && typeof record === "object", "deliberation record is required");
  const id = requireText(record.id, "deliberation id");
  const actionIntentRef = normalizeArtifactRef(record.actionIntentRef, "deliberation actionIntentRef");
  invariant(actionIntentRef.kind === ActionIntentArtifactKind, "deliberation actionIntentRef kind is invalid");
  return Object.freeze({
    id,
    artifactRef: Object.freeze({ kind: DeliberationArtifactKind, id }),
    at: requireText(record.at, "deliberation at"),
    callId: requireText(record.callId, "deliberation callId"),
    turn: normalizeOptionalTurn(record.turn),
    judgment: clone(record.judgment ?? null),
    sourceRefs: normalizeRefs(record.sourceRefs ?? [], "deliberation sourceRefs"),
    contextRefs: normalizeRefs(record.contextRefs ?? [], "deliberation contextRefs"),
    intent: requireText(record.intent, "deliberation intent"),
    expectedOutcome: requireText(record.expectedOutcome, "deliberation expectedOutcome"),
    successCondition: requireText(record.successCondition, "deliberation successCondition"),
    constraints: normalizeConstraints(record.constraints ?? []),
    actionIntentRef
  });
}

function normalizeSeedActionIntent(record) {
  invariant(record && typeof record === "object", "action intent record is required");
  const id = requireText(record.id, "action intent id");
  const deliberationRef = normalizeArtifactRef(record.deliberationRef, "action intent deliberationRef");
  invariant(deliberationRef.kind === DeliberationArtifactKind, "action intent deliberationRef kind is invalid");
  invariant(Object.values(ActionIntentStatus).includes(record.status), "action intent status is invalid");
  invariant(Number.isInteger(record.revision) && record.revision > 0, "action intent revision must be positive");
  return Object.freeze({
    id,
    artifactRef: Object.freeze({ kind: ActionIntentArtifactKind, id }),
    at: requireText(record.at, "action intent at"),
    updatedAt: requireText(record.updatedAt ?? record.at, "action intent updatedAt"),
    callId: requireText(record.callId, "action intent callId"),
    turn: normalizeOptionalTurn(record.turn),
    judgment: clone(record.judgment ?? null),
    deliberationRef,
    sourceRefs: normalizeRefs(record.sourceRefs ?? [], "action intent sourceRefs"),
    action: normalizeActionTarget(record.action),
    expectedOutcome: requireText(record.expectedOutcome, "action intent expectedOutcome"),
    successCondition: requireText(record.successCondition, "action intent successCondition"),
    status: record.status,
    authorization: record.authorization == null ? null : clone(record.authorization),
    outcomeRefs: normalizeRefs(record.outcomeRefs ?? [], "action intent outcomeRefs"),
    error: clone(record.error ?? null),
    revision: record.revision
  });
}

function errorView(error) {
  return Object.freeze({
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  });
}

export function createDeliberationStore({
  deliberations = [],
  actionIntents = [],
  policy = {},
  clock = () => new Date().toISOString(),
  idFactory = () => randomUUID()
} = {}) {
  invariant(Array.isArray(deliberations), "deliberation seed records must be an array");
  invariant(Array.isArray(actionIntents), "action intent seed records must be an array");
  invariant(typeof clock === "function", "deliberation store clock must be a function");
  invariant(typeof idFactory === "function", "deliberation store idFactory must be a function");
  const bounds = defineDeliberationPolicy(policy);
  const deliberationRecords = deliberations.map((item) => clone(normalizeSeedDeliberation(item)));
  const intentRecords = actionIntents.map((item) => clone(normalizeSeedActionIntent(item)));

  function requireIntent(id) {
    const resolvedId = requireText(id, "action intent id");
    const index = intentRecords.findIndex((item) => item.id === resolvedId);
    invariant(index >= 0, `action intent not found: ${resolvedId}`);
    return { index, record: intentRecords[index] };
  }

  function replaceIntent(index, current, patch) {
    const at = requireText(clock(), "deliberation store clock value");
    const next = normalizeSeedActionIntent({
      ...clone(current),
      ...clone(patch),
      updatedAt: at,
      revision: current.revision + 1
    });
    intentRecords[index] = clone(next);
    return clone(next);
  }

  function assertBounded(value) {
    const serializedChars = JSON.stringify(value).length;
    invariant(
      serializedChars <= bounds.maxSerializedChars,
      `deliberation step exceeds serialized bound: ${serializedChars} > ${bounds.maxSerializedChars}`
    );
  }

  return Object.freeze({
    policy: bounds,

    createStep({
      callId,
      turn = null,
      judgment = null,
      sourceRefs = [],
      contextRefs = [],
      intent,
      action,
      expectedOutcome,
      successCondition,
      constraints = []
    } = {}) {
      const normalizedSources = normalizeRefs(sourceRefs, "deliberation sourceRefs");
      const normalizedContext = normalizeRefs(contextRefs, "deliberation contextRefs");
      invariant(normalizedSources.length <= bounds.maxSourceRefs, "deliberation source ref limit exceeded");
      invariant(normalizedContext.length <= bounds.maxContextRefs, "deliberation context ref limit exceeded");
      const resolvedCallId = requireText(callId, "deliberation callId");
      const resolvedTurn = normalizeOptionalTurn(turn);
      const resolvedIntent = requireText(intent, "deliberation intent");
      const resolvedExpectedOutcome = requireText(expectedOutcome, "deliberation expectedOutcome");
      const resolvedSuccessCondition = requireText(successCondition, "deliberation successCondition");
      const resolvedAction = normalizeActionTarget(action);
      const at = requireText(clock(), "deliberation store clock value");
      const deliberationId = requireText(idFactory(), "deliberation id");
      const actionIntentId = requireText(idFactory(), "action intent id");

      const deliberation = normalizeSeedDeliberation({
        id: deliberationId,
        at,
        callId: resolvedCallId,
        turn: resolvedTurn,
        judgment,
        sourceRefs: normalizedSources,
        contextRefs: normalizedContext,
        intent: resolvedIntent,
        expectedOutcome: resolvedExpectedOutcome,
        successCondition: resolvedSuccessCondition,
        constraints,
        actionIntentRef: { kind: ActionIntentArtifactKind, id: actionIntentId }
      });
      const actionIntent = normalizeSeedActionIntent({
        id: actionIntentId,
        at,
        updatedAt: at,
        callId: resolvedCallId,
        turn: resolvedTurn,
        judgment,
        deliberationRef: { kind: DeliberationArtifactKind, id: deliberationId },
        sourceRefs: normalizedSources,
        action: resolvedAction,
        expectedOutcome: resolvedExpectedOutcome,
        successCondition: resolvedSuccessCondition,
        status: ActionIntentStatus.PROPOSED,
        authorization: null,
        outcomeRefs: [],
        error: null,
        revision: 1
      });
      assertBounded({ deliberation, actionIntent });
      deliberationRecords.push(clone(deliberation));
      intentRecords.push(clone(actionIntent));
      return Object.freeze({
        deliberation: clone(deliberation),
        actionIntent: clone(actionIntent)
      });
    },

    authorize(actionIntentId, authorization) {
      const { index, record } = requireIntent(actionIntentId);
      invariant(record.status === ActionIntentStatus.PROPOSED, "only proposed action intent may be authorized");
      const status = authorization.decision === ActionIntentAuthorizationDecision.ALLOW
        ? ActionIntentStatus.AUTHORIZED
        : ActionIntentStatus.REJECTED;
      return replaceIntent(index, record, { status, authorization });
    },

    complete(actionIntentId, { outcomeRefs = [], error = null } = {}) {
      const { index, record } = requireIntent(actionIntentId);
      invariant(record.status === ActionIntentStatus.AUTHORIZED, "only authorized action intent may complete");
      const normalizedOutcomeRefs = normalizeRefs(outcomeRefs, "action intent outcomeRefs");
      invariant(normalizedOutcomeRefs.length <= bounds.maxOutcomeRefs, "action intent outcome ref limit exceeded");
      return replaceIntent(index, record, {
        status: error == null ? ActionIntentStatus.EXECUTED : ActionIntentStatus.FAILED,
        outcomeRefs: normalizedOutcomeRefs,
        error: error == null ? null : errorView(error)
      });
    },

    linkOutcome(actionIntentId, ref) {
      const { index, record } = requireIntent(actionIntentId);
      invariant(
        [ActionIntentStatus.AUTHORIZED, ActionIntentStatus.EXECUTED, ActionIntentStatus.FAILED].includes(record.status),
        "action intent outcome can only be linked after authorization"
      );
      const normalized = normalizeArtifactRef(ref, "action intent outcome ref");
      const nextRefs = [...record.outcomeRefs];
      const key = `${normalized.kind}:${normalized.id}:${normalized.revision ?? ""}`;
      if (!nextRefs.some((item) => `${item.kind}:${item.id}:${item.revision ?? ""}` === key)) nextRefs.push(normalized);
      invariant(nextRefs.length <= bounds.maxOutcomeRefs, "action intent outcome ref limit exceeded");
      return replaceIntent(index, record, { outcomeRefs: nextRefs });
    },

    getDeliberation(id) {
      const resolvedId = requireText(id, "deliberation id");
      const record = deliberationRecords.find((item) => item.id === resolvedId) ?? null;
      return record == null ? null : clone(record);
    },

    getActionIntent(id) {
      const resolvedId = requireText(id, "action intent id");
      const record = intentRecords.find((item) => item.id === resolvedId) ?? null;
      return record == null ? null : clone(record);
    },

    deliberations() {
      return Object.freeze(clone(deliberationRecords));
    },

    actionIntents() {
      return Object.freeze(clone(intentRecords));
    }
  });
}
