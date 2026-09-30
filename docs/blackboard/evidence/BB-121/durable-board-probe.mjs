#!/usr/bin/env node
// Executed capability probe: durable Backend→QA never calls agent-tools.
// Credential-free; reads delivered sources and public exports only.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDurableBackendQaWorkflow } from "../../../../packages/agentic-system/src/durable-backend-qa.js";
import { runBackendThenQaObjective } from "../../../../packages/agentic-system/src/composition.js";
import { BackendWorkStatus } from "../../../../packages/agentic-system/src/contracts.js";
import { runPreparedBackendObjective } from "../../../../packages/agentic-system/src/backend-application.js";
import { createBackendWorker } from "../../../../packages/agentic-system/src/backend-worker.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../../..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const durableSrc = read("packages/agentic-system/src/durable-backend-qa.js");
const compositionSrc = read("packages/agentic-system/src/composition.js");
const backendAppSrc = read("packages/agentic-system/src/backend-application.js");
const indexSrc = read("packages/agentic-system/src/index.js");
const hits = (src, re) => (src.match(re) || []).length;
const result = {
  kind: "BB-121_DURABLE_BOARD_PROBE_V1",
  createDurableBackendQaWorkflowExported: typeof createDurableBackendQaWorkflow === "function",
  runBackendThenQaObjectiveExported: typeof runBackendThenQaObjective === "function",
  runPreparedBackendObjectiveExported: typeof runPreparedBackendObjective === "function",
  createBackendWorkerExported: typeof createBackendWorker === "function",
  BackendWorkStatus,
  durableParamList: (durableSrc.match(/export function createDurableBackendQaWorkflow\(\{([^}]+)\}/s) || [null, ""])[1].replace(/\s+/g, " ").trim(),
  durableAgentToolsHits: hits(durableSrc, /agent-tools|runSupervised|supervised-backend|runSupervisedBackendWork/g),
  compositionAgentToolsHits: hits(compositionSrc, /agent-tools|runSupervised|supervised-backend|runSupervisedBackendWork/g),
  durableCallsRunPrepared: durableSrc.includes("runPreparedBackendObjective"),
  durableCallsRecoverPrepared: durableSrc.includes("recoverPreparedBackendObjective"),
  durablePassesBackendWorker: durableSrc.includes("backendWorker,"),
  preparedRequiresExecute: backendAppSrc.includes("runPreparedBackendObjective requires backendWorker.execute()"),
  recoverRequiresRecover: backendAppSrc.includes("recoverPreparedBackendObjective requires backendWorker.recover()"),
  indexReexportsDurable: indexSrc.includes("createDurableBackendQaWorkflow"),
  indexReexportsSupervisedBackend: indexSrc.includes("runSupervisedBackendWork"),
  supervisedBackendFileExists: false
};
try {
  read("packages/agentic-system/src/supervised-backend.js");
  result.supervisedBackendFileExists = true;
} catch {
  result.supervisedBackendFileExists = false;
}
writeFileSync(join(here, "durable-board-probe-result.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);
