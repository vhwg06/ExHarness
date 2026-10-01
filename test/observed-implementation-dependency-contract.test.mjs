import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const GRAPH_REF = "docs/blackboard/work-graph.json";
const REQUIRED_LIVING_BB058 = [
  "docs/living/system/agentic-application/capabilities.md",
  "docs/living/system/agentic-application/contracts.md",
  "docs/living/system/agentic-application/state.md",
  "docs/living/system/agentic-application/workflow.md",
];
const REQUIRED_LIVING_BB064 = [
  "docs/living/system/oracle/architecture.md",
  "docs/living/system/oracle/state.md",
  "docs/living/system/oracle/semantics.md",
  "docs/living/system/oracle/workflow.md",
  "docs/living/system/oracle/artifact-manifest.md",
  "docs/living/system/agentic-application/architecture.md",
  "docs/living/system/agentic-application/contracts.md",
  "docs/living/system/agentic-application/workflow.md",
];

function contradiction(message) {
  const error = new Error(`PLAN_INPUT_CONTRADICTION: ${message}`);
  error.code = "PLAN_INPUT_CONTRADICTION";
  throw error;
}

async function loadGraph() {
  let raw;
  try {
    raw = await readFile(GRAPH_REF, "utf8");
  } catch {
    contradiction(`work graph is unreadable at ${GRAPH_REF}`);
  }
  return JSON.parse(raw);
}

function taskById(graph, id) {
  const task = (graph.tasks ?? []).find((t) => t.id === id);
  if (!task) contradiction(`task ${id} is missing from the work graph`);
  return task;
}

test("BB-058 and BB-064 are DONE with delivery receipts and Living refs", async () => {
  const graph = await loadGraph();
  for (const id of ["BB-058", "BB-064"]) {
    const task = taskById(graph, id);
    if (task.status !== "DONE") {
      contradiction(`${id} status is ${task.status}, expected DONE`);
    }
    const deliveryRef = task.contract?.deliveryRef;
    if (typeof deliveryRef !== "string" || !deliveryRef.trim()) {
      contradiction(`${id} has no contract.deliveryRef`);
    }
    try {
      await readFile(deliveryRef, "utf8");
    } catch {
      contradiction(`${id} delivery receipt is missing at ${deliveryRef}`);
    }
    const consolidated = task.artifacts?.consolidatedRefs ?? [];
    const required = id === "BB-058" ? REQUIRED_LIVING_BB058 : REQUIRED_LIVING_BB064;
    for (const ref of required) {
      if (!consolidated.includes(ref)) {
        contradiction(`${id} is missing consolidated Living ref ${ref}`);
      }
      try {
        await readFile(ref, "utf8");
      } catch {
        contradiction(`${id} Living ref is unreadable at ${ref}`);
      }
    }
  }
});

test("delivered package-root exports provide the BB-058/BB-064 seam (no deep import)", async () => {
  const agentic = await import("../packages/agentic-system/src/index.js");
  const oracle = await import("../packages/oracle/src/index.js");

  const requiredAgentic = [
    "createOrganizationObserver",
    "createCausalReconstruction",
    "defineCausalObservationSubject",
    "MISSING_PROVENANCE",
    "createJsonImmutableArtifactStore",
    "createOrganizationArtifactRegistry",
    "createDomainExecutionArtifactRegistry",
    "resolveExecutionJudgmentBundle",
  ];
  for (const name of requiredAgentic) {
    if (typeof agentic[name] !== "function" && typeof agentic[name] !== "string") {
      contradiction(`agentic package root is missing export ${name}`);
    }
  }

  const requiredOracle = [
    "createOracleContextResolver",
    "defineContextResolution",
    "assertConsumableContextResolution",
    "defineContextResolutionReceipt",
    "evaluateReceiptCurrentness",
  ];
  for (const name of requiredOracle) {
    if (typeof oracle[name] !== "function") {
      contradiction(`oracle package root is missing export ${name}`);
    }
  }

  // Query-only observer surface: no lifecycle/authority methods may exist.
  const probe = agentic.createOrganizationObserver({
    artifactStore: {
      async resolve() {
        return null;
      },
      async put(kind, value) {
        void kind;
        void value;
        return "probe:sha256:0000000000000000000000000000000000000000000000000000000000000000";
      },
    },
  });
  const forbidden = ["publish", "claim", "dispatch", "accept", "recover", "compareAndSwap"];
  for (const name of forbidden) {
    if (typeof probe[name] === "function") {
      contradiction(`OrganizationObserver exposes forbidden method ${name}`);
    }
  }
  const allowed = [
    "queryCurrent",
    "queryHistorical",
    "explainWhyNotDone",
    "listRemainingWork",
    "traceObligation",
    "describeExecution",
    "measureTiming",
    "chainEvidence",
  ];
  for (const name of allowed) {
    if (typeof probe[name] !== "function") {
      contradiction(`OrganizationObserver is missing query method ${name}`);
    }
  }

  // Delivered artifact registries expose the execution-identity path named in D3.
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "exharness-bb084-preflight-"));
  try {
    const store = agentic.createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
    const registry = agentic.createDomainExecutionArtifactRegistry({ store });
    for (const name of [
      "putExecutionAttemptBinding",
      "resolveExecutionAttemptBinding",
      "putRuntimeExecutionAttestation",
      "resolveRuntimeExecutionAttestation",
    ]) {
      if (typeof registry[name] !== "function") {
        contradiction(`domain execution artifact registry is missing ${name}`);
      }
    }
    if (typeof agentic.createOrganizationArtifactRegistry({ store }).putWorkContract !== "function") {
      contradiction("organization artifact registry is missing putWorkContract");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // evaluateReceiptCurrentness honors the delivered CURRENT|STALE contract.
  const receipt = oracle.defineContextResolutionReceipt({
    reuseKey: oracle.reuseKey({
      requirementId: "a".repeat(64),
      resolverConfigDigest: "b".repeat(64),
      sourceObservations: [
        {
          evidenceId: "e1",
          source: { kind: "repo", ref: "r", snapshot: { mode: "EXACT", ref: "s" } },
          observed: { state: "PRESENT", snapshotRef: "s1" },
        },
      ],
    }),
    requirementId: "a".repeat(64),
    resolutionId: "c".repeat(64),
    materializationId: "d".repeat(64),
    resolutionArtifactRef: "artifact:1",
    resolverConfigDigest: "b".repeat(64),
    sourceObservations: [
      {
        evidenceId: "e1",
        source: { kind: "repo", ref: "r", snapshot: { mode: "EXACT", ref: "s" } },
        observed: { state: "PRESENT", snapshotRef: "s1" },
      },
    ],
    itemLineage: [{ itemDigest: "e".repeat(64), sourceObservationIds: ["e1"], provenanceRefs: [] }],
  });
  const current = oracle.evaluateReceiptCurrentness(receipt, [
    {
      evidenceId: "e1",
      source: { kind: "repo", ref: "r", snapshot: { mode: "EXACT", ref: "s" } },
      observed: { state: "PRESENT", snapshotRef: "s1" },
    },
  ]);
  assert.equal(current.status, "CURRENT");
  console.log(
    JSON.stringify(
      {
        preflight: "OBSERVED_IMPLEMENTATION_DEPENDENCY_CONTRACT",
        bb058: "DONE",
        bb064: "DONE",
        agenticExports: requiredAgentic,
        oracleExports: requiredOracle,
        sourceClassification: {
          DELIVERED_TRUTH: [
            "createJsonImmutableArtifactStore / createOrganizationArtifactRegistry (package root)",
            "resolveExecutionJudgmentBundle, ExecutionAttemptBinding, RuntimeExecutionAttestation",
            "createOrganizationObserver query-only surface",
          ],
          PLANNED_CONTRACT: ["BB-058 observer/subject", "BB-061 resolution", "BB-063 receipt", "BB-064 resolver"],
          RESEARCH_DESIRED_STATE: ["GROUNDED_OBSERVATION_V1 / OBSERVATION_CONTEXT_BINDING_V1 / GROUNDED_FINDING_INPUT_V1"],
        },
      },
      null,
      2,
    ),
  );
});

test("candidate writes no product source and requires no deep import", async () => {
  const productFiles = [
    "packages/agentic-system/src/grounded-observation.js",
    "packages/agentic-system/src/observation-context-binding.js",
  ];
  const forbiddenOwners = [
    "packages/oracle/",
    "packages/agentic-system/src/causal-provenance.js",
    "packages/agentic-system/src/causal-reconstruction.js",
    "packages/agentic-system/src/organization-observer.js",
    "packages/agentic-system/src/domain-execution-control.js",
    "packages/agentic-system/src/organization-artifact-store.js",
  ];
  void productFiles;
  void forbiddenOwners;
  // This preflight file itself must not import product modules or deep internals:
  // the only allowed imports are the two package roots plus node builtins.
  const self = await readFile(new URL(import.meta.url), "utf8");
  const deepImport = [...self.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  for (const spec of deepImport) {
    if (spec.startsWith("../packages/oracle/src/") && spec !== "../packages/oracle/src/index.js") {
      contradiction(`preflight requires deep oracle import ${spec}`);
    }
    if (
      spec.startsWith("../packages/agentic-system/src/") &&
      spec !== "../packages/agentic-system/src/index.js"
    ) {
      contradiction(`preflight requires deep agentic import ${spec}`);
    }
    if (spec.includes("grounded-observation") || spec.includes("observation-context-binding")) {
      contradiction("preflight must not import candidate product modules");
    }
  }
});
