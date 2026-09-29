import { invariant, requireText } from './contracts.js';
import { ContextBlockTrust, defineContextBlock } from './context.js';

function jsonSafe(value, label, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  invariant(typeof value === 'object' && value !== null && !seen.has(value), `${label} must be JSON-safe`);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry, i) => jsonSafe(entry, `${label}[${i}]`, seen));
  else {
    invariant(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${label} must be JSON-safe`);
    for (const key of Reflect.ownKeys(value)) {
      invariant(typeof key === 'string' && value[key] !== undefined, `${label} must be JSON-safe`);
      jsonSafe(value[key], `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
}
function cloneJson(value, label) { jsonSafe(value,label); return structuredClone(value); }
export function defineContextRequirementBlock(definition = {}) {
  invariant(definition && typeof definition === 'object' && !Array.isArray(definition), 'context requirement block is required');
  const name=requireText(definition.name,'context requirement block name');
  const description=definition.description == null ? null : requireText(definition.description,`context requirement block ${name} description`);
  const trust=definition.trust ?? ContextBlockTrust.TRUSTED;
  invariant(Object.values(ContextBlockTrust).includes(trust),`context requirement block ${name} trust is invalid`);
  invariant(Object.prototype.hasOwnProperty.call(definition,'requirement'),`context requirement block ${name} requires requirement`);
  invariant(typeof definition.project === 'function',`context requirement block ${name} requires project()`);
  return Object.freeze({name,description,trust,requirement:cloneJson(definition.requirement,`context requirement block ${name} requirement`),project:definition.project});
}
export async function resolveContextRequirementBlocks({blocks = [], selectedNames = [], resolver = null, metadata = {}} = {}) {
  invariant(Array.isArray(blocks) && Array.isArray(selectedNames),'context requirement blocks and selectedNames must be arrays');
  const registry=new Map(blocks.map(definition=>{const block=defineContextRequirementBlock(definition);return [block.name,block];}));
  invariant(registry.size===blocks.length,'duplicate context requirement block');
  const selected=selectedNames.filter(name=>registry.has(name));
  if (selected.length) invariant(resolver && typeof resolver.resolve === 'function','selected context requirement block needs contextResolver.resolve()');
  const fixed=[];
  for (const name of selected) {
    const block=registry.get(name);
    const resolution=cloneJson(await resolver.resolve(cloneJson(block.requirement,'requirement'), cloneJson(metadata,'metadata')),'context resolution');
    const value=cloneJson(await block.project(resolution,cloneJson(metadata,'metadata')),'projected context');
    fixed.push(defineContextBlock({name:block.name,description:block.description,trust:block.trust,value}));
  }
  return Object.freeze(fixed);
}
