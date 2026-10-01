import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createDomainExecutionArtifactRegistry,
  createDomainExecutionPolicyPublisher,
  defineExecutionStrategyDescriptor,
  executionPolicySubjectKey
} from "../src/index.js";
import { createJsonDomainExecutionPolicyStore } from "../src/domain-execution-store.js";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
import { digestValue } from "../../core-harness/src/index.js";
const POLICY_DIGEST = digestValue({ policy: "how-eval-policy" });
const SCENARIO_DIGEST = digestValue({ scenarios: "how-eval-cases" });
const METRIC_DIGEST = digestValue({ metric: "how-eval-metric" });
const EVIDENCE_DIGEST = digestValue({ evidence: "how-eval-snapshot" });

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);
const SHA_F = "f".repeat(64);

function passingProtocol(overrides = {}) {
  return {
    kind: "HOW_EVOLUTION_EVALUATION_PROTOCOL",
    version: 1,
    id: "how-eval-1",
    domain: "BUSINESS_ANALYSIS",
    workloadType: "requirements-analysis",
    workContract: { ref: `work-contract:sha256:${SHA_A}`, digest: `sha256:${SHA_A}` },
    acceptanceRefs: [{ ref: `acceptance-policy:sha256:${SHA_B}`, digest: `sha256:${SHA_B}` }],
    finding: { ref: `how-evolution-finding:sha256:${SHA_C}`, digest: `sha256:${SHA_C}` },
    baselineStrategy: { ref: `execution-strategy-descriptor:sha256:${SHA_D}`, digest: `sha256:${SHA_D}` },
    candidateStrategy: { ref: `execution-strategy-descriptor:sha256:${SHA_E}`, digest: `sha256:${SHA_E}` },
    candidateProducer: "candidate-builder",
    evaluator: {
      identity: "independent-evaluator",
      revision: "2",
      policyRef: "policy:how-evaluation",
      policyRevision: "3",
      policyDigest: POLICY_DIGEST,
      modelSnapshot: "jev-1.13.0"
    },
    promotionAuthority: "promotion-authority",
    scenarioSet: {
      ref: "scenario-set:how-eval",
      version: "1",
      digest: SCENARIO_DIGEST,
      trigger: ["trigger-1"],
      regression: ["regression-critical", "regression-recovery"],
      holdout: ["holdout-1", "holdout-2"],
      holdoutOwner: "independent-evaluator"
    },
    metricPolicy: {
      ref: "metric-policy:how-eval",
      digest: METRIC_DIGEST,
      minEffect: 0.05,
      primaryMetric: "primary-score",
      criticalCaseIds: ["regression-critical"],
      recoveryCaseIds: ["regression-recovery"]
    },
    replay: { repeatCount: 1, seedPolicy: "fixed-seed", deterministic: true },
    evidenceSnapshot: {
      ref: "evidence-snapshot:how-eval",
      digest: EVIDENCE_DIGEST,
      evidenceRefs: ["evidence:causal-1", "evidence:runtime-1"]
    },
    expectedPolicyHead: {
      subjectKey: "domain-execution-policy:baseline",
      revision: "rev-1",
      generation: 1,
      policyRef: `execution-policy:sha256:${SHA_F}`
    },
    ...overrides
  };
}

function runFor(protocol, side, metrics, overrides = {}) {
  const strategy = side === "BASELINE" ? protocol.baselineStrategy : protocol.candidateStrategy;
  return {
    kind: "HOW_EVOLUTION_EVALUATION_RUN",
    version: 1,
    runId: `${side.toLowerCase()}-run-1`,
    protocolRef: "how-evolution-protocol:sha256:" + "0".repeat(64),
    protocolDigest: digestValue(protocol),
    side,
    strategyRef: strategy.ref,
    strategyDigest: strategy.digest,
    workContractRef: protocol.workContract.ref,
    caseResults: [
      { caseId: "trigger-1", status: "PASS", primaryMetric: metrics.trigger ?? 0.8, evidenceRefs: ["evidence:trigger-1"], policyCompliant: true, evidenceComplete: true, recoveryOk: true },
      { caseId: "regression-critical", status: "PASS", primaryMetric: metrics.critical ?? 0.9, evidenceRefs: ["evidence:critical-1"], policyCompliant: true, evidenceComplete: true, recoveryOk: true },
      { caseId: "regression-recovery", status: "PASS", primaryMetric: metrics.recovery ?? 0.7, evidenceRefs: ["evidence:recovery-1"], policyCompliant: true, evidenceComplete: true, recoveryOk: true },
      { caseId: "holdout-1", status: "PASS", primaryMetric: metrics.holdout1 ?? 0.8, evidenceRefs: ["evidence:holdout-1"], policyCompliant: true, evidenceComplete: true, recoveryOk: true },
      { caseId: "holdout-2", status: "PASS", primaryMetric: metrics.holdout2 ?? 0.8, evidenceRefs: ["evidence:holdout-2"], policyCompliant: true, evidenceComplete: true, recoveryOk: true }
    ],
    ...overrides
  };
}

function jevReceiptFor(protocol, verdict = "PASS") {
  return {
    kind: "HOW_EVOLUTION_JEV_RECEIPT",
    version: 1,
    protocolDigest: digestValue(protocol),
    evaluatorIdentity: protocol.evaluator.identity,
    evaluatorRevision: protocol.evaluator.revision,
    evaluatorPolicyRef: protocol.evaluator.policyRef,
    evaluatorPolicyDigest: protocol.evaluator.policyDigest,
    modelSnapshot: "jev-1.13.0",
    semanticVerdict: verdict,
    requestHash: "request-hash-1",
    responseHash: "response-hash-1",
    questionOutcomes: [
      { questionId: "semantic-preservation", outcome: verdict },
      { questionId: "how-improvement", outcome: verdict },
      { questionId: "evidence-sufficiency", outcome: verdict }
    ],
    evidenceRefs: ["evidence:causal-1", "evidence:runtime-1"]
  };
}
import {
  HOW_EVOLUTION_ROLLBACK_KIND,
  createHowEvolutionPromotionProposal,
  createJsonHowEvolutionArtifactStore,
  defineHowEvolutionEvaluationProtocol,
  defineHowEvolutionEvaluationRun,
  evaluateHowEvolution,
  publishHowEvolutionPromotion,
  publishHowEvolutionRollback,
  resolveHowEvolutionProvenance,
  createInMemoryHowEvolutionArtifactStore
} from "../src/how-evolution.js";

const SHA_RUNTIME = "6".repeat(64);

async function rollbackFixture() {
  const dir = await mkdtemp(join(tmpdir(), "exharness-howrollback-"));
  const immutable = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const artifactRegistry = createDomainExecutionArtifactRegistry({ store: immutable });
  const policyStore = createJsonDomainExecutionPolicyStore({ path: join(dir, "policy-heads.json") });
  const protocol = defineHowEvolutionEvaluationProtocol(passingProtocol());
  const baselineStrategy = defineExecutionStrategyDescriptor({
    strategyId: "how.baseline",
    strategyVersion: "1.0.0",
    strategyKind: "application-core-loop",
    compatibleWorkloadTypes: [protocol.workloadType],
    compatibleWorkContractVersions: [1],
    adapterRef: "adapter:how-loop@1",
    runtimeBindingMode: "IMMUTABLE_LOCAL",
    expectedRuntimeCodeRef: `git:sha256:${SHA_RUNTIME}`,
    contextRefs: ["context:how-v1"]
  });
  const candidateStrategy = defineExecutionStrategyDescriptor({ ...baselineStrategy, strategyId: "how.candidate", strategyVersion: "1.1.0" });
  const baselineRef = await artifactRegistry.putExecutionStrategyDescriptor(baselineStrategy);
  const candidateRef = await artifactRegistry.putExecutionStrategyDescriptor(candidateStrategy);
  const key = executionPolicySubjectKey(protocol.domain, protocol.workloadType);
  const policyPublisher = createDomainExecutionPolicyPublisher({
    policyAuthority: {
      async verifyExecutionPolicyPublisher({ publisher }) {
        assert.ok(["promotion-authority", "rollback-authority"].includes(publisher.identity));
        return { authorityRef: "authority:domain-policy-publisher" };
      }
    },
    artifactRegistry,
    executionPolicyStore: policyStore
  });
  const baselineHead = await policyPublisher.publish({
    publisher: { identity: "promotion-authority" },
    policy: {
      policyId: key, generation: 1, domain: protocol.domain, workloadType: protocol.workloadType,
      compatibleWorkContractVersions: [1], strategyRef: baselineRef
    }
  });
  // The rollback authority is the promotion authority for this bounded proof,
  // but it must still differ from the candidate producer and evaluator.
  const pinned = defineHowEvolutionEvaluationProtocol({
    ...passingProtocol(),
    promotionAuthority: "rollback-authority",
    baselineStrategy: { ref: baselineRef, digest: `sha256:${baselineRef.slice(baselineRef.lastIndexOf(":") + 1)}` },
    candidateStrategy: { ref: candidateRef, digest: `sha256:${candidateRef.slice(candidateRef.lastIndexOf(":") + 1)}` },
    expectedPolicyHead: {
      subjectKey: key,
      revision: baselineHead.head.revision,
      generation: 1,
      policyRef: baselineHead.head.value.policyRef
    }
  });
  return { dir, artifactRegistry, policyStore, policyPublisher, protocol: pinned, key, baselineRef, candidateRef };
}

function freshReaders(protocol) {
  return {
    resolveCurrentSemantic: async () => ({
      workContractDigest: protocol.workContract.digest,
      acceptanceDigests: protocol.acceptanceRefs.map((entry) => entry.digest)
    }),
    resolveCurrentEvaluator: async () => ({
      policyDigest: protocol.evaluator.policyDigest,
      modelSnapshot: protocol.evaluator.modelSnapshot
    }),
    resolveCurrentScenarioSet: async () => ({ digest: protocol.scenarioSet.digest }),
    resolveCurrentEvidence: async () => ({ digest: protocol.evidenceSnapshot.digest })
  };
}

async function promoteFixture(f) {
  const evaluation = evaluateHowEvolution({
    protocol: f.protocol,
    baselineRun: runFor(f.protocol, "BASELINE", {}),
    candidateRun: runFor(f.protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }),
    jevReceipt: jevReceiptFor(f.protocol, "PASS")
  });
  const proposal = createHowEvolutionPromotionProposal({ protocol: f.protocol, evaluation });
  const promotion = await publishHowEvolutionPromotion({
    protocol: f.protocol,
    evaluation,
    proposal,
    publisher: { identity: "rollback-authority" },
    policyPublisher: f.policyPublisher,
    artifactRegistry: f.artifactRegistry,
    executionPolicyStore: f.policyStore,
    currentness: freshReaders(f.protocol)
  });
  return { evaluation, proposal, promotion };
}

function rollbackArgs(f, promotion, evaluation, overrides = {}) {
  return {
    protocol: f.protocol,
    targetStrategyRef: f.baselineRef,
    targetStrategyDigest: `sha256:${f.baselineRef.slice(f.baselineRef.lastIndexOf(":") + 1)}`,
    reversedPromotion: promotion.decision,
    reversedEvaluation: evaluation,
    reasonEvidenceRefs: ["evidence:rollback-reason-1"],
    publisher: { identity: "rollback-authority" },
    policyPublisher: f.policyPublisher,
    artifactRegistry: f.artifactRegistry,
    executionPolicyStore: f.policyStore,
    ...overrides
  };
}

test("AC-7: rollback publishes a successor generation to the exact prior accepted baseline", async () => {
  const f = await rollbackFixture();
  try {
    const { evaluation, proposal, promotion } = await promoteFixture(f);
    assert.equal(promotion.published.policy.generation, 2);

    const rollback = await publishHowEvolutionRollback(rollbackArgs(f, promotion, evaluation));
    assert.equal(rollback.decision.kind, HOW_EVOLUTION_ROLLBACK_KIND);
    assert.equal(rollback.decision.targetStrategyRef, f.baselineRef);
    assert.equal(rollback.decision.reasonKind, "ROLLBACK");
    assert.equal(rollback.published.policy.generation, 3);
    assert.equal(rollback.published.policy.strategyRef, f.baselineRef);

    // History remains resolvable: generations 1..3 are distinct immutable policies.
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 3);
    const current = await f.artifactRegistry.resolveExecutionPolicy(head.value.policyRef);
    assert.equal(current.strategyRef, f.baselineRef);
    const promoted = await f.artifactRegistry.resolveExecutionPolicy(promotion.published.policyRef);
    assert.equal(promoted.strategyRef, f.candidateRef);

    // Provenance reconstruction still resolves the full chain.
    const store = createInMemoryHowEvolutionArtifactStore();
    const protocolRef = await store.put("protocol", f.protocol);
    const evaluationRef = await store.put("evaluation-result", evaluation);
    const proposalRef = await store.put("promotion-proposal", proposal);
    const decisionRef = await store.put("rollback-decision", rollback.decision);
    const provenance = await resolveHowEvolutionProvenance({
      artifactStore: store,
      artifactRegistry: f.artifactRegistry,
      executionPolicyStore: f.policyStore,
      policySubjectKey: f.key,
      protocolRef,
      evaluationRef,
      proposalRef,
      decisionRef
    });
    assert.equal(provenance.decision.kind, HOW_EVOLUTION_ROLLBACK_KIND);
    assert.equal(provenance.headStrategy.strategyId, "how.baseline");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-7 negative: rollback to a non-accepted strategy is rejected", async () => {
  const f = await rollbackFixture();
  try {
    const { evaluation, promotion } = await promoteFixture(f);
    await assert.rejects(
      publishHowEvolutionRollback(rollbackArgs(f, promotion, evaluation, {
        targetStrategyRef: f.candidateRef,
        targetStrategyDigest: `sha256:${f.candidateRef.slice(f.candidateRef.lastIndexOf(":") + 1)}`
      })),
      /rollback target must equal the exact accepted baseline/
    );
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 2);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-7 negative: rollback never rewrites prior history", async () => {
  const f = await rollbackFixture();
  try {
    const { evaluation, promotion } = await promoteFixture(f);
    const before = await f.artifactRegistry.resolveExecutionPolicy(promotion.published.policyRef);
    await publishHowEvolutionRollback(rollbackArgs(f, promotion, evaluation));
    const after = await f.artifactRegistry.resolveExecutionPolicy(promotion.published.policyRef);
    assert.deepEqual(after, before);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-7 negative: forged reversed promotion lineage is rejected", async () => {
  const f = await rollbackFixture();
  try {
    const { evaluation, promotion } = await promoteFixture(f);
    const forged = { ...promotion.decision, authority: "candidate-builder" };
    await assert.rejects(
      publishHowEvolutionRollback(rollbackArgs(f, promotion, evaluation, { reversedPromotion: forged })),
      /reversed promotion authority mismatch/
    );
    const mismatched = { ...promotion.decision, evaluationDigest: "sha256:" + "0".repeat(64) };
    await assert.rejects(
      publishHowEvolutionRollback(rollbackArgs(f, promotion, evaluation, { reversedPromotion: mismatched })),
      /does not bind the reversed evaluation/
    );
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 2);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-7 negative: rollback against a moved current head is refused", async () => {
  const f = await rollbackFixture();
  try {
    const { evaluation, promotion } = await promoteFixture(f);
    // An independent newer generation lands after the reversed promotion.
    await f.policyPublisher.publish({
      publisher: { identity: "rollback-authority" },
      policy: {
        policyId: f.key, generation: 3, domain: f.protocol.domain, workloadType: f.protocol.workloadType,
        compatibleWorkContractVersions: [1], strategyRef: f.baselineRef
      }
    });
    await assert.rejects(
      publishHowEvolutionRollback(rollbackArgs(f, promotion, evaluation)),
      /current head does not match the reversed promotion head/
    );
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 3);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("AC-7 negative: candidate producer and evaluator cannot roll back", async () => {
  const f = await rollbackFixture();
  try {
    const { evaluation, promotion } = await promoteFixture(f);
    await assert.rejects(
      publishHowEvolutionRollback(rollbackArgs(f, promotion, evaluation, { publisher: { identity: "candidate-builder" } })),
      /protocol promotion authority/
    );
    await assert.rejects(
      publishHowEvolutionRollback(rollbackArgs(f, promotion, evaluation, { publisher: { identity: "independent-evaluator" } })),
      /protocol promotion authority|evaluator cannot roll back/
    );
    const head = await f.policyStore.current(f.key);
    assert.equal(head.value.generation, 2);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});

const FRESH_CHILD_SCRIPT = [
  "const { readFileSync } = await import('node:fs');",
  "const manifest = JSON.parse(readFileSync(process.argv[1], 'utf8'));",
  "const howEvolution = await import(manifest.modules.howEvolution);",
  "const domainStore = await import(manifest.modules.domainExecutionStore);",
  "const immutableModule = await import(manifest.modules.organizationArtifactStore);",
  "const core = await import(manifest.modules.coreIndex);",
  "const check = (condition, message) => { if (!condition) throw new Error('child reconstruction failed: ' + message); };",
  "const howStore = howEvolution.createJsonHowEvolutionArtifactStore({ path: manifest.paths.howStore });",
  "const immutable = immutableModule.createJsonImmutableArtifactStore({ path: manifest.paths.immutable });",
  "const artifactRegistry = domainStore.createDomainExecutionArtifactRegistry({ store: immutable });",
  "const policyStore = domainStore.createJsonDomainExecutionPolicyStore({ path: manifest.paths.policy });",
  "const protocol = await howStore.resolve(manifest.refs.protocolRef);",
  "check(core.digestValue(protocol) === manifest.expected.protocolDigest, 'protocol digest');",
  "const baselineRun = await howStore.resolve(manifest.refs.baselineRunRef);",
  "const candidateRun = await howStore.resolve(manifest.refs.candidateRunRef);",
  "const jevReceipt = await howStore.resolve(manifest.refs.jevReceiptRef);",
  "const evaluation = await howStore.resolve(manifest.refs.evaluationRef);",
  "check(core.digestValue(baselineRun) === evaluation.baselineRunDigest, 'baseline run digest');",
  "check(core.digestValue(candidateRun) === evaluation.candidateRunDigest, 'candidate run digest');",
  "check(core.digestValue(jevReceipt) === evaluation.jevReceiptDigest, 'jev receipt digest');",
  "const proposal = await howStore.resolve(manifest.refs.proposalRef);",
  "check(proposal.evaluationDigest === core.digestValue(evaluation), 'proposal evaluation binding');",
  "const promotion = await howStore.resolve(manifest.refs.promotionRef);",
  "check(promotion.evaluationDigest === core.digestValue(evaluation), 'promotion evaluation binding');",
  "const rollback = await howStore.resolve(manifest.refs.rollbackRef);",
  "check(rollback.reversedPromotionDigest === core.digestValue(promotion), 'rollback promotion binding');",
  "check(rollback.reversedEvaluationDigest === core.digestValue(evaluation), 'rollback evaluation binding');",
  "const provenance = await howEvolution.resolveHowEvolutionProvenance({ artifactStore: howStore, artifactRegistry, executionPolicyStore: policyStore, policySubjectKey: manifest.subjectKey, protocolRef: manifest.refs.protocolRef, evaluationRef: manifest.refs.evaluationRef, proposalRef: manifest.refs.proposalRef, decisionRef: manifest.refs.rollbackRef });",
  "check(provenance.headPolicy.strategyRef === manifest.expected.baselineStrategyRef, 'head strategy');",
  "check(provenance.headStrategy.strategyId === 'how.baseline', 'head strategy id');",
  "process.stdout.write(JSON.stringify({ protocolDigest: core.digestValue(protocol), evaluationDigest: core.digestValue(evaluation), proposalDigest: core.digestValue(proposal), promotionDigest: core.digestValue(promotion), rollbackDigest: core.digestValue(rollback), headGeneration: provenance.policyHead.value.generation, headStrategyId: provenance.headStrategy.strategyId }));"
].join("\n");

test("AC-8: a fresh Node process reconstructs the durable ref+digest chain including promoted/rollback policy", async () => {
  const f = await rollbackFixture();
  try {
    const baselineRun = defineHowEvolutionEvaluationRun(runFor(f.protocol, "BASELINE", {}), f.protocol);
    const candidateRun = defineHowEvolutionEvaluationRun(runFor(f.protocol, "CANDIDATE", { holdout1: 0.9, holdout2: 0.9 }), f.protocol);
    const evaluation = evaluateHowEvolution({
      protocol: f.protocol,
      baselineRun,
      candidateRun,
      jevReceipt: jevReceiptFor(f.protocol, "PASS")
    });
    const proposal = createHowEvolutionPromotionProposal({ protocol: f.protocol, evaluation });
    const promotion = await publishHowEvolutionPromotion({
      protocol: f.protocol,
      evaluation,
      proposal,
      publisher: { identity: "rollback-authority" },
      policyPublisher: f.policyPublisher,
      artifactRegistry: f.artifactRegistry,
      executionPolicyStore: f.policyStore,
      currentness: freshReaders(f.protocol)
    });
    const rollback = await publishHowEvolutionRollback(rollbackArgs(f, promotion, evaluation));

    const howStorePath = join(f.dir, "how-artifacts");
    const howStore = createJsonHowEvolutionArtifactStore({ path: howStorePath });
    const refs = {
      protocolRef: await howStore.put("protocol", f.protocol),
      baselineRunRef: await howStore.put("evaluation-run", baselineRun),
      candidateRunRef: await howStore.put("evaluation-run", candidateRun),
      jevReceiptRef: await howStore.put("jev-receipt", jevReceiptFor(f.protocol, "PASS")),
      evaluationRef: await howStore.put("evaluation-result", evaluation),
      proposalRef: await howStore.put("promotion-proposal", proposal),
      promotionRef: await howStore.put("promotion-decision", promotion.decision),
      rollbackRef: await howStore.put("rollback-decision", rollback.decision)
    };
    const testDir = dirname(fileURLToPath(import.meta.url));
    const srcDir = join(testDir, "..", "src");
    const manifest = {
      modules: {
        howEvolution: pathToFileURL(join(srcDir, "how-evolution.js")).href,
        domainExecutionStore: pathToFileURL(join(srcDir, "domain-execution-store.js")).href,
        organizationArtifactStore: pathToFileURL(join(srcDir, "organization-artifact-store.js")).href,
        coreIndex: pathToFileURL(join(testDir, "..", "..", "core-harness", "src", "index.js")).href
      },
      paths: {
        howStore: howStorePath,
        immutable: join(f.dir, "artifacts.json"),
        policy: join(f.dir, "policy-heads.json")
      },
      subjectKey: f.key,
      refs,
      expected: {
        protocolDigest: digestValue(f.protocol),
        baselineStrategyRef: f.baselineRef
      }
    };
    const manifestPath = join(f.dir, "fresh-provenance-manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    const stdout = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", FRESH_CHILD_SCRIPT, manifestPath],
      { timeout: 60000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const reconstructed = JSON.parse(stdout);
    assert.equal(reconstructed.protocolDigest, digestValue(f.protocol));
    assert.equal(reconstructed.evaluationDigest, digestValue(evaluation));
    assert.equal(reconstructed.proposalDigest, digestValue(proposal));
    assert.equal(reconstructed.promotionDigest, digestValue(promotion.decision));
    assert.equal(reconstructed.rollbackDigest, digestValue(rollback.decision));
    assert.equal(reconstructed.headGeneration, 3);
    assert.equal(reconstructed.headStrategyId, "how.baseline");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
