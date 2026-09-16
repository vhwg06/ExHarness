import { randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import { join } from "node:path";
import {
  canonicalize,
  digestValue
} from "../../core-harness/src/index.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function requireNonNegativeInteger(value, name) {
  invariant(Number.isInteger(value) && value >= 0, `${name} must be a non-negative integer`);
  return value;
}

function requirePositiveNumber(value, name) {
  invariant(Number.isFinite(value) && value > 0, `${name} must be a positive finite number`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function freezeClone(value) {
  return Object.freeze(clone(value));
}

function uniqueTextArray(value, name) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  return [...new Set((value ?? []).map((item, index) => requireText(item, `${name}[${index}]`)))];
}

export const WorkSelectionSignalSource = Object.freeze({
  OBSERVED: "OBSERVED",
  ESTIMATED: "ESTIMATED"
});

export const WorkSelectionReason = Object.freeze({
  MANDATORY_CORRECTNESS: "MANDATORY_CORRECTNESS",
  STARVATION_FENCE: "STARVATION_FENCE",
  BOUNDED_SCORE: "BOUNDED_SCORE",
  MISSING_MEASUREMENT: "MISSING_MEASUREMENT",
  MANDATORY_BUDGET_CONFLICT: "MANDATORY_BUDGET_CONFLICT",
  NO_AFFORDABLE_MEASURABLE_WORK: "NO_AFFORDABLE_MEASURABLE_WORK"
});

export const WorkContinuationAction = Object.freeze({
  CONTINUE: "CONTINUE",
  STOP: "STOP",
  ESCALATE: "ESCALATE"
});

export const WorkSelectionEvidenceState = Object.freeze({
  FRESH: "FRESH",
  STALE: "STALE",
  CONTRADICTORY: "CONTRADICTORY"
});

const DEFAULT_WEIGHTS = Object.freeze({
  userImpact: 5,
  defectSeverity: 4,
  dependencyUnblocks: 6,
  evidenceConfidence: 2,
  userPriority: Object.freeze({ P1: 5, P2: 2, P3: 0 }),
  cost: -1,
  age: 1
});

function normalizeWeight(value, name) {
  invariant(Number.isFinite(value), `${name} must be a finite number`);
  return value;
}

function normalizePriorityWeights(raw = DEFAULT_WEIGHTS.userPriority) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "policy.weights.userPriority must be an object");
  const entries = Object.entries(raw);
  invariant(entries.length > 0, "policy.weights.userPriority must not be empty");
  return Object.freeze(Object.fromEntries(entries.map(([key, value]) => [
    requireText(key, "policy.weights.userPriority key"),
    normalizeWeight(value, `policy.weights.userPriority.${key}`)
  ])));
}

export function defineBoundedWorkSelectionPolicy(raw = {}) {
  const weights = raw.weights ?? DEFAULT_WEIGHTS;
  invariant(weights && typeof weights === "object" && !Array.isArray(weights), "policy.weights must be an object");
  return freezeClone({
    name: requireText(raw.name ?? "bounded-project-selection", "policy.name"),
    revision: requireText(raw.revision ?? "1", "policy.revision"),
    configurationRef: requireText(raw.configurationRef, "policy.configurationRef"),
    selectionBudget: requirePositiveNumber(raw.selectionBudget ?? 5, "policy.selectionBudget"),
    maxDeferrals: requireNonNegativeInteger(raw.maxDeferrals ?? 3, "policy.maxDeferrals"),
    retryCeiling: requireNonNegativeInteger(raw.retryCeiling ?? 2, "policy.retryCeiling"),
    plateauWindow: requireNonNegativeInteger(raw.plateauWindow ?? 2, "policy.plateauWindow"),
    weights: {
      userImpact: normalizeWeight(weights.userImpact ?? DEFAULT_WEIGHTS.userImpact, "policy.weights.userImpact"),
      defectSeverity: normalizeWeight(weights.defectSeverity ?? DEFAULT_WEIGHTS.defectSeverity, "policy.weights.defectSeverity"),
      dependencyUnblocks: normalizeWeight(weights.dependencyUnblocks ?? DEFAULT_WEIGHTS.dependencyUnblocks, "policy.weights.dependencyUnblocks"),
      evidenceConfidence: normalizeWeight(weights.evidenceConfidence ?? DEFAULT_WEIGHTS.evidenceConfidence, "policy.weights.evidenceConfidence"),
      userPriority: normalizePriorityWeights(weights.userPriority ?? DEFAULT_WEIGHTS.userPriority),
      cost: normalizeWeight(weights.cost ?? DEFAULT_WEIGHTS.cost, "policy.weights.cost"),
      age: normalizeWeight(weights.age ?? DEFAULT_WEIGHTS.age, "policy.weights.age")
    }
  });
}

function normalizeSignal(raw, name) {
  if (raw == null) return null;
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `${name} must be a signal object`);
  invariant(Number.isFinite(raw.value), `${name}.value must be a finite number`);
  invariant(Object.values(WorkSelectionSignalSource).includes(raw.source), `${name}.source is invalid`);
  return Object.freeze({
    value: raw.value,
    source: raw.source,
    ...(raw.evidenceRef == null ? {} : { evidenceRef: requireText(raw.evidenceRef, `${name}.evidenceRef`) })
  });
}

const SIGNAL_NAMES = Object.freeze([
  "userImpact",
  "defectSeverity",
  "dependencyUnblocks",
  "evidenceConfidence",
  "cost"
]);

function normalizeMeasurement(raw, item, boardOrder, policy) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `measurement for ${item.id} must be an object`);
  invariant(raw.itemId === item.id, `measurement itemId mismatch: expected ${item.id}`);
  const userPriority = raw.userPriority == null ? null : requireText(raw.userPriority, `${item.id}.userPriority`);
  if (userPriority != null) {
    invariant(
      Object.hasOwn(policy.weights.userPriority, userPriority),
      `${item.id}.userPriority has no configured weight: ${userPriority}`
    );
  }
  const signals = Object.fromEntries(
    SIGNAL_NAMES.map((name) => [name, normalizeSignal(raw.signals?.[name], `${item.id}.signals.${name}`)])
  );
  if (signals.cost != null) {
    invariant(signals.cost.value >= 0, `${item.id}.signals.cost.value must be non-negative`);
  }
  const missingSignals = SIGNAL_NAMES.filter((name) => signals[name] == null);
  if (userPriority == null) missingSignals.push("userPriority");
  return freezeClone({
    itemId: item.id,
    boardOrder,
    userPriority,
    mandatoryObligations: uniqueTextArray(raw.mandatoryObligations ?? [], `${item.id}.mandatoryObligations`),
    signals,
    missingSignals,
    deferrals: requireNonNegativeInteger(raw.deferrals ?? 0, `${item.id}.deferrals`),
    reviewRequirements: clone(item.reviewRequirements ?? [])
  });
}

function isMandatory(measurement) {
  return measurement.mandatoryObligations.length > 0;
}

function scoreComponents(measurement, policy) {
  if (measurement.missingSignals.length > 0) return null;
  const w = policy.weights;
  const components = {
    userImpact: measurement.signals.userImpact.value * w.userImpact,
    defectSeverity: measurement.signals.defectSeverity.value * w.defectSeverity,
    dependencyUnblocks: measurement.signals.dependencyUnblocks.value * w.dependencyUnblocks,
    evidenceConfidence: measurement.signals.evidenceConfidence.value * w.evidenceConfidence,
    userPriority: w.userPriority[measurement.userPriority],
    cost: measurement.signals.cost.value * w.cost,
    age: Math.min(measurement.deferrals, policy.maxDeferrals) * w.age
  };
  return freezeClone({
    ...components,
    total: Object.values(components).reduce((sum, value) => sum + value, 0)
  });
}

function selectionInputSnapshot(handoff) {
  const body = {
    version: handoff.version,
    projectId: handoff.projectId ?? null,
    rootItemId: handoff.rootItemId,
    intent: handoff.intent,
    workGraph: handoff.workGraph,
    eligibleItemIds: handoff.lifecycle.eligibleWork.map((item) => item.id)
  };
  return freezeClone({
    digest: digestValue(body),
    eligibleItemIds: body.eligibleItemIds
  });
}

function normalizeBudget(raw, policy) {
  const limit = raw?.limit ?? policy.selectionBudget;
  const observedSpent = raw?.observedSpent ?? 0;
  requirePositiveNumber(limit, "budget.limit");
  invariant(Number.isFinite(observedSpent) && observedSpent >= 0, "budget.observedSpent must be a non-negative finite number");
  invariant(observedSpent <= limit, "budget.observedSpent must not exceed budget.limit");
  return freezeClone({ limit, observedSpent, remaining: limit - observedSpent });
}

function decisionArtifact(body) {
  const digest = digestValue(body);
  return freezeClone({
    ...body,
    id: `work-selection:${digest}`,
    digest
  });
}

function validateDecisionArtifact(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "WORK_SELECTION_DECISION artifact is required");
  invariant(raw.kind === "WORK_SELECTION_DECISION" && raw.version === 1, "work selection decision kind/version is invalid");
  const { id, digest, ...body } = raw;
  const expected = digestValue(body);
  invariant(digest === expected && id === `work-selection:${expected}`, "work selection decision identity/digest mismatch");
  return freezeClone(raw);
}

function decisionFileName(digest) {
  invariant(/^sha256:[0-9a-f]{64}$/.test(digest), "work selection ref.digest must be a sha256 digest");
  return `work-selection-${digest.slice("sha256:".length)}.json`;
}

function normalizeDecisionRef(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "work selection decision ref is required");
  return Object.freeze({
    id: requireText(raw.id, "work selection decision ref.id"),
    digest: requireText(raw.digest, "work selection decision ref.digest")
  });
}

export function createJsonWorkSelectionDecisionStore({ path, fs = nodeFs }) {
  requireText(path, "workSelectionDecisionStore path");
  invariant(
    fs &&
      typeof fs.mkdir === "function" &&
      typeof fs.open === "function" &&
      typeof fs.readFile === "function" &&
      typeof fs.link === "function" &&
      typeof fs.unlink === "function",
    "workSelectionDecisionStore requires filesystem mkdir/open/read/link/unlink capability"
  );

  async function put(raw) {
    const artifact = validateDecisionArtifact(raw);
    await fs.mkdir(path, { recursive: true });
    const fileName = decisionFileName(artifact.digest);
    const filePath = join(path, fileName);
    const tempPath = join(path, `.${fileName}.${randomUUID()}.tmp`);
    let handle = null;
    try {
      handle = await fs.open(tempPath, "wx");
      await handle.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
      await handle.close();
      handle = null;
      try {
        await fs.link(tempPath, filePath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = validateDecisionArtifact(JSON.parse(await fs.readFile(filePath, "utf8")));
        invariant(
          canonicalize(existing) === canonicalize(artifact),
          "work selection decision digest already exists with different content"
        );
      }
    } finally {
      if (handle != null) await handle.close();
      try {
        await fs.unlink(tempPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return Object.freeze({ id: artifact.id, digest: artifact.digest });
  }

  async function read(rawRef) {
    const ref = normalizeDecisionRef(rawRef);
    const filePath = join(path, decisionFileName(ref.digest));
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`${type} trust artifact unavailable: ${ref.id}`);
      throw error;
    }
    const artifact = validateDecisionArtifact(raw);
    invariant(artifact.id === ref.id && artifact.digest === ref.digest, `work selection decision ref mismatch: ${ref.id}`);
    return artifact;
  }

  return Object.freeze({ put, read });
}

function requireDecisionStore(store) {
  invariant(
    store && typeof store.put === "function" && typeof store.read === "function",
    "bounded project work selector requires a durable decisionStore"
  );
  return store;
}

function requireHandoffSurface(surface) {
  invariant(surface && typeof surface.read === "function", "bounded project work selector requires a SessionHandoffSurface");
  return surface;
}

function choose(measurements, budget, policy) {
  const excluded = [];
  const mandatory = measurements
    .filter(isMandatory)
    .sort((left, right) => {
      const l = left.signals.defectSeverity?.value;
      const r = right.signals.defectSeverity?.value;
      if (l == null && r == null) return left.boardOrder - right.boardOrder;
      if (l == null) return 1;
      if (r == null) return -1;
      return r - l || left.boardOrder - right.boardOrder;
    });

  if (mandatory.length > 0) {
    const incomplete = mandatory.filter((item) => item.missingSignals.length > 0);
    if (incomplete.length > 0) {
      return {
        selected: null,
        reason: WorkSelectionReason.MISSING_MEASUREMENT,
        scoreComponents: null,
        excluded: incomplete.map((item) => ({ itemId: item.itemId, reason: "MANDATORY_MISSING_MEASUREMENT", missingSignals: item.missingSignals })),
        stopOrEscalation: {
          action: WorkContinuationAction.ESCALATE,
          itemId: incomplete[0].itemId,
          reason: "MANDATORY_MISSING_MEASUREMENT"
        }
      };
    }
    const target = mandatory[0];
    if (target.signals.cost.value > budget.remaining) {
      return {
        selected: null,
        reason: WorkSelectionReason.MANDATORY_BUDGET_CONFLICT,
        scoreComponents: null,
        excluded: [{ itemId: target.itemId, reason: "MANDATORY_BUDGET_CONFLICT" }],
        stopOrEscalation: {
          action: WorkContinuationAction.ESCALATE,
          itemId: target.itemId,
          reason: "MANDATORY_BUDGET_CONFLICT"
        }
      };
    }
    return {
      selected: target,
      reason: WorkSelectionReason.MANDATORY_CORRECTNESS,
      scoreComponents: scoreComponents(target, policy),
      excluded,
      stopOrEscalation: null
    };
  }

  for (const measurement of measurements) {
    if (measurement.missingSignals.length > 0) {
      excluded.push({ itemId: measurement.itemId, reason: "MISSING_MEASUREMENT", missingSignals: measurement.missingSignals });
    } else if (measurement.signals.cost.value > budget.remaining) {
      excluded.push({ itemId: measurement.itemId, reason: "BUDGET_LIMIT", missingSignals: [] });
    }
  }

  const affordableComplete = measurements.filter(
    (item) => item.missingSignals.length === 0 && item.signals.cost.value <= budget.remaining
  );

  const starved = affordableComplete
    .filter((item) => item.deferrals >= policy.maxDeferrals)
    .sort((left, right) => right.deferrals - left.deferrals || left.boardOrder - right.boardOrder);
  if (starved.length > 0) {
    return {
      selected: starved[0],
      reason: WorkSelectionReason.STARVATION_FENCE,
      scoreComponents: scoreComponents(starved[0], policy),
      excluded,
      stopOrEscalation: null
    };
  }

  const ranked = affordableComplete
    .map((item) => ({ item, scoreComponents: scoreComponents(item, policy) }))
    .sort((left, right) =>
      right.scoreComponents.total - left.scoreComponents.total ||
      left.item.boardOrder - right.item.boardOrder
    );

  if (ranked.length > 0) {
    return {
      selected: ranked[0].item,
      reason: WorkSelectionReason.BOUNDED_SCORE,
      scoreComponents: ranked[0].scoreComponents,
      excluded,
      stopOrEscalation: null
    };
  }

  return {
    selected: null,
    reason: excluded.some((entry) => entry.reason === "MISSING_MEASUREMENT")
      ? WorkSelectionReason.MISSING_MEASUREMENT
      : WorkSelectionReason.NO_AFFORDABLE_MEASURABLE_WORK,
    scoreComponents: null,
    excluded,
    stopOrEscalation: {
      action: WorkContinuationAction.STOP,
      itemId: null,
      reason: excluded.some((entry) => entry.reason === "MISSING_MEASUREMENT")
        ? "MISSING_MEASUREMENT"
        : "NO_AFFORDABLE_MEASURABLE_WORK"
    }
  };
}

export function decideProjectWorkContinuation(policyInput, raw) {
  const policy = defineBoundedWorkSelectionPolicy(policyInput);
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "work continuation input is required");
  const mandatory = raw.mandatory === true;
  const retryCount = requireNonNegativeInteger(raw.retryCount ?? 0, "retryCount");
  invariant(Array.isArray(raw.recentOutcomeDeltas ?? []), "recentOutcomeDeltas must be an array");
  const recentOutcomeDeltas = (raw.recentOutcomeDeltas ?? []).map((value, index) => {
    invariant(Number.isFinite(value), `recentOutcomeDeltas[${index}] must be finite`);
    return value;
  });
  invariant(Number.isFinite(raw.remainingBudget) && raw.remainingBudget >= 0, "remainingBudget must be non-negative and finite");
  invariant(Number.isFinite(raw.nextCost) && raw.nextCost >= 0, "nextCost must be non-negative and finite");
  invariant(Object.values(WorkSelectionEvidenceState).includes(raw.evidenceState), "evidenceState is invalid");

  if ([WorkSelectionEvidenceState.STALE, WorkSelectionEvidenceState.CONTRADICTORY].includes(raw.evidenceState)) {
    return mandatory ? WorkContinuationAction.ESCALATE : WorkContinuationAction.STOP;
  }
  if (mandatory && raw.nextCost > raw.remainingBudget) return WorkContinuationAction.ESCALATE;
  if (retryCount >= policy.retryCeiling) return mandatory ? WorkContinuationAction.ESCALATE : WorkContinuationAction.STOP;

  const recent = policy.plateauWindow === 0 ? [] : recentOutcomeDeltas.slice(-policy.plateauWindow);
  if (policy.plateauWindow > 0 && recent.length === policy.plateauWindow && recent.every((delta) => delta <= 0)) {
    return mandatory ? WorkContinuationAction.ESCALATE : WorkContinuationAction.STOP;
  }
  return WorkContinuationAction.CONTINUE;
}

export function createBoundedProjectWorkSelector({ handoffSurface, decisionStore, policy: rawPolicy }) {
  const surface = requireHandoffSurface(handoffSurface);
  const store = requireDecisionStore(decisionStore);
  const policy = defineBoundedWorkSelectionPolicy(rawPolicy);

  async function propose({ measurements = [], budget = null } = {}) {
    invariant(Array.isArray(measurements), "measurements must be an array");
    const handoff = await surface.read();
    const budgetState = normalizeBudget(budget, policy);
    const byItem = new Map();
    for (const [index, entry] of measurements.entries()) {
      invariant(entry && typeof entry === "object" && !Array.isArray(entry), `measurements[${index}] must be an object`);
      const itemId = requireText(entry.itemId, `measurements[${index}].itemId`);
      invariant(!byItem.has(itemId), `duplicate measurement itemId: ${itemId}`);
      byItem.set(itemId, entry);
    }

    const eligibleIds = new Set(handoff.lifecycle.eligibleWork.map((item) => item.id));
    const normalized = handoff.lifecycle.eligibleWork.map((item, boardOrder) =>
      normalizeMeasurement(
        byItem.get(item.id) ?? { itemId: item.id, signals: {} },
        item,
        boardOrder,
        policy
      )
    );
    const nonEligibleExcluded = [...byItem.keys()]
      .filter((itemId) => !eligibleIds.has(itemId))
      .map((itemId) => ({ itemId, reason: "NOT_ELIGIBLE", missingSignals: [] }));
    const choice = choose(normalized, budgetState, policy);
    const snapshot = selectionInputSnapshot(handoff);
    const body = {
      kind: "WORK_SELECTION_DECISION",
      version: 1,
      projectId: handoff.projectId ?? null,
      policy: {
        name: policy.name,
        revision: policy.revision,
        configurationRef: policy.configurationRef,
        configuration: {
          selectionBudget: policy.selectionBudget,
          maxDeferrals: policy.maxDeferrals,
          retryCeiling: policy.retryCeiling,
          plateauWindow: policy.plateauWindow,
          weights: policy.weights
        }
      },
      comparison: {
        baselinePolicy: {
          name: "explicit-eligible-manual-selection",
          revision: "1"
        },
        candidatePolicy: {
          name: policy.name,
          revision: policy.revision
        }
      },
      inputSnapshot: snapshot,
      eligibleItemRefs: handoff.lifecycle.eligibleWork.map((item) => item.id),
      excluded: [...nonEligibleExcluded, ...choice.excluded],
      measurements: normalized,
      selectedItemId: choice.selected?.itemId ?? null,
      reason: choice.reason,
      scoreComponents: choice.scoreComponents,
      budget: budgetState,
      stopOrEscalation: choice.stopOrEscalation,
      evidenceClass: "APPLICATION_WORK_SELECTION",
      productionEvidence: false,
      authority: {
        selectionMutatesBlackboard: false,
        selectionIsCorrectnessEvidence: false,
        claimRequiresFreshOrchestratorCheck: true
      }
    };
    const artifact = decisionArtifact(body);
    const ref = await store.put(artifact);
    return freezeClone({ decisionRef: ref, decision: artifact });
  }

  async function assertFresh(rawRef) {
    const decision = await store.read(rawRef);
    const handoff = await surface.read();
    const fresh = selectionInputSnapshot(handoff);
    invariant(
      fresh.digest === decision.inputSnapshot.digest,
      `work selection decision is stale: expected input ${decision.inputSnapshot.digest}; found ${fresh.digest}`
    );
    if (decision.selectedItemId != null) {
      invariant(
        handoff.lifecycle.eligibleWork.some((item) => item.id === decision.selectedItemId),
        `work selection decision selected item is no longer eligible: ${decision.selectedItemId}`
      );
    }
    return freezeClone({ decision, handoff });
  }

  return Object.freeze({ policy, propose, assertFresh });
}
