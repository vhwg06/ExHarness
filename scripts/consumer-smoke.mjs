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
  Agent,
  ClaimStatus,
  EvaluationValidity,
  EvaluationVerdict,
  ObjectAgentMemberKind,
  TrustBoundary,
  agenticMethod,
  createAttestationIssuer,
  createDecisionArtifact,
  createEvidenceArtifact,
  createHarness,
  createInMemorySessionStore,
  createObjectAgent,
  defineSubject,
  defineTrustPolicy,
  environmentRefFromValue,
  evaluateTrustBoundary,
  getObjectAgentRuntime,
  objectAgentSurface,
  policyRefFromValue
} from "exharness";
import { verifySessionStoreContract } from "exharness/testing";

await verifySessionStoreContract(() => createInMemorySessionStore());

class PackagedObjectAgent extends Agent {
  constructor() {
    super();
    this.count = 0;
  }

  increment(delta) {
    this.count += delta;
    return this.count;
  }

  answer = agenticMethod({
    strategy: {
      kind: "PACKAGED_OBJECT_AGENT",
      async run({ input, invoke }) {
        return invoke("increment", input);
      }
    },
    parseOutput(value) {
      if (!Number.isInteger(value)) throw new TypeError("integer result required");
      return value;
    }
  });
}

const rawObjectAgent = new PackagedObjectAgent();
const objectAgent = createObjectAgent(rawObjectAgent);
if (objectAgent !== rawObjectAgent) throw new Error("object agent identity changed");
if (await objectAgent.answer(2) !== 2) throw new Error("object agent method did not execute");
if (await objectAgent.answer(3) !== 5) throw new Error("object agent state did not stay live");
const objectCapabilities = getObjectAgentRuntime(objectAgent).capabilities().map((item) => item.name);
if (JSON.stringify(objectCapabilities) !== JSON.stringify(["increment"])) {
  throw new Error(`unexpected object capabilities: ${JSON.stringify(objectCapabilities)}`);
}
const objectSurface = objectAgentSurface(objectAgent);
if (!objectSurface.members.some((item) => item.name === "increment" && item.kind === ObjectAgentMemberKind.DETERMINISTIC)) {
  throw new Error("deterministic object method missing from packaged surface");
}
if (!objectSurface.members.some((item) => item.name === "answer" && item.kind === ObjectAgentMemberKind.AGENTIC)) {
  throw new Error("agentic object method missing from packaged surface");
}

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
const trust = await evaluateTrustBoundary({
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
  verifySignature: ({ payloadDigest, signature }) => signature.value === payloadDigest,
  verifyEvaluatorAuthority: ({ evaluator }) => evaluator.identity === "consumer-evaluator",
  verifyEvidenceAuthority: ({ producer }) => producer.identity === "consumer-verifier"
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
