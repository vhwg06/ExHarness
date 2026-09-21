import fs from 'node:fs';
import path from 'node:path';
import { read, write, fail, localPath } from './blackboard-delivery-contract.mjs';
import { git, materialize, evaluate } from './blackboard-jev.mjs';
import { collectEvidence } from './blackboard-delivery.mjs';

const [command]=process.argv.slice(2);
const id=process.env.WORK_ID,sha=process.env.CANDIDATE_SHA;
if(command==='select') {
  if(id && !/^BB-\d+$/.test(id))fail('invalid work id');
  if(sha && !/^[a-f0-9]{40}$/.test(sha))fail('invalid candidate SHA');
  const graph=read('.','docs/blackboard/work-graph.json');
  const selected=id?graph.tasks.filter(t=>t.id===id&&t.status!=='DONE'):graph.tasks.filter(t=>t.status!=='DONE'&&t.lane==='WORKER'&&t.contract.candidateSha===sha);
  if(id&&selected.length!==1)fail('work is not current');
  const work=selected.map(t=>({id:t.id,sha:t.lane==='RESEARCH_SA'?git('.','rev-parse','HEAD'):sha??t.contract.candidateSha}));
  if(work.some(w=>!w.sha))fail('worker candidate SHA required');
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`work=${JSON.stringify(work)}\n`);
} else {
  if(!/^BB-\d+$/.test(id??'')||!/^[a-f0-9]{40}$/.test(sha??''))fail('invalid CI subject');
  const trusted=path.resolve('trusted'),root=path.resolve('subject');
  // Current Board and evaluator are trusted main data; candidate source never controls routing/policy.
  fs.cpSync(path.join(trusted,'docs/blackboard'),localPath(root,'docs/blackboard'),{recursive:true});
  const graph=read(root,'docs/blackboard/work-graph.json');
  const task=graph.tasks.find(t=>t.id===id);
  if(!task||task.status==='DONE')fail('work no longer current');
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
