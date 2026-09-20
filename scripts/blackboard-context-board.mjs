export function parseCurrentContext(boardText, itemId) {
  const lines=boardText.split("\n");
  const itemLines=lines.map((line,i)=>line.trim()===itemId?i:-1).filter(i=>i>=0);
  if(itemLines.length!==1) throw new Error(`BOARD_BINDING_INVALID: expected one ${itemId}, found ${itemLines.length}`);
  const start=itemLines[0];
  let end=lines.length;
  for(let i=start+1;i<lines.length;i++) if(/^BB-\d+\s*$/.test(lines[i].trim())) { end=i; break; }
  const block=lines.slice(start,end);
  const ctxLines=block.map((line,i)=>line.trim()==="current-context:"?i:-1).filter(i=>i>=0);
  if(ctxLines.length!==1) throw new Error("BOARD_BINDING_INVALID: expected one current-context");

  const section=[];
  for(let i=ctxLines[0]+1;i<block.length;i++){
    const line=block[i];
    if(!line.trim()) continue;
    if(!/^\s+/.test(line)) break;
    section.push(line);
  }

  const gens=section.map(x=>x.match(/^\s*generation:\s*(\d+)\s*$/)).filter(Boolean);
  const refs=section.map(x=>x.match(/^\s*ref:\s*(\S+)\s*$/)).filter(Boolean);
  if(gens.length!==1||refs.length!==1) throw new Error("BOARD_BINDING_INVALID: ambiguous current-context");
  return {generation:Number(gens[0][1]),ref:refs[0][1]};
}

export function assertBoardBinding(binding, spec, specRef) {
  if (binding.ref !== specRef || binding.generation !== spec.generation || spec.itemId == null)
    throw new Error("BOARD_BINDING_INVALID: ref/generation mismatch");
  return true;
}

export function parseItemRef(boardText,itemId,fieldName){
  const lines=boardText.split("\n");
  const itemLines=lines.map((line,i)=>line.trim()===itemId?i:-1).filter(i=>i>=0);
  if(itemLines.length!==1) throw new Error(`BOARD_BINDING_INVALID: expected one ${itemId}, found ${itemLines.length}`);
  const start=itemLines[0];
  let end=lines.length;
  for(let i=start+1;i<lines.length;i++) if(/^BB-\d+\s*$/.test(lines[i].trim())) { end=i; break; }
  const block=lines.slice(start,end);
  const fieldLines=block.map((line,i)=>line.trim()===`${fieldName}:`?i:-1).filter(i=>i>=0);
  if(fieldLines.length!==1) throw new Error(`BOARD_BINDING_INVALID: expected one ${fieldName}`);
  const section=[];
  for(let i=fieldLines[0]+1;i<block.length;i++){
    const line=block[i];
    if(!line.trim())continue;
    if(!/^\s+/.test(line))break;
    section.push(line);
  }
  const refs=section.map(x=>x.match(/^\s*ref:\s*(\S+)\s*$/)).filter(Boolean);
  if(refs.length!==1) throw new Error(`BOARD_BINDING_INVALID: ambiguous ${fieldName}`);
  return refs[0][1];
}
