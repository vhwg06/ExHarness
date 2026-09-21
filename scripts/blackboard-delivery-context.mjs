import { loadSubject, fail, planHash, read } from './blackboard-delivery-contract.mjs';
import { assertReady, materialize, validateEvaluation } from './blackboard-jev.mjs';

export function deriveDeliveryContext(id, { root, graph, registry }) {
  const { task, plan } = loadSubject(root, id);
  if(task.status === 'BLOCKED') fail('task is BLOCKED');
  const profiles = task.components.map(id => registry.components.find(c => c.id === id).contextProfile);
  const dependencies = task.dependencies.map(d => graph.tasks.find(t => t.id === d.taskId));
  if(dependencies.some(d => d.status !== 'DONE')) fail('DEPENDENCIES_NOT_DONE');
  if(task.lane === 'WORKER') assertReady(root,task,plan);
  const execution = task.lane === 'WORKER' && ['EXECUTION','REPAIR'].includes(task.phase);
  if(task.phase === 'REPAIR') {
    // Exact findings are independently revalidated by the evaluation publisher.
    if(!task.contract.evaluationRef) fail('repair requires findings');
    const findings=read(root,task.contract.evaluationRef);
    if(findings.verdict!=='REPAIR_REQUIRED')fail('repair requires exact worker findings');
    validateEvaluation(findings,materialize(root,id));
  }
  const uniq = xs => [...new Set(xs)];
  return {
    kind:'WORK_CONTEXT_SPEC',version:1,contract:'OBJECTIVE_PLAN_DELIVERY',itemId:id,taskId:id,
    featureId:task.featureId,topicId:graph.features.find(f=>f.id===task.featureId)?.topicId??null,components:task.components,pipeline:task.lane,lane:task.lane,phase:task.phase,
    stage:task.phase,semanticArtifactRef:task.lane === 'RESEARCH_SA' ? task.contract.objectiveRef : task.contract.planRef,
    planRef:task.contract.planRef,planHash:planHash(plan),
    action:{kind:execution?'IMPLEMENT':task.lane==='RESEARCH_SA'?'RESEARCH':'REVIEW',summary:execution?'Implement the exact ready plan and produce evidence.':'Follow the current lane contract; Jev owns semantic judgment.'},
    dependencyContext:dependencies.map(d=>({taskId:d.id,source:'LIVING_CONSOLIDATED',refs:d.artifacts.consolidatedRefs})),
    requiredCurrentSystemRefs:uniq([...profiles.flatMap(p=>p.currentSystemRefs),...dependencies.flatMap(d=>d.artifacts.consolidatedRefs)]),
    requiredInputRefs:uniq([task.contract.objectiveRef,task.contract.planRef,...(task.contract.evaluationRef?[task.contract.evaluationRef]:[])]),
    sourceScope:{read:plan.sourceScope.read,write:execution?plan.sourceScope.write:[],forbiddenWrite:execution?plan.sourceScope.forbiddenWrite:['**']},
    executionSourceScope:plan.sourceScope,
    artifactWriteScope:task.lane==='RESEARCH_SA'?[task.contract.planRef]:[],
    hardInvariants:plan.invariants,verification:plan.verificationPlan,expectedOutputs:[task.lane==='RESEARCH_SA'?'READY_IMPLEMENT_PLAN':'DELIVERED_FEATURE'],
    progressiveDiscovery:{mode:'ON_DEMAND_ONLY',searchRoots:uniq(profiles.flatMap(p=>p.progressiveSearchRoots)),contractRefs:uniq(profiles.flatMap(p=>p.contractRefs))}
  };
}
