// Pure path classifier for the boundary check. The candidate may change only
// files inside WRITE_SCOPE; FORBIDDEN paths must never appear in the
// candidate's changes. Blackboard gate-owned bookkeeping paths are exempt
// from BOTH assertions because the evidence-collection gate writes them into
// the checkout itself (modified state.md / work-graph.json, untracked
// context/ and evidence/ dirs); they describe the gate run, not the
// candidate. Every other docs/blackboard/ path stays forbidden.
export const WRITE_SCOPE = Object.freeze([
  'benchmarks/harness-efficiency/',
  'docs/living/system/core-harness/'
]);

export const FORBIDDEN = Object.freeze([
  'packages/benchmark/',
  'benchmarks/substrate/',
  'packages/core-harness/src/',
  'packages/agentic-system/',
  '.github/',
  'docs/blackboard/',
  'package.json',
  'scripts/blackboard-jev.mjs'
]);

export const GATE_EXEMPT = Object.freeze([
  'docs/blackboard/state.md',
  'docs/blackboard/work-graph.json',
  'docs/blackboard/context/',
  'docs/blackboard/evidence/',
  'docs/blackboard/artifacts/blackboard-'
]);

export function isGateExempt(file) {
  return GATE_EXEMPT.some((prefix) => file === prefix || file.startsWith(prefix));
}

export function isInWriteScope(file) {
  return WRITE_SCOPE.some((prefix) => file.startsWith(prefix));
}

export function isForbidden(file) {
  if (isGateExempt(file)) return false;
  return FORBIDDEN.some((prefix) => file === prefix || file.startsWith(prefix));
}

// entries: [{ file, tracked }] where tracked is false for `??` status lines.
// Forbidden applies to every entry; outside-scope applies only to tracked
// entries (untracked files from parallel work are ignored).
export function classifyEntries(entries) {
  const forbidden = [];
  const outsideScope = [];
  for (const { file, tracked } of entries) {
    if (isForbidden(file)) {
      forbidden.push(file);
      continue;
    }
    if (tracked && !isInWriteScope(file) && !isGateExempt(file)) outsideScope.push(file);
  }
  return { forbidden: Object.freeze(forbidden), outsideScope: Object.freeze(outsideScope) };
}
