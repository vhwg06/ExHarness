// Deterministic source probe for agent-tool productization gaps (BB-100..104).
// Reads delivered packages and the outer work-graph only. No provider calls, no process launches.
// Usage from repository root: node docs/blackboard/evidence/BB-100/productization-probe.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

function has(text, pattern) {
  return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
}

const files = {
  backendWorker: "packages/agentic-system/src/backend-worker.js",
  backendApplication: "packages/agentic-system/src/backend-application.js",
  composition: "packages/agentic-system/src/composition.js",
  durable: "packages/agentic-system/src/durable-backend-qa.js",
  agenticIndex: "packages/agentic-system/src/index.js",
  domainExecution: "packages/agentic-system/src/domain-execution-control.js",
  supervisor: "packages/agent-tools/src/supervisor.js",
  adapters: "packages/agent-tools/src/tool-adapters.js",
  agentToolsIndex: "packages/agent-tools/src/index.js",
  agentCli: "packages/agent-tools/bin/exharness-agent.mjs",
  oracleState: "docs/living/system/oracle/state.md",
  agentToolsState: "docs/living/system/agent-tools/state.md",
  workGraph: "docs/blackboard/work-graph.json"
};

const src = Object.fromEntries(Object.entries(files).map(([k, rel]) => [k, read(rel)]));
const graph = JSON.parse(src.workGraph);

const taskIds = graph.tasks.map((t) => t.id);
const titles = Object.fromEntries(graph.tasks.map((t) => [t.id, t.title]));
const featureIds = graph.features.map((f) => f.id);

function mentions(haystack, needles) {
  return needles.filter((n) => haystack.includes(n));
}

const agenticImportsAgentTools = [
  files.backendWorker,
  files.backendApplication,
  files.composition,
  files.durable,
  files.agenticIndex,
  files.domainExecution
].filter((rel) => has(src[Object.keys(files).find((k) => files[k] === rel)], "@exharness/agent-tools") || has(src[Object.keys(files).find((k) => files[k] === rel)], "packages/agent-tools") || has(src[Object.keys(files).find((k) => files[k] === rel)], "runSupervisedTask") || has(src[Object.keys(files).find((k) => files[k] === rel)], "createSupervisedAgentStrategy"));

const supervisorFacts = {
  validateAgentTaskFields: ["id", "repositoryRoot", "baseRevision", "prompt", "verifications"],
  hasRequiredFilesField: has(src.supervisor, "requiredFiles"),
  hasContextRequirement: has(src.supervisor, "contextRequirement") || has(src.supervisor, "ContextRequirement"),
  sessionIdUsesRandomUUID: has(src.supervisor, "agent-task:${task.id}:${randomUUID()}"),
  disposesWorktreeInFinally: has(src.supervisor, "await workspace.dispose()") && has(src.supervisor, "} finally {"),
  scratchIsMkdtemp: has(src.supervisor, 'mkdtemp(join(tmpdir(), "exharness-agent-"))'),
  noResumeWorktreeOption: !has(src.supervisor, "resumeWorktree") && !has(src.supervisor, "persistedWorktree"),
  importsBackendWorker: has(src.supervisor, "createBackendWorker")
};

const backendFacts = {
  injectsStrategy: has(src.backendWorker, "strategy.run"),
  injectsWorkspaceAct: has(src.backendWorker, "workspace.act"),
  objectivePassOnAnyMutation: has(src.backendWorker, "candidate.version !== order.revision"),
  importsAgentTools: agenticImportsAgentTools.length > 0,
  agenticImportHits: agenticImportsAgentTools
};

const mcpFacts = {
  agentToolsExportsMcp: has(src.agentToolsIndex, "mcp") || has(src.agentToolsIndex, "MCP"),
  supervisorMentionsMcp: has(src.supervisor, "mcp") || has(src.supervisor, "MCP"),
  adaptersMentionsMcp: has(src.adapters, "mcp") || has(src.adapters, "MCP"),
  cliMentionsMcp: has(src.agentCli, "mcp") || has(src.agentCli, "MCP"),
  oracleStateMcp: has(src.oracleState, "no MCP client/adapter")
};

const cliFacts = {
  commands: [...src.agentCli.matchAll(/cmd === "([^"]+)"/g)].map((m) => m[1]),
  hasDeliverCommand: has(src.agentCli, "deliver"),
  hasBackendCommand: has(src.agentCli, "backend")
};

const coverageNeedles = [
  "supervised agent as Backend",
  "agent-tools Backend",
  "durable agent-tool",
  "Oracle-grounded agent-tool",
  "MCP server",
  "operator CLI",
  "exharness deliver"
];
const coveredByTitle = graph.tasks
  .map((t) => ({ id: t.id, title: t.title, status: t.status }))
  .filter((t) => /agent-tool|MCP|operator|deliver/i.test(t.title));

const result = {
  kind: "BB100_AGENT_TOOL_PRODUCTIZATION_PROBE_RESULT",
  version: 1,
  checkedAt: "2026-09-30",
  researchBaselineSha: "7de5761c31d8799021361fb158db756e8e266943",
  filesRead: Object.values(files),
  backendFacts,
  supervisorFacts,
  mcpFacts,
  cliFacts,
  oracleMcpAbsent: mcpFacts.oracleStateMcp,
  agentToolsTrustBoundary: has(src.agentToolsState, "The adapters are not a sandbox"),
  existingAgentToolTasks: ["BB-097", "BB-098", "BB-099"].filter((id) => taskIds.includes(id)).map((id) => ({ id, title: titles[id] })),
  existingTitlesTouchingTheme: coveredByTitle,
  nextWorkId: graph.allocation.nextWorkId,
  featureIdsTouchingAgentTools: featureIds.filter((id) => id.includes("AGENT-TOOL")),
  overlapChecks: {
    bb066IsOpenHandsDomainRuntime: titles["BB-066"]?.includes("coding-agent") === true,
    bb067IsSandbox: /sandbox/i.test(titles["BB-067"] ?? ""),
    bb069IsFirstSlice: /bounded real feature|first/i.test(titles["BB-069"] ?? ""),
    bb089IsOracleBackendAdoption: /Oracle facade|Backend\/QA production/i.test(titles["BB-089"] ?? ""),
    noTaskComposesAgentToolsIntoBackend: !graph.tasks.some((t) => /Backend/.test(t.title) && /agent-tool|Codex|Kiro|agy/i.test(t.title)),
    noTaskDurableAgentToolRecovery: !graph.tasks.some((t) => /recover|resume|durable/i.test(t.title) && /agent-tool/i.test(t.title)),
    noTaskOracleContextForAgentTools: !graph.tasks.some((t) => /oracle|context/i.test(t.title) && /agent-tool/i.test(t.title)),
    noTaskMcpGate: !graph.tasks.some((t) => /MCP/i.test(t.title)),
    noTaskOperatorSlice: !graph.tasks.some((t) => /operator/i.test(t.title) && /agent-tool|local slice/i.test(t.title))
  },
  coverageNeedlesUnmatched: coverageNeedles
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "productization-probe-result.json");
fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
process.stdout.write(`${out}\n${JSON.stringify({ nextWorkId: result.nextWorkId, overlapChecks: result.overlapChecks, backendImportsAgentTools: result.backendFacts.importsAgentTools, mcpAbsent: result.mcpFacts, cliCommands: result.cliFacts.commands, sessionRandom: result.supervisorFacts.sessionIdUsesRandomUUID, disposeFinally: result.supervisorFacts.disposesWorktreeInFinally }, null, 2)}\n`);
