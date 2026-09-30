// Per-tool pre-registration on the shared benchmark kernel (@exharness/benchmark package root).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBenchmarkUnit, createExperimentRegistration } from "../../../benchmark/src/index.js";
import { ARMS, assertMatchedFactors } from "./arms.js";

export const PROTOCOL_ID = "AGENT_TOOLS_VALUE_V1";
export const EVALUATOR_IDENTITY = "hidden-command-verifier";
export const HIDDEN_ACCEPTANCE_RATE = 1;
export const DECISION_RULE = Object.freeze({
  statistic: "paired mean of 1[ACCEPTED](EXHARNESS_SUPERVISED) - 1[ACCEPTED](direct arm) per (task, repeat)",
  bootstrapSamples: 10000,
  confidence: 0.95,
  superior: "lower bound > 0",
  inferior: "upper bound < 0",
  otherwise: "INCONCLUSIVE"
});
export const REGISTRATION_FILE = "registration.json";

const sha = (value) => `sha256:${createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`;

export class RegistrationError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "RegistrationError";
    this.code = code;
  }
}

export const unitIdFor = (taskId, arm, repeatIndex) => `${taskId}.${arm}.r${repeatIndex}`;

/**
 * Builds one registration per tool plus one benchmark unit per (fixture x arm x repeat).
 * factorsByArm must be identical across arms (FACTOR_MISMATCH otherwise).
 */
export function createAgentToolsRegistration({
  toolId, suite, factorsByArm, repeats, seed, expectedToolVersion, maxInvocationsTotal = null, maxUsd = null,
  arms = ARMS, createdAt = new Date().toISOString()
}) {
  const factors = assertMatchedFactors(factorsByArm);
  const model = factors.model ?? "TOOL_DEFAULT";
  const protocolBody = {
    arms: [...arms], K: factors.K, timeoutMs: factors.timeoutMs, permissionProfile: factors.permissionProfile, model,
    R: repeats, seed, HIDDEN_ACCEPTANCE_RATE, D5: DECISION_RULE, maxInvocationsTotal, maxUsd
  };
  const budgetBody = { K: factors.K, timeoutMs: factors.timeoutMs, maxInvocationsTotal, maxUsd };
  const budgetHash = sha(budgetBody);
  const producerProfileHash = sha({ tool: toolId, model, permissionProfile: factors.permissionProfile, expectedToolVersion });
  const plan = [];
  for (const fixture of suite.fixtures) {
    for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
      for (const arm of arms) plan.push({ fixture, arm, repeatIndex, unitId: unitIdFor(fixture.id, arm, repeatIndex) });
    }
  }
  const registration = createExperimentRegistration({
    experimentId: `agent-tools-value:${toolId}`,
    protocol: { id: PROTOCOL_ID, version: "1", hash: sha(protocolBody) },
    sourceIdentity: `agent-tools-suite:${suite.suiteDigest}`,
    workloadManifest: { ref: suite.ref, digest: suite.suiteDigest },
    environmentIdentity: `local-node:${process.version}`,
    producerProfile: { id: toolId, hash: producerProfileHash },
    resourceBudget: { id: `agent-tools-budget:${toolId}`, hash: budgetHash },
    artifactPolicy: { declared: ["artifacts/candidate.patch"] },
    evaluatorIdentity: EVALUATOR_IDENTITY,
    resetPolicy: { freshTrialPerAttempt: true, freshWorktreePerAttempt: true, hiddenOnlyInEvaluationCheckout: true },
    unitIds: plan.map((item) => item.unitId),
    createdAt
  });
  const units = plan.map(({ fixture, arm, repeatIndex, unitId }) => ({
    fixture,
    unit: createBenchmarkUnit({
      unitId,
      experimentId: registration.experimentId,
      task: { id: fixture.id, bundleDigest: fixture.bundleDigest },
      environmentIdentity: registration.environmentIdentity,
      instructionDigest: fixture.instructionDigest,
      producerProfile: toolId,
      repeatIndex,
      arm,
      budgetProfileHash: budgetHash
    }, { registration })
  }));
  return { registration, units, factors, protocolBody };
}

/**
 * Writes registration.json before any attempt starts. An existing registration.json with a
 * different digest, or an expected digest that differs, refuses the start.
 */
export async function persistRegistration(out, registration, { expectedRegistrationDigest = null } = {}) {
  if (expectedRegistrationDigest !== null && expectedRegistrationDigest !== registration.registrationDigest) {
    throw new RegistrationError("REGISTRATION_MISMATCH", `expected ${expectedRegistrationDigest}, computed ${registration.registrationDigest}`);
  }
  const path = join(out, REGISTRATION_FILE);
  if (existsSync(path)) {
    const existing = JSON.parse(await readFile(path, "utf8"));
    if (existing.registrationDigest !== registration.registrationDigest) {
      throw new RegistrationError("REGISTRATION_MISMATCH", `${path} holds ${existing.registrationDigest}, this run computes ${registration.registrationDigest}`);
    }
    throw new RegistrationError("REGISTRATION_EXISTS", `${path} already exists; use a fresh --out directory`);
  }
  await mkdir(out, { recursive: true });
  await writeFile(path, `${JSON.stringify(registration, null, 2)}\n`, { flag: "wx" });
  return path;
}

/** Refuses when the live tool version differs from the pre-registered expectation. */
export function assertToolVersion(expectedToolVersion, liveToolVersion) {
  if (expectedToolVersion !== null && expectedToolVersion !== undefined && expectedToolVersion !== liveToolVersion) {
    throw new RegistrationError("TOOL_VERSION_MISMATCH", `registered ${expectedToolVersion}, live ${liveToolVersion ?? "unknown"}`);
  }
}
