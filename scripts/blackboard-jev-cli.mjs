import fs from 'node:fs';
import path from 'node:path';
import { read, write, loadSubject, localPath, canonical, fail } from './blackboard-delivery-contract.mjs';
import { materialize, evaluate } from './blackboard-jev.mjs';
import { publishEvaluation, collectEvidence, verifyDelivery, publishDelivery, importEvaluationEvidence } from './blackboard-delivery.mjs';
import { renderStateProjection } from './blackboard-state-project.mjs';
import { deriveTaskContext } from './blackboard-task-context-resolver.mjs';
import { taskReadiness } from './blackboard-work-graph.mjs';
import { loadDotEnv } from './blackboard-env.mjs';

const [command,id,arg] = process.argv.slice(2);
const root=process.cwd();
function project(){fs.writeFileSync(localPath(root,'docs/blackboard/state.md'),renderStateProjection());}
if(!id) fail('usage: blackboard-jev-cli <materialize|evaluate|publish|collect|verify-delivery|publish-delivery|claim> <WORK_ID> [artifact-or-worker-id]');
let result;
if(command==='materialize') result=materialize(root,id);
else if(command==='evaluate') {
  loadDotEnv(root);
  const input=materialize(root,id);
  result=await evaluate(input,{root});
  const ref=arg??`artifacts/blackboard-jev/${id}.json`;write(root,ref,result);
  console.log(JSON.stringify({ref,verdict:result.verdict,metrics:result.metrics}));
  process.exitCode=result.verdict==='SATISFIED'?0:2;
} else if(command==='publish') {
  const evaluation=read(root,arg);
  const directory=path.dirname(localPath(root,arg));
  if(evaluation.lane==='WORKER' && fs.existsSync(path.join(directory,`${id}-implementation-result.json`)))importEvaluationEvidence(root,id,evaluation,directory);
  result=publishEvaluation(root,id,evaluation);project();
}
else if(command==='collect') {
  result=collectEvidence(root,id);
  const {task}=loadSubject(root,id);
  if(task.status==='ACTIVE')write(root,task.currentContextRef,deriveTaskContext(id));
  project();
}
else if(command==='verify-delivery') result=verifyDelivery(root,id,{mergeSha:arg}).receipt;
else if(command==='publish-delivery') { result=publishDelivery(root,id,{mergeSha:arg});project(); }
else if(command==='claim') {
  if(!arg)fail('worker id required');
  const {graph,task}=loadSubject(root,id);
  if(task.status!=='PLANNED')fail('only PLANNED work may be claimed');
  const readiness=taskReadiness(graph,id);
  if(!readiness.ready)fail(`work is not schedulable: ${readiness.reason}`);
  const context=deriveTaskContext(id);
  task.status='ACTIVE';task.claim={workerId:arg};task.currentContextRef=`docs/blackboard/context/${id}/current.json`;
  write(root,task.currentContextRef,context);write(root,'docs/blackboard/work-graph.json',graph);project();result={taskId:id,lane:task.lane,phase:task.phase};
} else fail('unknown command');
if(command!=='evaluate')console.log(JSON.stringify(result,null,2));
