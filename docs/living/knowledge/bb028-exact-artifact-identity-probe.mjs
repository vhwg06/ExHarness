const SEMANTIC_MEMORY_KINDS = new Set(["EPISODIC", "SEMANTIC", "PROCEDURAL", "REFLECTION", "INTENT"]);

function requireInvariant(condition, reason) {
  if (!condition) throw new Error(reason);
}

function refKey(ref) {
  return `${ref.kind}:${ref.id}`;
}

function canonicalIdentity(ref, artifact, label) {
  requireInvariant(artifact && typeof artifact === "object", `${label} missing`);

  if (ref.kind === "MEMORY") {
    requireInvariant(SEMANTIC_MEMORY_KINDS.has(artifact.kind), `${label} semantic memory kind mismatch`);
    return { kind: "MEMORY", id: artifact.id, revision: artifact.revision ?? null };
  }

  if (ref.kind === "EVALUATION") {
    return { kind: "EVALUATION", id: artifact.id, revision: artifact.revision ?? null };
  }

  if (ref.kind === "EFFECT_OPERATION") {
    return { kind: "EFFECT_OPERATION", id: artifact.operationId, revision: artifact.revision ?? null };
  }

  requireInvariant(artifact.artifactRef && typeof artifact.artifactRef === "object", `${label} canonical artifactRef missing`);
  return {
    kind: artifact.artifactRef.kind,
    id: artifact.artifactRef.id,
    revision: artifact.revision ?? artifact.artifactRef.revision ?? null
  };
}

function resolveExact(index, ref, label) {
  const artifact = index.get(refKey(ref));
  requireInvariant(artifact != null, `${label} missing`);
  const identity = canonicalIdentity(ref, artifact, label);
  requireInvariant(identity.kind === ref.kind, `${label} kind mismatch`);
  requireInvariant(identity.id === ref.id, `${label} identity mismatch`);
  if (ref.revision != null) {
    requireInvariant(identity.revision === ref.revision, `${label} revision mismatch`);
  }
  return artifact;
}

const baselines = [
  {
    name: "evaluation",
    label: "evaluation",
    ref: { kind: "EVALUATION", id: "qa-eval-v2" },
    artifact: { id: "qa-eval-v2", verdict: "FAIL" }
  },
  {
    name: "action-intent",
    label: "action intent",
    ref: { kind: "ACTION_INTENT", id: "intent-1", revision: 3 },
    artifact: { id: "intent-1", artifactRef: { kind: "ACTION_INTENT", id: "intent-1" }, revision: 3 }
  },
  {
    name: "reflection-memory",
    label: "reflection memory",
    ref: { kind: "MEMORY", id: "memory-reflection-1", revision: 1 },
    artifact: { id: "memory-reflection-1", kind: "REFLECTION", status: "ACTIVE", revision: 1 }
  },
  {
    name: "deliberation",
    label: "deliberation",
    ref: { kind: "DELIBERATION", id: "delib-1" },
    artifact: { id: "delib-1", artifactRef: { kind: "DELIBERATION", id: "delib-1" } }
  },
  {
    name: "effect-operation",
    label: "effect operation",
    ref: { kind: "EFFECT_OPERATION", id: "effect-1" },
    artifact: { operationId: "effect-1", status: "CONFIRMED" }
  }
];

for (const baseline of baselines) {
  const slot = new Map([[refKey(baseline.ref), structuredClone(baseline.artifact)]]);
  resolveExact(slot, baseline.ref, baseline.label);
}

const controls = [
  {
    name: "hard-coded-evaluation-slot-with-wrong-stored-id",
    baseline: "evaluation",
    mutate(artifact) { artifact.id = "qa-eval-forged"; }
  },
  {
    name: "hard-coded-action-intent-slot-with-wrong-stored-revision",
    baseline: "action-intent",
    mutate(artifact) { artifact.revision = 2; }
  },
  {
    name: "hard-coded-memory-slot-with-wrong-stored-id",
    baseline: "reflection-memory",
    mutate(artifact) { artifact.id = "memory-reflection-forged"; }
  },
  {
    name: "hard-coded-deliberation-slot-with-wrong-canonical-kind",
    baseline: "deliberation",
    mutate(artifact) { artifact.artifactRef.kind = "EVALUATION"; }
  },
  {
    name: "hard-coded-effect-slot-with-wrong-operation-id",
    baseline: "effect-operation",
    mutate(artifact) { artifact.operationId = "effect-forged"; }
  }
];

const results = controls.map((control) => {
  const baseline = baselines.find((candidate) => candidate.name === control.baseline);
  const artifact = structuredClone(baseline.artifact);
  control.mutate(artifact);
  const slot = new Map([[refKey(baseline.ref), artifact]]);
  try {
    resolveExact(slot, baseline.ref, baseline.label);
    return { name: control.name, accepted: true, failClosed: false, reason: null };
  } catch (error) {
    return { name: control.name, accepted: false, failClosed: true, reason: error.message };
  }
});

requireInvariant(results.every((result) => result.failClosed && !result.accepted), "exact-artifact-identity control escaped verification");

const report = {
  evidenceClass: "DETERMINISTIC_SYNTHETIC_REPOSITORY_SHAPE",
  productionEvidence: false,
  question: "Can a hard-coded resolver slot launder an artifact whose canonical identity or revision differs from the exact requested ref?",
  baselineCases: baselines.length,
  baselineAccepted: baselines.length,
  controlCount: results.length,
  escapedControls: results.filter((result) => result.accepted).length,
  controls: results,
  conclusion: {
    exactArtifactIdentityRequired: true,
    hardCodedSlotKeyIsNotIdentityProof: true,
    implementationMayProceedWithoutIndependentReview: false
  }
};

console.log(JSON.stringify(report, null, 2));
