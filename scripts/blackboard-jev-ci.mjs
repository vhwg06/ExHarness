import fs from 'node:fs';
import path from 'node:path';
import { read, write, fail, localPath, planHash } from './blackboard-delivery-contract.mjs';
import { git, materialize, evaluate } from './blackboard-jev.mjs';
import { collectEvidence } from './blackboard-delivery.mjs';
import { taskReadiness } from './blackboard-work-graph.mjs';

const [command]=process.argv.slice(2);
const id=process.env.WORK_ID,sha=process.env.CANDIDATE_SHA;
const trustedRoot=process.env.TRUSTED_ROOT||'.',subjectRoot=process.env.SUBJECT_ROOT||trustedRoot;

function canonicalReadinessPublication(task,candidate){
  if(candidate.lane!=='WORKER'||candidate.phase!=='EXECUTION'||candidate.status!=='PLANNED')return false;
  if(candidate.claim!==null||candidate.currentContextRef!==null)return false;
  if(candidate.contract?.objectiveRef!==task.contract.objectiveRef||
     candidate.contract?.planRef!==task.contract.planRef||
     candidate.contract?.researchBaselineSha!==task.contract.researchBaselineSha)return false;
  const trustedPlan=read(trustedRoot,task.contract.planRef);
  const candidatePlan=read(subjectRoot,task.contract.planRef);
  if(candidatePlan.status!=='READY'||planHash(candidatePlan)!==planHash(trustedPlan))return false;
  const evaluationRef=candidate.contract?.evaluationRef;
  if(!evaluationRef||candidatePlan.readinessRef!==evaluationRef||
     candidate.contract?.lastEvaluatedInput===undefined)return false;
  let evaluation;
  try{evaluation=read(subjectRoot,evaluationRef);}catch{return false;}
  return evaluation?.artifactType==='JEV_EVALUATION' &&
    evaluation.lane==='RESEARCH_SA' &&
    evaluation.verdict==='SATISFIED' &&
    evaluation.subject?.workId===task.id &&
    evaluation.subject?.plan?.ref===task.contract.planRef &&
    evaluation.subject?.plan?.hash===planHash(candidatePlan) &&
    evaluation.cacheKey===candidate.contract.lastEvaluatedInput;
}
function candidateResearchTask(graph,task){
  const candidateGraph=read(subjectRoot,'docs/blackboard/work-graph.json');
  const candidate=candidateGraph.tasks.find(t=>t.id===task.id);
  if(!candidate)fail('research candidate task missing');
  if(candidate.lane!==task.lane){
    if(canonicalReadinessPublication(task,candidate))return null;
    fail('research candidate changed trusted routing contract');
  }
  if(candidate.contract?.objectiveRef!==task.contract.objectiveRef||
     candidate.contract?.planRef!==task.contract.planRef)fail('research candidate changed trusted routing contract');
  if(!/^[a-f0-9]{40}$/.test(candidate.contract?.researchBaselineSha??''))fail('research candidate requires exact baseline');
  return candidate;
}
function researchChanged(graph,task){
  if(task.status==='DONE'||task.lane!=='RESEARCH_SA'||!taskReadiness(graph,task.id).ready)return false;
  const candidate=candidateResearchTask(graph,task);
  if(!candidate)return false;
  const trustedPlan=fs.readFileSync(localPath(trustedRoot,task.contract.planRef),'utf8');
  const candidatePlan=fs.readFileSync(localPath(subjectRoot,task.contract.planRef),'utf8');
  if(trustedPlan!==candidatePlan||candidate.contract.researchBaselineSha!==task.contract.researchBaselineSha)return true;
  if(!sha||sha!==git(trustedRoot,'rev-parse','HEAD'))return false;
  try{
    const parent=git(trustedRoot,'rev-parse',`${sha}^1`);
    const parentPlan=git(trustedRoot,'show',`${parent}:${task.contract.planRef}`);
    const parentGraph=JSON.parse(git(trustedRoot,'show',`${parent}:docs/blackboard/work-graph.json`));
    const parentTask=parentGraph.tasks.find(t=>t.id===task.id);
    return parentPlan!==candidatePlan||parentTask?.contract?.researchBaselineSha!==candidate.contract.researchBaselineSha;
  }catch{return false;}
}
if(command==='select') {
  if(id && !/^BB-\d+$/.test(id))fail('invalid work id');
  if(sha && !/^[a-f0-9]{40}$/.test(sha))fail('invalid candidate SHA');
  const graph=read(trustedRoot,'docs/blackboard/work-graph.json');
  const selected=id
    ? graph.tasks.filter(t=>t.id===id&&t.status!=='DONE')
    : [
        ...graph.tasks.filter(t=>t.status!=='DONE'&&t.lane==='WORKER'&&t.contract.candidateSha===sha),
        ...graph.tasks.filter(t=>researchChanged(graph,t))
      ];
  if(id&&selected.length!==1)fail('work is not current');
  const work=[...new Map(selected.map(t=>[t.id,{id:t.id,sha:sha??t.contract.candidateSha}])).values()];
  if(work.some(w=>!w.sha))fail('candidate SHA required');
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`work=${JSON.stringify(work)}\n`);
} else {
  if(!/^BB-\d+$/.test(id??'')||!/^[a-f0-9]{40}$/.test(sha??''))fail('invalid CI subject');
  const trusted=path.resolve('trusted'),root=path.resolve('subject');
  const trustedGraph=read(trusted,'docs/blackboard/work-graph.json');
  const trustedTask=trustedGraph.tasks.find(t=>t.id===id);
  let researchCandidate=null;
  if(trustedTask?.lane==='RESEARCH_SA'){
    const candidateGraph=read(root,'docs/blackboard/work-graph.json');
    const candidateTask=candidateGraph.tasks.find(t=>t.id===id);
    if(!candidateTask||
       candidateTask.lane!==trustedTask.lane||
       candidateTask.contract?.objectiveRef!==trustedTask.contract.objectiveRef||
       candidateTask.contract?.planRef!==trustedTask.contract.planRef)fail('research candidate changed trusted routing contract');
    const baseline=candidateTask.contract.researchBaselineSha;
    if(!/^[a-f0-9]{40}$/.test(baseline??''))fail('research candidate requires exact baseline');
    if(git(root,'rev-parse','HEAD')!==sha)fail('subject checkout differs from CI subject');
    git(root,'merge-base','--is-ancestor',baseline,sha);
    researchCandidate={
      baseline,
      planBody:fs.readFileSync(localPath(root,trustedTask.contract.planRef),'utf8')
    };
  }
  // Current Board, objective, policy and evaluator remain trusted main data.
  // RESEARCH_SA may contribute only the exact plan draft and research baseline being judged.
  fs.cpSync(path.join(trusted,'docs/blackboard'),localPath(root,'docs/blackboard'),{recursive:true});
  const graph=read(root,'docs/blackboard/work-graph.json');
  const task=graph.tasks.find(t=>t.id===id);
  if(!task||task.status==='DONE')fail('work no longer current');
  if(task.lane==='RESEARCH_SA'){
    if(!researchCandidate)fail('research candidate missing');
    fs.writeFileSync(localPath(root,task.contract.planRef),researchCandidate.planBody);
    task.contract.researchBaselineSha=researchCandidate.baseline;
    write(root,'docs/blackboard/work-graph.json',graph);
  }
  if(task.lane==='WORKER') {
    if(task.contract.candidateSha && task.contract.candidateSha!==sha)fail('candidate differs from Board');
    task.contract.candidateSha=sha;
    task.contract.evidenceRef=`docs/blackboard/artifacts/ready-implement-plan/${id}.implementation-result.json`;
    write(root,'docs/blackboard/work-graph.json',graph);
  }
  if(command==='collect') {
    if(task.lane==='WORKER') {
      const result=collectEvidence(root,id);
      const refs=[...new Set(result.evidence.claims.flatMap(c=>c.evidenceRefs))];
      const files=refs.map(ref=>({ref,body:fs.readFileSync(path.join(root,ref),'utf8')}));
      write(root,`artifacts/blackboard-verification/${id}/bundle.json`,{result:result.evidence,files});
    }
    else write(root,`artifacts/blackboard-verification/${id}/research.json`,{workId:id,lane:task.lane});
  } else if(command==='evaluate') {
    if(task.lane==='WORKER') {
      const bundle=read(root,`artifacts/blackboard-verification/${id}/bundle.json`);
      for(const file of bundle.files) {
        if(!file.ref.startsWith(`docs/blackboard/evidence/${id}/`)||!/^[-A-Za-z0-9._]+\.txt$/.test(path.basename(file.ref)))fail('invalid bundled evidence ref');
        const destination=localPath(root,file.ref);
        if(path.dirname(destination)!==path.join(root,'docs/blackboard/evidence',id))fail('bundled evidence escapes task');
        fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,file.body);
      }
      write(root,task.contract.evidenceRef,bundle.result);
    }
    // This process only reads candidate data. It never imports or executes candidate modules.
    const input=materialize(root,id);
    const result=await evaluate(input,{root});
    write(root,`artifacts/blackboard-jev/${id}.json`,result);
    if(task.lane==='WORKER') {
      // Retain the exact canonical evidence files together with the evaluation for publication.
      fs.cpSync(path.join(root,`docs/blackboard/evidence/${id}`),path.join(root,`artifacts/blackboard-jev/evidence/${id}`),{recursive:true});
      write(root,`artifacts/blackboard-jev/${id}-implementation-result.json`,read(root,task.contract.evidenceRef));
    }
    console.log(JSON.stringify({workId:id,verdict:result.verdict,metrics:result.metrics}));
    if(result.verdict!=='SATISFIED')process.exitCode=2;
  } else fail('unknown CI operation');
}
