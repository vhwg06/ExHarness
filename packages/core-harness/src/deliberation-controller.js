import { invariant } from "./contracts.js";
import {
  ActionIntentAuthorizationDecision,
  ActionIntentStatus,
  createDeliberationStore,
  defineActionIntentAuthorization,
  defineActionIntentPolicy
} from "./deliberation.js";
import { ActionIntentBoundaryError } from "./errors.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function intentId(ref) {
  if (typeof ref === "string") return ref;
  invariant(ref && typeof ref === "object", "action intent ref is required");
  return ref.id;
}

export function createDeliberationController({
  store = createDeliberationStore(),
  actionIntentPolicy = {}
} = {}) {
  invariant(store && typeof store.createStep === "function", "deliberation controller requires store.createStep()");
  invariant(typeof store.getActionIntent === "function", "deliberation controller requires store.getActionIntent()");
  invariant(typeof store.getDeliberation === "function", "deliberation controller requires store.getDeliberation()");
  invariant(typeof store.authorize === "function", "deliberation controller requires store.authorize()");
  invariant(typeof store.complete === "function", "deliberation controller requires store.complete()");
  invariant(typeof store.linkOutcome === "function", "deliberation controller requires store.linkOutcome()");
  const policy = defineActionIntentPolicy(actionIntentPolicy);

  async function authorize(ref, { context = null } = {}) {
    const id = intentId(ref);
    const current = store.getActionIntent(id);
    invariant(current, `action intent not found: ${id}`);
    if (current.status === ActionIntentStatus.AUTHORIZED) return current;
    if (current.status === ActionIntentStatus.REJECTED) {
      throw new ActionIntentBoundaryError("action intent was already rejected", { actionIntentId: id });
    }
    invariant(current.status === ActionIntentStatus.PROPOSED, "action intent cannot be authorized from its current state");
    const deliberation = store.getDeliberation(current.deliberationRef.id);
    invariant(deliberation, `deliberation not found for action intent: ${id}`);
    const raw = await policy.authorize(Object.freeze({
      deliberation: clone(deliberation),
      actionIntent: clone(current),
      context: clone(context)
    }));
    const authorization = defineActionIntentAuthorization(raw, policy);
    const updated = store.authorize(id, authorization);
    if (authorization.decision === ActionIntentAuthorizationDecision.DENY) {
      throw new ActionIntentBoundaryError(authorization.reason, {
        actionIntentId: id,
        deliberationId: deliberation.id,
        policy: authorization.policy,
        evidenceRefs: authorization.evidenceRefs
      });
    }
    return updated;
  }

  return Object.freeze({
    policy: Object.freeze({ name: policy.name, revision: policy.revision }),

    deliberate(input) {
      return store.createStep(input);
    },

    authorize,

    async execute(ref, operation, { context = null, outcomeRefs = [] } = {}) {
      invariant(typeof operation === "function", "action intent execution requires operation()");
      const id = intentId(ref);
      const authorized = await authorize(id, { context });
      try {
        const result = await operation(clone(authorized));
        const refs = [...outcomeRefs];
        if (result?.artifactRef != null) refs.push(result.artifactRef);
        const completed = store.complete(id, { outcomeRefs: refs });
        return Object.freeze({ result, actionIntent: completed });
      } catch (error) {
        const current = store.getActionIntent(id);
        if (current?.status === ActionIntentStatus.AUTHORIZED) {
          store.complete(id, { outcomeRefs, error });
        }
        throw error;
      }
    },

    complete(ref, options = {}) {
      return store.complete(intentId(ref), options);
    },

    linkOutcome(ref, outcomeRef) {
      return store.linkOutcome(intentId(ref), outcomeRef);
    },

    getDeliberation(id) {
      return store.getDeliberation(id);
    },

    getActionIntent(id) {
      return store.getActionIntent(id);
    },

    deliberations() {
      return store.deliberations();
    },

    actionIntents() {
      return store.actionIntents();
    }
  });
}
