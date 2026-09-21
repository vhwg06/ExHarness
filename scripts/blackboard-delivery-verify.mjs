import { read, assertDeliveryArtifact, assertBinding, planHash, fail } from './blackboard-delivery-contract.mjs';
import { assertReady } from './blackboard-jev.mjs';

export function verifyDeliveryContracts(root='.') {
  const graph=read(root,'docs/blackboard/work-graph.json');
  for(const task of graph.tasks) {
    if(!task.contract)continue;
    const objective=assertDeliveryArtifact(read(root,task.contract.objectiveRef));
    const plan=assertDeliveryArtifact(read(root,task.contract.planRef));
    if(objective.artifactType!=='OBJECTIVE'||plan.artifactType!=='READY_IMPLEMENT_PLAN')fail('wrong lane input types');
    if(plan.objective.ref!==task.contract.objectiveRef)fail('objective ref mismatch');
    assertBinding(root,plan.objective);
    if(task.lane==='WORKER' && task.status!=='DONE')assertReady(root,task,plan);
    if(task.status==='DONE') {
      const receipt=assertDeliveryArtifact(read(root,task.contract.deliveryRef));
      if(receipt.artifactType!=='DELIVERED_FEATURE'||receipt.plan.ref!==task.contract.planRef||receipt.plan.hash!==planHash(plan))fail('delivery plan mismatch');
      assertBinding(root,receipt.evaluation);
      const evaluation=assertDeliveryArtifact(read(root,receipt.evaluation.ref));
      if(evaluation.verdict!=='SATISFIED'||evaluation.subject.workId!==task.id||evaluation.subject.candidateSha!==receipt.candidateSha||evaluation.subject.candidateTree!==receipt.candidateTree)fail('delivery evaluation mismatch');
    }
  }
  return true;
}
if(process.argv[1]?.endsWith('blackboard-delivery-verify.mjs')) {
  verifyDeliveryContracts();console.log(JSON.stringify({ok:true,contract:'OBJECTIVE_PLAN_DELIVERY'}));
}
