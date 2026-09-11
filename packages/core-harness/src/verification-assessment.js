import { invariant, requireText } from "./contracts.js";
import { VerificationStatus } from "./verification.js";

function sourceKey(artifact) {
  const source = artifact.source ?? {};
  return `${source.kind ?? "UNKNOWN"}:${source.name ?? "anonymous"}`;
}

function normalizeRequirement(requirement) {
  invariant(requirement && typeof requirement === "object", "verification requirement is required");
  const claim = requireText(requirement.claim, "verification requirement claim");
  const minSources = requirement.minSources ?? 1;
  invariant(Number.isInteger(minSources) && minSources > 0, "verification requirement minSources must be a positive integer");
  return Object.freeze({ claim, minSources });
}

function evaluationInputSnapshot(input) {
  return Object.freeze({
    observationIds: Object.freeze((input.observations ?? []).map((item) => item.id).filter(Boolean)),
    verificationIds: Object.freeze((input.verifications ?? []).map((item) => item.id).filter(Boolean))
  });
}

export function defineVerificationPolicy({
  requirements = [],
  rejectFailures = true,
  rejectConflicts = true
} = {}) {
  const normalizedRequirements = requirements.map(normalizeRequirement);
  const seen = new Set();
  for (const requirement of normalizedRequirements) {
    invariant(!seen.has(requirement.claim), `duplicate verification requirement: ${requirement.claim}`);
    seen.add(requirement.claim);
  }

  return Object.freeze({
    requirements: Object.freeze(normalizedRequirements),
    rejectFailures: rejectFailures !== false,
    rejectConflicts: rejectConflicts !== false
  });
}

export function assessVerificationArtifacts({ artifacts = [], policy = defineVerificationPolicy() } = {}) {
  const resolvedPolicy = defineVerificationPolicy(policy);
  const byClaim = new Map();

  for (const artifact of artifacts) {
    invariant(artifact && typeof artifact === "object", "verification artifact is required");
    const claim = requireText(artifact.claim, "verification artifact claim");
    invariant(Object.values(VerificationStatus).includes(artifact.status), "verification artifact status is invalid");

    const entry = byClaim.get(claim) ?? {
      claim,
      artifacts: [],
      passSources: new Set(),
      failSources: new Set(),
      inconclusiveSources: new Set()
    };

    const key = sourceKey(artifact);
    entry.artifacts.push(artifact.id ?? null);
    if (artifact.status === VerificationStatus.PASS) entry.passSources.add(key);
    if (artifact.status === VerificationStatus.FAIL) entry.failSources.add(key);
    if (artifact.status === VerificationStatus.INCONCLUSIVE) entry.inconclusiveSources.add(key);
    byClaim.set(claim, entry);
  }

  const claims = [...byClaim.values()].map((entry) => Object.freeze({
    claim: entry.claim,
    artifacts: Object.freeze([...entry.artifacts]),
    passSources: Object.freeze([...entry.passSources]),
    failSources: Object.freeze([...entry.failSources]),
    inconclusiveSources: Object.freeze([...entry.inconclusiveSources]),
    conflict: entry.passSources.size > 0 && entry.failSources.size > 0
  }));

  const claimIndex = new Map(claims.map((claim) => [claim.claim, claim]));
  const conflicts = claims.filter((claim) => claim.conflict).map((claim) => claim.claim);
  const failures = claims.filter((claim) => claim.failSources.length > 0).map((claim) => claim.claim);
  const unmetRequirements = [];

  for (const requirement of resolvedPolicy.requirements) {
    const claim = claimIndex.get(requirement.claim);
    const observedSources = claim?.passSources.length ?? 0;
    if (observedSources < requirement.minSources) {
      unmetRequirements.push(Object.freeze({
        claim: requirement.claim,
        minSources: requirement.minSources,
        observedSources
      }));
    }
  }

  const reasons = [];
  if (resolvedPolicy.rejectConflicts) {
    for (const claim of conflicts) reasons.push(Object.freeze({ code: "CONFLICT", claim }));
  }
  if (resolvedPolicy.rejectFailures) {
    for (const claim of failures) reasons.push(Object.freeze({ code: "FAILURE", claim }));
  }
  for (const requirement of unmetRequirements) {
    reasons.push(Object.freeze({ code: "INCOMPLETE", ...requirement }));
  }

  return Object.freeze({
    ready: reasons.length === 0,
    policy: resolvedPolicy,
    claims: Object.freeze(claims),
    conflicts: Object.freeze(conflicts),
    failures: Object.freeze(failures),
    unmetRequirements: Object.freeze(unmetRequirements),
    reasons: Object.freeze(reasons),
    counts: Object.freeze({
      artifacts: artifacts.length,
      claims: claims.length,
      conflicts: conflicts.length,
      failures: failures.length,
      unmetRequirements: unmetRequirements.length
    })
  });
}

export function createVerificationAwareObjective({ objective, policy = defineVerificationPolicy() }) {
  invariant(objective && typeof objective.evaluate === "function", "verification-aware objective requires evaluate()");
  const resolvedPolicy = defineVerificationPolicy(policy);

  return Object.freeze({
    async evaluate(input) {
      const verificationAssessment = assessVerificationArtifacts({
        artifacts: input.verifications ?? [],
        policy: resolvedPolicy
      });
      const inputSnapshot = evaluationInputSnapshot(input);

      if (!verificationAssessment.ready) {
        return {
          validity: "VALID",
          verdict: "GAP",
          findings: verificationAssessment.reasons,
          evidence: (input.verifications ?? []).map((artifact) => artifact.id).filter(Boolean),
          metadata: { verificationAssessment, inputSnapshot }
        };
      }

      const result = await objective.evaluate({
        ...input,
        verificationAssessment
      });

      invariant(result && typeof result === "object", "objective evaluation result is required");
      return {
        ...result,
        metadata: {
          ...(result.metadata ?? {}),
          verificationAssessment,
          inputSnapshot
        }
      };
    }
  });
}
