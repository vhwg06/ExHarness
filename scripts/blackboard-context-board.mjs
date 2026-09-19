export function parseCurrentContext(boardText, itemId) {
  const marker = `${itemId}\n`;
  const start = boardText.indexOf(marker);
  if (start < 0) throw new Error(`BOARD_BINDING_INVALID: missing ${itemId}`);
  const next = boardText.indexOf("\nBB-", start + marker.length);
  const block = boardText.slice(start, next < 0 ? boardText.length : next);
  const section = block.match(/current-context:\s*\n([\s\S]*?)(?=\n\S|$)/);
  if (!section) throw new Error("BOARD_BINDING_INVALID: missing current-context");
  const gens=[...section[1].matchAll(/^\s*generation:\s*(\d+)\s*$/gm)];
  const refs=[...section[1].matchAll(/^\s*ref:\s*(\S+)\s*$/gm)];
  if(gens.length!==1||refs.length!==1) throw new Error("BOARD_BINDING_INVALID: ambiguous current-context");
  return {generation:Number(gens[0][1]),ref:refs[0][1]};
}

export function assertBoardBinding(binding, spec, specRef) {
  if (binding.ref !== specRef || binding.generation !== spec.generation || spec.itemId == null)
    throw new Error("BOARD_BINDING_INVALID: ref/generation mismatch");
  return true;
}
