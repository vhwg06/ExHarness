import { ProviderOperation } from '../provider-contract.js';
export function projectStructuralMap({edges,seeds,maxItems,maxMaterializedBytes}={}){
 if(!Array.isArray(edges)||!Array.isArray(seeds)||!Number.isSafeInteger(maxItems)||maxItems<0||!Number.isSafeInteger(maxMaterializedBytes)||maxMaterializedBytes<0)throw new TypeError('bounded structural projection requires edges, seeds and limits');
 const normalized=edges.map(edge=>{if(!edge||typeof edge.from!=='string'||typeof edge.to!=='string'||typeof edge.kind!=='string'||typeof edge.sourceRef!=='string')throw new TypeError('structural edge needs typed source provenance');return {from:edge.from,to:edge.to,kind:edge.kind,sourceRef:edge.sourceRef};});
 const seed=new Set(seeds),ranked=new Map();for(const edge of normalized){for(const ref of [edge.from,edge.to]){const score=(seed.has(ref)?3:0)+(seed.has(edge.from)||seed.has(edge.to)?1:0);if(score>0)ranked.set(ref,(ranked.get(ref)??0)+score);}}
 const selected=[...ranked].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));const items=[];let bytes=0;
 for(const [ref,score] of selected){if(items.length>=maxItems)break;const related=normalized.filter(edge=>edge.from===ref||edge.to===ref);const item={ref,score,edges:related};const size=Buffer.byteLength(JSON.stringify(item),'utf8');if(bytes+size>maxMaterializedBytes)continue;bytes+=size;items.push(item);}
 return Object.freeze({items,bytes});
}
export function createStructuralMapProvider({edgeSource,providerId='structural-map'}={}){
 if(!edgeSource||typeof edgeSource.edges!=='function')throw new TypeError('edgeSource.edges() required');
 return {descriptor:{providerId,sourceKinds:['REPOSITORY'],operations:[ProviderOperation.STRUCTURAL_MAP],snapshotModes:['EXACT','CURRENT'],currentnessValidators:['REVISION'],maxConcurrentCalls:1,costClass:'LOW'},async retrieve(work){
  const result=await edgeSource.edges({ref:work.sourceConstraint.ref,snapshot:work.sourceConstraint.snapshot});
  if(!result||!result.snapshotRef||!Array.isArray(result.edges))throw new TypeError('edgeSource must provide exact snapshot and edges');
  const projection=projectStructuralMap({edges:result.edges,seeds:result.seeds??[],maxItems:work.reservedBudget.items,maxMaterializedBytes:work.reservedBudget.materializedBytes});
  return projection.items.map((item,i)=>({evidenceId:work.evidenceId,source:{kind:'REPOSITORY',ref:work.sourceConstraint.ref,snapshotRef:result.snapshotRef,itemRef:item.ref},validators:[{kind:'REVISION',value:result.snapshotRef,strength:'STRONG'}],provenance:item.edges.map(edge=>({kind:'STRUCTURAL_EDGE',ref:edge.sourceRef})),content:item,providerEvidence:{providerId,operation:ProviderOperation.STRUCTURAL_MAP,score:item.score,rank:i}}));
 }};
}
