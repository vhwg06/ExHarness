import test from "node:test";
import assert from "node:assert/strict";

import {
  HOW_IMPROVEMENT_PROPOSAL_KIND,
  PINNED_OPTIMIZER_IDENTITY,
  defineHowImprovementProposal,
} from "../src/improvement-proposal.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);

const refFor = (name, digest) => `${name}:sha256:${digest}`;

function validProposal(overrides = {}) {
  return {
    kind: HOW_IMPROVEMENT_PROPOSAL_KIND,
    version: 1,
    patternProjectionRef: refFor(
      "artifact:improvement-pattern-projection",
      SHA_A,
    ),
    patternProjectionDigest: SHA_A,
    patternKey: "pattern-key-001",
    patternClassification: "RECURRING",
    cohortEpisodeRefs: [
      refFor("artifact:feedback-episode", SHA_B),
      refFor("artifact:feedback-episode-2", SHA_C),
    ],
    baselineHow: {
      policyHeadRef: "policy-head:gen-7",
      strategyRef: refFor("artifact:execution-strategy", SHA_D),
      strategyDigest: SHA_D,
    },
    allowedHowAxis: "execution-strategy",
    optimizer: {
      engine: PINNED_OPTIMIZER_IDENTITY.engine,
      version: PINNED_OPTIMIZER_IDENTITY.version,
      commit: PINNED_OPTIMIZER_IDENTITY.commit,
      configDigest: SHA_E,
    },
    candidate: {
      strategyRef: refFor("artifact:execution-strategy-candidate", SHA_B),
      digest: SHA_B,
      diff: { temperature: 0.7, maxSteps: 12 },
    },
    developmentEvidenceRefs: [refFor("artifact:benchmark-attempt", SHA_C)],
    benchmarkAttemptRefs: [],
    ...overrides,
  };
}

test("valid proposal passes and is deeply frozen", () => {
  const proposal = defineHowImprovementProposal(validProposal());
  assert.equal(proposal.kind, HOW_IMPROVEMENT_PROPOSAL_KIND);
  assert.equal(proposal.version, 1);
  assert.equal(proposal.patternClassification, "RECURRING");
  assert.equal(proposal.allowedHowAxis, "execution-strategy");
  assert.deepEqual(proposal.optimizer, {
    engine: "gepa",
    version: "0.1.4",
    commit: "d771eb21b5dd3228bc3f567293d2ccfc423fc900",
    configDigest: SHA_E,
  });
  assert.ok(Object.isFrozen(proposal));
  assert.ok(Object.isFrozen(proposal.baselineHow));
  assert.ok(Object.isFrozen(proposal.optimizer));
  assert.ok(Object.isFrozen(proposal.candidate));
  assert.ok(Object.isFrozen(proposal.candidate.diff));
  assert.ok(Object.isFrozen(proposal.cohortEpisodeRefs));
});

test("SYSTEMIC pattern is eligible", () => {
  const proposal = defineHowImprovementProposal(
    validProposal({ patternClassification: "SYSTEMIC" }),
  );
  assert.equal(proposal.patternClassification, "SYSTEMIC");
});

test("INSTANCE pattern is rejected as ineligible", () => {
  assert.throws(
    () => defineHowImprovementProposal(validProposal({ patternClassification: "INSTANCE" })),
    /INSTANCE_INELIGIBLE/,
  );
});

test("unknown classification is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(validProposal({ patternClassification: "WEEKLY" })),
    /patternClassification/,
  );
});

test("allowedHowAxes array form is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({ allowedHowAxes: ["a", "b"] }),
      ),
    /MULTIPLE_HOW_AXES/,
  );
});

test("second axis field is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({ howAxis: "another-axis" }),
      ),
    /MULTIPLE_HOW_AXES/,
  );
});

test("missing allowedHowAxis is rejected", () => {
  const raw = validProposal();
  delete raw.allowedHowAxis;
  assert.throws(
    () => defineHowImprovementProposal(raw),
    /allowedHowAxis/,
  );
});

test("optimizer commit mismatch is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({
          optimizer: {
            engine: "gepa",
            version: "0.1.4",
            commit: "d771eb21b5dd3228bc3f567293d2ccfc423fc901",
            configDigest: SHA_E,
          },
        }),
      ),
    /OPTIMIZER_IDENTITY_MISMATCH/,
  );
});

test("optimizer engine mismatch is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({
          optimizer: {
            engine: "gepa-full",
            version: "0.1.4",
            commit: PINNED_OPTIMIZER_IDENTITY.commit,
            configDigest: SHA_E,
          },
        }),
      ),
    /OPTIMIZER_IDENTITY_MISMATCH/,
  );
});

test("optimizer version mismatch is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({
          optimizer: {
            engine: "gepa",
            version: "0.2.0",
            commit: PINNED_OPTIMIZER_IDENTITY.commit,
            configDigest: SHA_E,
          },
        }),
      ),
    /OPTIMIZER_IDENTITY_MISMATCH/,
  );
});

test("top-level accepted key is rejected", () => {
  assert.throws(
    () => defineHowImprovementProposal(validProposal({ accepted: true })),
    /FORBIDDEN_AUTHORITY_KEY/,
  );
});

test("nested promoted key inside candidate.diff is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({
          candidate: {
            strategyRef: refFor("artifact:execution-strategy-candidate", SHA_B),
            digest: SHA_B,
            diff: { tuning: { promoted: true } },
          },
        }),
      ),
    /FORBIDDEN_AUTHORITY_KEY/,
  );
});

test("deeply nested verdict key is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({
          candidate: {
            strategyRef: refFor("artifact:execution-strategy-candidate", SHA_B),
            digest: SHA_B,
            diff: { a: { b: { c: { verdict: "PASS" } } } },
          },
        }),
      ),
    /FORBIDDEN_AUTHORITY_KEY/,
  );
});

test("key carrying promot semantics is rejected", () => {
  assert.throws(
    () => defineHowImprovementProposal(validProposal({ selfPromote: true })),
    /FORBIDDEN_AUTHORITY_KEY/,
  );
});

test("exact policyHead key is rejected while policyHeadRef stays legitimate", () => {
  assert.throws(
    () => defineHowImprovementProposal(validProposal({ policyHead: {} })),
    /FORBIDDEN_AUTHORITY_KEY/,
  );
  // policyHeadRef is a required legitimate field; a valid proposal passes.
  const proposal = defineHowImprovementProposal(validProposal());
  assert.equal(proposal.baselineHow.policyHeadRef, "policy-head:gen-7");
});

test("policyMutation key is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({ policyMutation: { generation: 8 } }),
      ),
    /FORBIDDEN_AUTHORITY_KEY/,
  );
});

test("approved key is rejected", () => {
  assert.throws(
    () => defineHowImprovementProposal(validProposal({ approved: "jev" })),
    /FORBIDDEN_AUTHORITY_KEY/,
  );
});

test("strategy ref/digest mismatch is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({
          candidate: {
            strategyRef: refFor("artifact:execution-strategy-candidate", SHA_B),
            digest: SHA_C,
            diff: {},
          },
        }),
      ),
    /REF_DIGEST_MISMATCH/,
  );
});

test("pattern projection ref/digest mismatch is rejected", () => {
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({ patternProjectionDigest: SHA_B }),
      ),
    /REF_DIGEST_MISMATCH/,
  );
});

test("empty cohortEpisodeRefs is rejected", () => {
  assert.throws(
    () => defineHowImprovementProposal(validProposal({ cohortEpisodeRefs: [] })),
    /cohortEpisodeRefs/,
  );
});

test("wrong kind is rejected", () => {
  assert.throws(
    () => defineHowImprovementProposal(validProposal({ kind: "OTHER_KIND" })),
    /kind/,
  );
});

test("wrong version is rejected", () => {
  assert.throws(
    () => defineHowImprovementProposal(validProposal({ version: 2 })),
    /version/,
  );
});

test("non-JSON-safe candidate diff is rejected", () => {
  const diff = { nested: {} };
  diff.nested.self = diff;
  assert.throws(
    () =>
      defineHowImprovementProposal(
        validProposal({
          candidate: {
            strategyRef: refFor("artifact:execution-strategy-candidate", SHA_B),
            digest: SHA_B,
            diff,
          },
        }),
      ),
    /JSON-safe/,
  );
});
