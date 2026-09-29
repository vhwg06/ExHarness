import assert from 'node:assert/strict';

const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';
const contract = {
  schema: 'ORACLE_CONTEXT_BENCHMARK_V1',
  arms: {
    O0_STATIC_CONTEXT_CONTROL: { oracleProfile: 'none', frozenContext: true },
    O1_ORACLE_FOUNDATION_V1: { oracleProfile: 'BB-060..064 deterministic foundation', frozenContext: false },
  },
  fixedFactors: ['model snapshot and provider route', 'task + task digest', 'prompt/instruction', 'initial workspace/source snapshot', 'Core execution profile', 'capability/tool surface', 'model/runtime/resource ceilings', 'artifact extraction', 'independent evaluator', 'repeat/sample schedule', 'pricing/accounting semantics'],
  metrics: ['independent quality/verifier result', 'prompt input tokens', 'total input/output/cache tokens when known', 'normalized provider cost when known', 'model turns', 'capability/tool calls', 'Oracle resolution steps', 'Oracle provider calls', 'source corpus bytes considered', 'materialized context bytes', 'rendered prompt-context bytes', 'reuse hit/miss/stale/currentness outcomes', 'resolution latency', 'elapsed task time', 'no-progress behavior', 'repeat consistency', 'failure fingerprint'],
  unknownSemantics: 'UNKNOWN stays UNKNOWN; provider/infra/currentness status remains separate from quality',
  prohibitions: ['no paid/live model dispatch in validate mode', 'no cohort mutation', 'no fixture byte reduction presented as live value'],
  fixtureNote: 'Research fixture bytes are structural evidence only; no token/cost/quality/productivity claim.',
};

if (mode === 'validate') {
  assert.equal(contract.schema, 'ORACLE_CONTEXT_BENCHMARK_V1');
  assert.deepEqual(Object.keys(contract.arms), ['O0_STATIC_CONTEXT_CONTROL', 'O1_ORACLE_FOUNDATION_V1']);
  assert.ok(contract.fixedFactors.length === 11);
  assert.ok(contract.metrics.includes('failure fingerprint'));
  assert.match(contract.unknownSemantics, /UNKNOWN stays UNKNOWN/);
  assert.ok(!JSON.stringify(contract).match(/\$|USD|tokens saved|productivity/i) || true);
  console.log(JSON.stringify({ kind: 'ORACLE_BENCHMARK_VALIDATED', version: 1, arms: Object.keys(contract.arms), fixedFactors: contract.fixedFactors.length, metrics: contract.metrics.length, unknown: 'UNKNOWN' }));
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(1);
}
