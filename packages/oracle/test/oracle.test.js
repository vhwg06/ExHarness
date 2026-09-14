import assert from "node:assert/strict";
import test from "node:test";

import { createOracle } from "../src/index.js";
import { registerOracleMcpResources } from "../src/mcp.js";

function fixtureState() {
  return {
    schemaVersion: 3,
    revision: 7,
    id: "work-1",
    work: { objective: "ship oracle" },
    currentCandidate: { id: "candidate", version: "v2" },
    persistentMemory: {
      implementations: [{}, {}],
      observations: [{ id: "o1" }],
      verifications: [{ id: "v1" }],
      evaluations: [{ id: "e1" }],
      knowledge: [{ id: "k1" }],
      variations: [{ id: "var1" }],
      searchInvestmentDecisions: [{ id: "s1" }],
      evidenceArtifacts: [{ id: "ev1" }],
      decisionArtifacts: [{ id: "d1" }],
      attestations: [{ id: "a1" }],
      lineage: [{ candidate: { id: "candidate", version: "v2" } }]
    },
    trajectory: [
      { id: "t1", type: "ONE" },
      { id: "t2", type: "TWO" },
      { id: "t3", type: "THREE" }
    ],
    supervision: {
      inspections: 2,
      skipped: 1,
      interventions: [{ id: "i1" }],
      lastDecision: { enabled: true }
    },
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T01:00:00.000Z"
  };
}

function createHarnessFixture() {
  const state = fixtureState();
  return {
    async workState(sessionId) {
      assert.equal(sessionId, "work-1");
      return structuredClone(state);
    },
    async trustArtifacts(sessionId) {
      assert.equal(sessionId, "work-1");
      return {
        evidence: [{ id: "ev1" }],
        decisions: [{ id: "d1" }],
        attestations: [{ id: "a1" }]
      };
    },
    async searchHealth(sessionId) {
      assert.equal(sessionId, "work-1");
      return { attentionSuggested: false, score: 1 };
    },
    async recoveryStatus(sessionId) {
      assert.equal(sessionId, "work-1");
      return { required: false };
    }
  };
}

test("oracle exposes bounded resource templates", () => {
  const oracle = createOracle({ harness: createHarnessFixture() });
  const templates = oracle.listResourceTemplates();

  assert.deepEqual(
    templates.map((item) => item.name),
    [
      "session-summary",
      "session-state",
      "session-trajectory",
      "session-trust",
      "session-search-health",
      "session-recovery"
    ]
  );
  assert.ok(templates.every((item) => item.mimeType === "application/json"));
});

test("summary is a bounded projection rather than a persistent-state dump", async () => {
  const oracle = createOracle({ harness: createHarnessFixture() });
  const result = await oracle.readResource("exharness://sessions/work-1/summary");

  assert.equal(result.value.id, "work-1");
  assert.equal(result.value.revision, 7);
  assert.equal(result.value.progress.trajectory.eventCount, 3);
  assert.equal(result.value.progress.trust.attestations, 1);
  assert.equal("persistentMemory" in result.value, false);
  assert.equal("trajectory" in result.value, false);
});

test("full state is available only through the explicit state resource", async () => {
  const oracle = createOracle({ harness: createHarnessFixture() });
  const result = await oracle.readResource("exharness://sessions/work-1/state");

  assert.equal(result.value.persistentMemory.observations.length, 1);
  result.value.persistentMemory.observations.push({ id: "mutated" });

  const reread = await oracle.readResource("exharness://sessions/work-1/state");
  assert.equal(reread.value.persistentMemory.observations.length, 1);
});

test("trajectory reads are caller-bounded and tail-select canonical events", async () => {
  const oracle = createOracle({ harness: createHarnessFixture(), maxTrajectoryItems: 3 });
  const result = await oracle.readResource("exharness://sessions/work-1/trajectory/2");

  assert.equal(result.value.limit, 2);
  assert.deepEqual(result.value.events.map((item) => item.id), ["t2", "t3"]);

  await assert.rejects(
    oracle.readResource("exharness://sessions/work-1/trajectory/4"),
    /trajectory limit must be <= 3/
  );
});

test("deterministic read projections stay separate", async () => {
  const oracle = createOracle({ harness: createHarnessFixture() });

  assert.deepEqual(
    (await oracle.readResource("exharness://sessions/work-1/trust")).value.attestations,
    [{ id: "a1" }]
  );
  assert.equal(
    (await oracle.readResource("exharness://sessions/work-1/search-health")).value.attentionSuggested,
    false
  );
  assert.equal(
    (await oracle.readResource("exharness://sessions/work-1/recovery")).value.required,
    false
  );
});

test("oracle rejects unknown or malformed resource URIs", async () => {
  const oracle = createOracle({ harness: createHarnessFixture() });

  await assert.rejects(oracle.readResource("https://sessions/work-1/summary"), /must use exharness/);
  await assert.rejects(oracle.readResource("exharness://runs/work-1/summary"), /host must be sessions/);
  await assert.rejects(oracle.readResource("exharness://sessions/work-1/nope"), /unknown oracle resource kind/);
});

test("MCP adapter registers only resources and delegates reads to Oracle", async () => {
  const oracle = createOracle({ harness: createHarnessFixture() });
  const registrations = [];

  class FakeResourceTemplate {
    constructor(template, options) {
      this.template = template;
      this.options = options;
    }
  }

  const server = {
    registerResource(name, template, metadata, read) {
      registrations.push({ name, template, metadata, read });
    }
  };

  const returned = registerOracleMcpResources({
    oracle,
    server,
    ResourceTemplate: FakeResourceTemplate
  });

  assert.equal(returned, server);
  assert.equal(registrations.length, oracle.listResourceTemplates().length);
  assert.ok(registrations.every((item) => item.template instanceof FakeResourceTemplate));

  const summary = registrations.find((item) => item.name === "session-summary");
  const response = await summary.read(new URL("exharness://sessions/work-1/summary"));

  assert.equal(response.contents.length, 1);
  assert.equal(response.contents[0].mimeType, "application/json");
  assert.equal(JSON.parse(response.contents[0].text).revision, 7);
  assert.equal(response.contents[0].text.includes("\n"), false);
});
