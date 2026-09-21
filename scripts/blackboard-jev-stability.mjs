import { read, write, hash } from './blackboard-delivery-contract.mjs';
import { evaluate, MODEL } from './blackboard-jev.mjs';

// Deliberately separate from normal verification and canonical publication.
const fixtures=read('.', 'test/fixtures/blackboard-jev-stability.json');
const cases=[];
for(const fixture of fixtures) {
  const questions={claim:{type:'choice',instructions:fixture.question,criteria:{SATISFIED:'Evidence establishes the claim.',IMPLEMENTATION_DEFECT:'Implementation contradicts the claim.',INSUFFICIENT_EVIDENCE:'Evidence is absent or insufficient.',PLAN_INPUT_CONTRADICTION:'The upstream requirements contradict one another.'}}};
  const payload={model:MODEL,state:fixture.state,questions};
  const input={lane:fixture.lane,subject:{workId:`benchmark-${fixture.id}`,plan:{ref:'benchmark',hash:hash(fixture.state)}},payload,stateHash:hash(fixture.state),specHash:hash(questions),cacheKey:hash(fixture)};
  const runs=[];
  for(let i=0;i<3;i++) runs.push(await evaluate(input,{bypassCache:true}));
  const choices=runs.map(r=>r.answers.claim.choice);
  cases.push({id:fixture.id,lane:fixture.lane,expected:fixture.expected,choices,agreement:Math.max(...choices.map(c=>choices.filter(x=>x===c).length))/choices.length,verdictFlips:choices.slice(1).filter((c,i)=>c!==choices[i]).length,falseSatisfied:choices.filter(c=>c==='SATISFIED'&&fixture.expected!=='SATISFIED').length,runs:runs.map(r=>({usage:r.usage,metrics:r.metrics,answers:r.answers}))});
}
const report={kind:'JEV_STABILITY_BENCHMARK',productionEvidence:false,model:MODEL,repeats:3,cases};
write('.','artifacts/blackboard-jev/stability.json',report);
console.log(JSON.stringify(report,null,2));
