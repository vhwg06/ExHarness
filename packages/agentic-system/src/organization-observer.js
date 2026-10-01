import { createCausalReconstruction, defineCausalObservationSubject } from "./causal-reconstruction.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}
function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value.trim();
}
const freeze = (value) => Object.freeze(structuredClone(value));

function rejectExtraKeys(args, allowed, method) {
  for (const key of Object.keys(args ?? {})) {
    invariant(allowed.includes(key), `${method} accepts no caller-selected completeness refs; ${key} is not accepted`);
  }
}

const QUERY_SURFACE = Object.freeze([
  "queryCurrent",
  "queryHistorical",
  "explainWhyNotDone",
  "listRemainingWork",
  "traceObligation",
  "describeExecution",
  "measureTiming",
  "chainEvidence",
]);

// Query-only organization observer. The surface is exactly QUERY_SURFACE:
// no claim/release, dispatch, recovery, acceptance, publication or
// strategy/policy-selection method exists here. All facts come from durable
// canonical refs through the reconstruction service; uncertainty is reported
// as MISSING_PROVENANCE/UNKNOWN, never inferred and never routed into
// acceptance findings or remediation commands.
export function createOrganizationObserver(deps = {}) {
  const reconstruction = createCausalReconstruction(deps);

  async function queryCurrent(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["productId", "rootIntentRef"], "queryCurrent");
    const productId = requireText(input.productId, "productId");
    const rootIntentRef = requireText(input.rootIntentRef, "rootIntentRef");
    const pinned = await reconstruction.resolveCurrentSubject({ productId, rootIntentRef });
    const [blockers, remainingWork, evidence] = await Promise.all([
      reconstruction.explainBlockers({ subject: pinned.subject }),
      reconstruction.listRemainingWork({ subject: pinned.subject }),
      reconstruction.chainEvidence({ subject: pinned.subject }),
    ]);
    return freeze({
      mode: "CURRENT",
      subjectRef: pinned.subjectRef,
      subject: pinned.subject,
      readiness: blockers.readiness,
      blockers: blockers.blockers,
      remainingWork,
      evidence,
      evidenceRefs: blockers.evidenceRefs,
    });
  }

  async function queryHistorical(args) {
    const input = args ?? {};
    rejectExtraKeys(input, ["subject"], "queryHistorical");
    // Pinned verbatim: the subject's own refs are the only heads consulted.
    // Newer canonical heads require a new subject and are never mixed in.
    const subject = defineCausalObservationSubject(input.subject);
    const pinned = await reconstruction.reconstructPinned({ subject });
    const [blockers, remainingWork, evidence] = await Promise.all([
      reconstruction.explainBlockers({ subject: pinned.subject }),
      reconstruction.listRemainingWork({ subject: pinned.subject }),
      reconstruction.chainEvidence({ subject: pinned.subject }),
    ]);
    return freeze({
      mode: "HISTORICAL",
      subjectRef: null,
      subject: pinned.subject,
      readiness: blockers.readiness,
      blockers: blockers.blockers,
      remainingWork,
      evidence,
      evidenceRefs: blockers.evidenceRefs,
    });
  }

  return Object.freeze({
    queryCurrent,
    queryHistorical,
    explainWhyNotDone: (args) => reconstruction.explainBlockers(args),
    listRemainingWork: (args) => reconstruction.listRemainingWork(args),
    traceObligation: (args) => reconstruction.traceObligation(args),
    describeExecution: (args) => reconstruction.describeExecution(args),
    measureTiming: (args) => reconstruction.measureTiming(args),
    chainEvidence: (args) => reconstruction.chainEvidence(args),
  });
}

export const ORGANIZATION_OBSERVER_QUERY_SURFACE = QUERY_SURFACE;
