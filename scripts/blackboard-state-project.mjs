import fs from "node:fs";
import path from "node:path";
import { readWorkGraph, readComponentRegistry, assertWorkGraph, schedulableTasks, taskReadiness } from "./blackboard-work-graph.mjs";

function readJevEvaluation(root, ref) {
  if (typeof ref !== "string" || !ref) return null;
  const target = path.resolve(root, ref);
  if (!fs.existsSync(target)) return null;
  try {
    const evaluation = JSON.parse(fs.readFileSync(target, "utf8"));
    if (evaluation?.artifactType !== "JEV_EVALUATION" || !evaluation.answers) return null;
    const answers = Object.entries(evaluation.answers);
    return {
      ref,
      lane: evaluation.lane,
      verdict: evaluation.verdict,
      satisfied: answers.filter(([, answer]) => answer.choice === "SATISFIED").map(([id]) => id),
      unresolved: answers.filter(([, answer]) => answer.choice !== "SATISFIED").map(([id]) => id)
    };
  } catch {
    return null;
  }
}

export function renderStateProjection({graph=readWorkGraph(),registry=readComponentRegistry(),root=process.cwd()}={}){
  assertWorkGraph(graph,registry);
  const active=graph.tasks.filter(t=>t.status==="ACTIVE");
  const schedulable=schedulableTasks(graph);
  const lines=[
    "# Outer Blackboard",
    "",
    "Status: **DERIVED ROUTING PROJECTION**",
    "",
    "> Generated from `docs/blackboard/work-graph.json` and `docs/blackboard/component-registry.json`. Routing facts are derived; edit the canonical graph/catalog, not this projection.",
    "",
    "## Canonical sources",
    "",
    "```text",
    "work-graph: docs/blackboard/work-graph.json",
    "component-registry: docs/blackboard/component-registry.json",
    "living-system-root: docs/living/system/state.md",
    "integration-roadmap-ref: docs/living/knowledge/integration-phase-research-to-implementation-readiness.md",
    "```",
    "",
    "## Project",
    "",
    "```text",
    `phase: ${graph.phase}`,
    `next-work-id: ${graph.allocation.nextWorkId}`,
    `execution-unit: ${graph.allocation.executionUnit}`,
    `context-routing-unit: ${graph.allocation.contextRoutingUnit}`,
    `worker-ownership: ${graph.allocation.workerOwnership}`,
    `current-active-debt: ${active.length}`,
    "```",
    "",
    "## Pipeline lanes",
    "",
    "```text",
    "RESEARCH_SA",
    `  active: ${active.filter(t=>t.lane==='RESEARCH_SA').map(t=>t.id).join(',')||'NONE'}`,
    "",
    "WORKER",
    `  active: ${active.filter(t=>t.lane==='WORKER'||!t.contract).map(t=>t.id).join(',')||'NONE'}`,
    "```",
    "",
    "## Active work",
    ""
  ];
  if(!active.length)lines.push("NONE");
  else for(const task of active){
    lines.push("",task.id,`task: ${task.title}`,`lane: ${task.lane??'WORKER'}`,`phase: ${task.phase??'LEGACY'}`,`current-context: ${task.currentContextRef}`,`components: ${task.components.join(", ")}`,`worker: ${task.claim.workerId}`);
  }

  lines.push("","## Schedulable tasks","");
  if(!schedulable.length)lines.push("NONE");
  else for(const id of schedulable){
    const task=graph.tasks.find(t=>t.id===id);
    lines.push(`- ${id} [${task.lane??'WORKER'}/${task.phase??'LEGACY'}] — ${task.title}`);
  }

  const jevDecisions = graph.tasks
    .map(task => ({
      task,
      historical: !task.contract?.evaluationRef && Boolean(task.contract?.lastResearchEvaluationRef),
      evaluation: readJevEvaluation(root, task.contract?.evaluationRef ?? task.contract?.lastResearchEvaluationRef)
    }))
    .filter(entry => entry.evaluation);
  lines.push("", "## Jev decisions", "");
  if (!jevDecisions.length) lines.push("NONE");
  else for (const { task, historical, evaluation } of jevDecisions) {
    lines.push(
      `- ${task.id} [${evaluation.lane}/${evaluation.verdict}${historical ? "/STALE_AFTER_PLAN_EDIT" : ""}]`,
      `  satisfied: ${evaluation.satisfied.join(", ") || "NONE"}`,
      `  unresolved: ${evaluation.unresolved.join(", ") || "NONE"}`,
      `  evaluation: ${evaluation.ref}`
    );
  }

  lines.push("","## Dependency graph","","```text");
  for(const task of graph.tasks){
    const r=taskReadiness(graph,task.id);
    const derived=task.status==="DONE"?"DONE":task.status==="ACTIVE"?"ACTIVE":r.ready?(task.lane==='RESEARCH_SA'?'RESEARCH_SCHEDULABLE':'WORKER_SCHEDULABLE'):r.reason==="DEPENDENCIES_NOT_DONE"?`BLOCKED_BY ${r.blockedBy.join(",")}`:task.status;
    lines.push(`${task.id} [${derived}] <- ${task.dependencies.map(d=>d.taskId).join(", ")||"ROOT"}`);
  }
  lines.push("```","","## Context semantics","","```text",
    "Task = scheduling / claim / execution unit",
    "Component = context-routing unit",
    "Worker = temporary owner of exactly one claimed Task",
    "current.json = rebuildable TaskContext projection",
    "",
    "Task",
    "  -> components[]",
    "  -> Component Registry / Context Profiles",
    "  -> task artifacts",
    "  -> direct dependencies",
    "       DONE -> consolidated Living refs",
    "  -> deterministic WorkerContext",
    "  -> progressive search only for unresolved context",
    "```",
    "",
    "No task is selected by scanning artifact directories or repository history. Transitive dependency closure is derived from direct graph edges; it is not duplicated into task records.",
    ""
  );
  return lines.join("\n");
}

export function verifyStateProjection(path="docs/blackboard/state.md"){
  const expected=renderStateProjection();
  const actual=fs.readFileSync(path,"utf8");
  if(actual!==expected)throw new Error("BLACKBOARD_STATE_PROJECTION_INVALID: state.md does not match canonical work graph/component registry");
  return true;
}

if(process.argv[1]?.endsWith("blackboard-state-project.mjs")){
  const write=process.argv.includes("--write");
  const verify=process.argv.includes("--verify");
  if(verify){
    verifyStateProjection();
    console.log(JSON.stringify({ok:true,state:"docs/blackboard/state.md"}));
  }else{
    const rendered=renderStateProjection();
    if(write)fs.writeFileSync("docs/blackboard/state.md",rendered);
    else process.stdout.write(rendered);
  }
}
