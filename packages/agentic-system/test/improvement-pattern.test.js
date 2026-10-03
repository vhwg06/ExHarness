// BB-086 I2 — tests for improvement-pattern.js (SI1, INV-1, INV-2).
//
// Negative verification cases: digest-mismatch rejection, retry dedup,
// SUPERSEDED-via-successor, UNMAPPED_AXIS exclusion, false SYSTEMIC,
// contrary retention, reinforcement without escalation, no write port,
// determinism, invalid-resolution rejection.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { PATTERN_POLICY_V1, projectImprovementPatterns } = await import(
  "../src/improvement-pattern.js"
);

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Pinned ref compatible with assertRefDigest: ref ends with :sha256:<digest>.
function pin(name) {
  const digest = sha256Hex(`bb086-fixture-${name}`);
  return { ref: `bbx/${name}:sha256:${digest}`, digest };
}

function makeResolutionFixture({ tag, outcome = "IMPROVED", episodeRef, episodeDigest }) {
  const r = pin(`res-${tag}`);
  const fr = pin(`fr-${tag}`);
  const raw = {
    kind: "FEEDBACK_RESOLUTION_V1",
    version: 1,
    episodeRef,
    episodeDigest,
    finalResponseRef: fr.ref,
    finalResponseDigest: fr.digest,
    outcomeRef: null,
    outcomeDigest: null,
    resolution: outcome,
    principalAuthorityRef: "bb-085-principal",
  };
  if (outcome === "IMPROVED" || outcome === "NO_CHANGE" || outcome === "REGRESSED") {
    const o = pin(`out-${tag}`);
    raw.outcomeRef = o.ref;
    raw.outcomeDigest = o.digest;
  }
  return { ref: r.ref, digest: r.digest, artifact: raw };
}

function makeEpisodeFixture({ tag, scopeKey = "cohort-alpha", findingKind = "MISSING_EVIDENCE", obsRefs = ["obs-1"], contraryRefs = [] }) {
  const e = pin(`ep-${tag}`);
  return {
    ref: e.ref,
    digest: e.digest,
    artifact: {
      kind: "FEEDBACK_EPISODE_V1",
      version: 1,
      groundedInputRefs: obsRefs.map((o) => ({ ref: `obs/${o}`, digest: sha256Hex(`obs-${o}`) })),
      finding: { kind: findingKind, statement: `finding ${tag}` },
      scopeKey,
      contraryEvidenceRefs: contraryRefs.map((c) => ({ ref: c, digest: sha256Hex(`contrary-${c}`) })),
    },
  };
}

// store: Map ref -> { artifact, digest }; throws on digest mismatch.
function store(fixtures) {
  const map = new Map(fixtures.map((f) => [f.ref, { artifact: f.artifact, digest: f.digest }]));
  return (ref, digest) => {
    const entry = map.get(ref);
    if (!entry || entry.digest !== digest) throw new Error("DIGEST_MISMATCH");
    return entry.artifact;
  };
}

function pair(tag, { outcome = "IMPROVED", findingKind = "MISSING_EVIDENCE", obsRefs = ["obs-1"], scopeKey = "cohort-alpha", contraryRefs = [] } = {}) {
  const ep = makeEpisodeFixture({ tag, scopeKey, findingKind, obsRefs, contraryRefs });
  const res = makeResolutionFixture({ tag, outcome, episodeRef: ep.ref, episodeDigest: ep.digest });
  return { res, ep };
}

describe("PATTERN_POLICY_V1", () => {
  it("is frozen with version 1, minSupport 2, and an initial finding-kind map", () => {
    assert.ok(Object.isFrozen(PATTERN_POLICY_V1));
    assert.ok(Object.isFrozen(PATTERN_POLICY_V1.findingKindToHowAxis));
    assert.equal(PATTERN_POLICY_V1.version, 1);
    assert.equal(PATTERN_POLICY_V1.minSupport, 2);
    assert.equal(PATTERN_POLICY_V1.findingKindToHowAxis.MISSING_EVIDENCE, "evidence");
    assert.equal(PATTERN_POLICY_V1.findingKindToHowAxis.STALE_CONTEXT, "context");
    assert.equal(PATTERN_POLICY_V1.findingKindToHowAxis.WEAK_ACCEPTANCE, "acceptance");
    assert.equal(PATTERN_POLICY_V1.findingKindToHowAxis.FLAKY_VERIFICATION, "verification");
  });

  it("exposes no write port: module surface is exactly the two read-only exports", async () => {
    const keys = Object.keys(await import("../src/improvement-pattern.js"));
    assert.deepEqual(keys, ["PATTERN_POLICY_V1", "projectImprovementPatterns"]);
  });
});

describe("projectImprovementPatterns", () => {
  it("rejects a digest-mismatched resolution ref but still projects the rest", () => {
    const a = pair("a1", { obsRefs: ["obs-1"] });
    const b = pair("b1", { obsRefs: ["obs-2"] });
    const projection = projectImprovementPatterns({
      resolutions: [
        { ref: a.res.ref, digest: a.res.digest },
        { ref: b.res.ref, digest: "0".repeat(64) }, // wrong digest
      ],
      resolveArtifact: store([a.res, a.ep, b.res, b.ep]),
    });
    assert.equal(projection.patterns.length, 1);
    assert.deepEqual(
      projection.exclusions.map((e) => e.reason),
      ["DIGEST_MISMATCH"],
    );
    assert.equal(projection.exclusions[0].ref, b.res.ref);
  });

  it("counts a retried episode (same observation-ref set) as one support unit", () => {
    // Same grounded observation set, different episode -> deduped to one unit.
    const a = pair("dup-a", { obsRefs: ["obs-1", "obs-2"], outcome: "IMPROVED" });
    const retry = pair("dup-b", { obsRefs: ["obs-2", "obs-1"], outcome: "NO_CHANGE" });
    const projection = projectImprovementPatterns({
      resolutions: [
        { ref: a.res.ref, digest: a.res.digest },
        { ref: retry.res.ref, digest: retry.res.digest },
      ],
      resolveArtifact: store([a.res, a.ep, retry.res, retry.ep]),
    });
    assert.equal(projection.patterns.length, 1);
    const [pattern] = projection.patterns;
    assert.equal(pattern.supportUnits, 1);
    assert.equal(pattern.classification, "INSTANCE");
    // One unit counts once: only the first unit's outcome is tallied.
    const total = Object.values(pattern.outcomeCounts).reduce((s, n) => s + n, 0);
    assert.equal(total, 1);
    assert.equal(pattern.outcomeCounts.IMPROVED, 1);
  });

  it("lets a SUPERSEDED resolution contribute only through its successor", () => {
    const old = pair("sup-old", { obsRefs: ["obs-1"] });
    const succ = pair("sup-new", { obsRefs: ["obs-1"] }); // same unit, successor
    const projection = projectImprovementPatterns({
      resolutions: [
        { ref: old.res.ref, digest: old.res.digest },
        { ref: succ.res.ref, digest: succ.res.digest },
      ],
      resolveArtifact: store([old.res, old.ep, succ.res, succ.ep]),
      supersededBy: new Map([[old.res.ref, succ.res.ref]]),
    });
    assert.equal(projection.patterns.length, 1);
    assert.equal(projection.patterns[0].supportUnits, 1);
    assert.deepEqual(
      projection.exclusions.filter((e) => e.reason === "SUPERSEDED").map((e) => e.ref),
      [old.res.ref],
    );
  });

  it("excludes an unmapped finding kind with UNMAPPED_AXIS and never guesses an axis", () => {
    const mapped = pair("map-a", { findingKind: "MISSING_EVIDENCE", obsRefs: ["obs-1"] });
    const weird = pair("map-b", { findingKind: "NOVEL_KIND_X", obsRefs: ["obs-9"] });
    const projection = projectImprovementPatterns({
      resolutions: [
        { ref: mapped.res.ref, digest: mapped.res.digest },
        { ref: weird.res.ref, digest: weird.res.digest },
      ],
      resolveArtifact: store([mapped.res, mapped.ep, weird.res, weird.ep]),
    });
    assert.equal(projection.patterns.length, 1);
    assert.equal(projection.patterns[0].findingKind, "MISSING_EVIDENCE");
    assert.deepEqual(
      projection.exclusions.filter((e) => e.reason === "UNMAPPED_AXIS").map((e) => e.ref),
      [weird.res.ref],
    );
  });

  it("never classifies SYSTEMIC from frequency alone or partial mechanism coverage", () => {
    const mk = (tag, unit) => pair(tag, { obsRefs: [unit] });
    const e1 = mk("sys-a", "obs-1");
    const e2 = mk("sys-b", "obs-2");
    const fixtures = [e1.res, e1.ep, e2.res, e2.ep];
    const resolutions = [
      { ref: e1.res.ref, digest: e1.res.digest },
      { ref: e2.res.ref, digest: e2.res.digest },
    ];

    // No mechanism evidence at all -> RECURRING, not SYSTEMIC.
    const p0 = projectImprovementPatterns({ resolutions, resolveArtifact: store(fixtures) });
    assert.equal(p0.patterns[0].supportUnits, 2);
    assert.equal(p0.patterns[0].classification, "RECURRING");

    // Mechanism evidence covering only one of two episodes -> still RECURRING.
    const mechPartial = pin("mech-partial");
    const p1 = projectImprovementPatterns({
      resolutions,
      resolveArtifact: store([...fixtures, { ref: mechPartial.ref, digest: mechPartial.digest, artifact: { kind: "MECHANISM_EVIDENCE_V1" } }]),
      mechanismEvidence: [{ ref: mechPartial.ref, digest: mechPartial.digest, coveredEpisodeRefs: [e1.ep.ref] }],
    });
    assert.equal(p1.patterns[0].classification, "RECURRING");

    // Mechanism evidence covering EVERY supporting episode -> SYSTEMIC.
    const mechFull = pin("mech-full");
    const p2 = projectImprovementPatterns({
      resolutions,
      resolveArtifact: store([...fixtures, { ref: mechFull.ref, digest: mechFull.digest, artifact: { kind: "MECHANISM_EVIDENCE_V1" } }]),
      mechanismEvidence: [{ ref: mechFull.ref, digest: mechFull.digest, coveredEpisodeRefs: [e1.ep.ref, e2.ep.ref] }],
    });
    assert.equal(p2.patterns[0].classification, "SYSTEMIC");
  });

  it("retains NO_CHANGE/REGRESSED episodes and episode contrary refs in contraryEvidenceRefs", () => {
    const imp = pair("nc-a", { obsRefs: ["obs-1"], outcome: "IMPROVED", contraryRefs: ["ext-evidence-1"] });
    const nc = pair("nc-b", { obsRefs: ["obs-2"], outcome: "NO_CHANGE" });
    const reg = pair("nc-c", { obsRefs: ["obs-3"], outcome: "REGRESSED" });
    const projection = projectImprovementPatterns({
      resolutions: [
        { ref: imp.res.ref, digest: imp.res.digest },
        { ref: nc.res.ref, digest: nc.res.digest },
        { ref: reg.res.ref, digest: reg.res.digest },
      ],
      resolveArtifact: store([imp.res, imp.ep, nc.res, nc.ep, reg.res, reg.ep]),
    });
    const [pattern] = projection.patterns;
    const refs = pattern.contraryEvidenceRefs.map((p) => p.ref);
    assert.ok(refs.includes("ext-evidence-1"), "episode contrary ref retained");
    assert.ok(refs.includes(nc.ep.ref), "NO_CHANGE episode retained in contrary evidence");
    assert.ok(refs.includes(reg.ep.ref), "REGRESSED episode retained in contrary evidence");
    assert.equal(pattern.outcomeCounts.IMPROVED, 1);
    assert.equal(pattern.outcomeCounts.NO_CHANGE, 1);
    assert.equal(pattern.outcomeCounts.REGRESSED, 1);
  });

  it("reinforcement changes only support metadata and projectionId, never escalates authority", () => {
    const a = pair("re-a", { obsRefs: ["obs-1"], outcome: "IMPROVED" });
    const b = pair("re-b", { obsRefs: ["obs-2"], outcome: "NO_CHANGE" });
    const fixtures = [a.res, a.ep, b.res, b.ep];
    const baseResolutions = [{ ref: a.res.ref, digest: a.res.digest }];
    const grownResolutions = [...baseResolutions, { ref: b.res.ref, digest: b.res.digest }];

    const before = projectImprovementPatterns({ resolutions: baseResolutions, resolveArtifact: store(fixtures) });
    const after = projectImprovementPatterns({ resolutions: grownResolutions, resolveArtifact: store(fixtures) });

    assert.notEqual(before.projectionId, after.projectionId, "projectionId changes on new evidence");
    assert.equal(after.patterns[0].supportUnits, before.patterns[0].supportUnits + 1);
    assert.deepEqual(after.patterns[0].supportingEpisodeRefs.length, before.patterns[0].supportingEpisodeRefs.length + 1);
    assert.deepEqual(after.inputResolutionRefs, [...before.inputResolutionRefs, b.res.ref].sort());
    assert.equal(after.patterns[0].classification, "RECURRING");
    assert.notEqual(after.patterns[0].classification, "SYSTEMIC");

    // No accepted/promoted/approved/verdict/policy-head authority fields at any depth.
    for (const doc of [before, after]) {
      const text = JSON.stringify(doc);
      const hits = [...text.matchAll(/"(accepted|promoted|approved|verdict|policyHead)"/g)].map((m) => m[0]);
      assert.deepEqual(hits, [], `projection carries forbidden authority field(s): ${hits.join(",")}`);
    }
  });

  it("is deterministic: two runs over the same inputs are identical", () => {
    const a = pair("det-a", { obsRefs: ["obs-2"] });
    const b = pair("det-b", { obsRefs: ["obs-1"], outcome: "NO_CHANGE" });
    const fixtures = [a.res, a.ep, b.res, b.ep];
    const run = (order) =>
      projectImprovementPatterns({
        resolutions: order.map((f) => ({ ref: f.res.ref, digest: f.res.digest })),
        resolveArtifact: store(fixtures),
      });
    assert.equal(JSON.stringify(run([a, b])), JSON.stringify(run([b, a])));
  });

  it("skips and records an artifact that fails FEEDBACK_RESOLUTION_V1 validation", () => {
    const good = pair("inv-a", { obsRefs: ["obs-1"] });
    const bad = pin("bad-res");
    const projection = projectImprovementPatterns({
      resolutions: [
        { ref: good.res.ref, digest: good.res.digest },
        { ref: bad.ref, digest: bad.digest },
      ],
      resolveArtifact: store([
        good.res,
        good.ep,
        { ref: bad.ref, digest: bad.digest, artifact: { kind: "NOT_A_RESOLUTION", version: 1 } },
      ]),
    });
    assert.equal(projection.patterns.length, 1);
    assert.deepEqual(
      projection.exclusions.filter((e) => e.ref === bad.ref).map((e) => e.reason),
      ["INVALID_RESOLUTION"],
    );
  });

  it("returns a deeply frozen, read-only projection", () => {
    const a = pair("frz-a", { obsRefs: ["obs-1"] });
    const projection = projectImprovementPatterns({
      resolutions: [{ ref: a.res.ref, digest: a.res.digest }],
      resolveArtifact: store([a.res, a.ep]),
    });
    assert.equal(projection.kind, "IMPROVEMENT_PATTERN_PROJECTION_V1");
    assert.equal(projection.version, 1);
    assert.ok(/^[a-f0-9]{64}$/.test(projection.projectionId));
    assert.ok(Object.isFrozen(projection));
    assert.ok(Object.isFrozen(projection.patterns));
    assert.ok(Object.isFrozen(projection.patterns[0]));
    assert.ok(Object.isFrozen(projection.patterns[0].outcomeCounts));
    assert.throws(() => {
      projection.patterns[0].classification = "SYSTEMIC";
    }, TypeError);
  });
});
