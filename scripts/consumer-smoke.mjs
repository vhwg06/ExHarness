import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), "exharness-consumer-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

try {
  const packOutput = run("npm", ["pack", "./packages/core-harness", "--pack-destination", temp, "--json"]);
  const packed = JSON.parse(packOutput);
  const tarball = join(temp, packed[0].filename);
  await writeFile(join(temp, "package.json"), JSON.stringify({
    private: true,
    type: "module",
    dependencies: { exharness: `file:${tarball}` }
  }, null, 2));
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: temp });

  const consumer = `
import {
  AVOCapability,
  ClaimStatus,
  EvaluationValidity,
  EvaluationVerdict,
  TrustBoundary,
  createAttestationIssuer,
  createDecisionArtifact,
  createEvidenceArtifact,
  createHarness,
  createInMemorySessionStore,
  defineSubject,
  defineTrustPolicy,
  environmentRefFromValue,
  evaluateAttestationTrust,
  policyRefFromValue
} from "exharness";
import { verifySessionStoreContract } from "exharness/testing";

await verifySessionStoreContract(() => createInMemorySessionStore());

const harness = createHarness({
  strategy: {
    async run({ invoke }) {
      await invoke(AVOCapability.ACT, { nextVersion: "v1" });
      await invoke(AVOCapability.EVALUATE);
      await invoke(AVOCapability.PROMOTE);
    }
  },
  environment: {
    async observe() { return null; },
    async act({ candidate, action, actionKey }) {
      if (typeof actionKey !== "string") throw new Error("missing action idempotency key");
      return { mutated: true, candidate: { id: candidate.id, version: action.nextVersion } };
    }
  },
  objective: {
    async evaluate() {
      return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.PASS };
    }
  }
});
await harness.start({
  sessionId: "consumer",
  work: { objective: "prove package import" },
  seedCandidate: { id: "candidate", version: "v0" }
});
const result = await harness.vary("consumer");
if (!result.lineage.advanced) throw new Error("consumer harness did not promote");

const subject = defineSubject({
  type: "git-commit",
  digest: "abc123",
  producer: { identity: "change-author", roles: ["author"] }
});
const evidenceEnvironment = environmentRefFromValue({ image: "verify@sha256:1" }, { name: "verify" });
const attestationEnvironment = environmentRefFromValue({ image: "attest@sha256:2" }, { name: "attest" });
const evidence = [createEvidenceArtifact({
  subject,
  kind: "SMOKE",
  producer: { identity: "consumer-verifier", roles: ["verifier"] },
  environment: evidenceEnvironment,
  generatedAt: "2026-09-11T00:00:00.000Z",
  content: { ok: true }
})];
const policy = policyRefFromValue("consumer-policy", { required: ["smoke"] });
const decision = createDecisionArtifact({
  subject,
  boundary: TrustBoundary.VERIFICATION,
  policy,
  evaluator: { identity: "consumer-evaluator", roles: ["evaluator"] },
  evidence,
  claims: [{ name: "smoke", status: ClaimStatus.SATISFIED }],
  verdict: "READY",
  generatedAt: "2026-09-11T00:00:01.000Z"
});
const issuer = createAttestationIssuer({
  identity: "consumer-attestor",
  roles: ["attestor"],
  async sign({ payloadDigest }) { return { value: payloadDigest }; }
});
const attestation = await issuer.issue({
  decision,
  environment: attestationEnvironment,
  issuedAt: "2026-09-11T00:00:02.000Z"
});
const trust = await evaluateAttestationTrust({
  attestation,
  decision,
  currentSubject: subject,
  evidence,
  policy: defineTrustPolicy({
    acceptedIssuers: ["consumer-attestor"],
    acceptedPolicyDigests: [policy.digest],
    acceptedEvaluators: ["consumer-evaluator"],
    acceptedEvidenceProducers: ["consumer-verifier"],
    requiredClaims: ["smoke"],
    requireIndependentIssuer: true,
    requireIndependentEvidenceProducers: true
  }),
  verifySignature: ({ payloadDigest, signature }) => signature.value === payloadDigest
});
if (!trust.trusted) throw new Error(JSON.stringify(trust.reasons));
console.log("consumer-smoke:ok");
`;
  await writeFile(join(temp, "consumer.mjs"), consumer);
  const output = run("node", ["consumer.mjs"], { cwd: temp });
  if (!output.includes("consumer-smoke:ok")) throw new Error(`unexpected consumer output: ${output}`);
  console.log("consumer-smoke:ok");
} finally {
  await rm(temp, { recursive: true, force: true });
}
