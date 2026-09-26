import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifyRunResult, main, selectedCalibrationTaskIds } from '../../scripts/delivery/baseline/run.mjs';
import { CALIBRATION_TASK_IDS, MINI_COMMIT, NODE_VERSION, PLAYWRIGHT_VERSION, PROTOCOL, PROTOCOL_HASH, fixtureIdentities, sha256 } from '../../scripts/delivery/baseline/contract.mjs';
import { exportProviderRecords, reconcileOriginalResponse, reconcileStoredCompletion } from '../../scripts/delivery/baseline/provider-export.mjs';
import { ResourceState } from '../../scripts/delivery/baseline/resource-state.mjs';
import { buildProviderProbeConfig, providerProbeDriverTimeoutMs } from '../../scripts/delivery/baseline/study.mjs';

const PYTHON = (() => {
  for (const candidate of [process.env.EXHARNESS_TEST_PYTHON, 'python3', 'python'].filter(Boolean)) {
    try { execFileSync(candidate, ['--version'], { stdio: 'ignore' }); return candidate; } catch { /* try the next portable name */ }
  }
  throw new Error('a Python 3 executable is required for baseline tests');
})();

test('stored provider retrieval confirms totals without inventing omitted cache details', () => {
  const row = { providerRequestId: 'chatcmpl-example', inputTokens: 3598, outputTokens: 355, cachedInputTokens: 2964 };
  const raw = { id: row.providerRequestId, model: 'gpt-6-luna', service_tier: 'default',
    usage: { prompt_tokens: 3598, completion_tokens: 355, total_tokens: 3953 } };
  assert.deepEqual(reconcileStoredCompletion(raw, row, { snapshot: 'gpt-6-luna' }),
    { cachedInputVerification: 'ORIGINAL_RESPONSE_ONLY' });
  assert.throws(() => reconcileStoredCompletion({ ...raw, usage: { ...raw.usage, prompt_tokens: 3599 } }, row,
    { snapshot: 'gpt-6-luna' }), /differs from ledger/);
  assert.throws(() => reconcileStoredCompletion({ ...raw, usage: { ...raw.usage, prompt_tokens_details: { cached_tokens: 0 } } }, row,
    { snapshot: 'gpt-6-luna' }), /cache usage differs/);
});

test('OpenRouter generation metadata reconciles native usage and free cost', () => {
  const model = { credentialEnv: 'OPENROUTER_API_KEY', resolvedModelId: 'nvidia/nemotron-3-ultra-550b-a55b-20260604:free' };
  const row = { providerRequestId: 'gen-example', inputTokens: 21, outputTokens: 16, cachedInputTokens: 0, costUsd: 0 };
  const raw = { data: { id: row.providerRequestId, model: model.resolvedModelId,
    tokens_prompt: 6, tokens_completion: 34, native_tokens_prompt: 21,
    native_tokens_completion: 16, native_tokens_cached: 0, total_cost: 0 } };
  assert.deepEqual(reconcileStoredCompletion(raw, row, model), { cachedInputVerification: 'RETRIEVED_RECORD' });
  assert.throws(() => reconcileStoredCompletion({ data: { ...raw.data, native_tokens_completion: 17 } }, row, model), /differs from ledger/);
  assert.throws(() => reconcileStoredCompletion({ data: { ...raw.data, total_cost: 0.01 } }, row, model), /differs from ledger/);
});

test('deterministic mode runs real verifier and is never labelled LIVE', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-deterministic-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await main(['--mode', 'deterministic', '--output', output]);
  assert.deepEqual(result, { mode: 'deterministic', positive: 'ACCEPTED', negative: 'REJECTED' });
  const artifact = JSON.parse(await readFile(join(output, 'deterministic.json'), 'utf8'));
  assert.equal(artifact.productionEvidence, false);
  assert.equal(artifact.evidenceClass, 'DETERMINISTIC');
});

test('live preflight rejects an unregistered profile before any provider dispatch', async () => {
  await assert.rejects(() => main(['--mode', 'validate', '--profile', 'scripts/delivery/baseline/profile.json']), /experiment\/operator\/reviewer identity/);
});

test('LIVE calibration can select one registered task for quota-spread runs', () => {
  assert.deepEqual(selectedCalibrationTaskIds(), CALIBRATION_TASK_IDS);
  assert.deepEqual(selectedCalibrationTaskIds('STATUS-01'), ['STATUS-01']);
  assert.throws(() => selectedCalibrationTaskIds('UNKNOWN-01'), /unknown calibration task/);
});

test('task selection is rejected outside LIVE mode', async () => {
  await assert.rejects(() => main(['--mode', 'validate', '--task-id', 'NORM-01']), /only valid in live mode/);
});

test('independent verifier accepts a bounded candidate while agent exit remains telemetry', () => {
  assert.equal(classifyRunResult({ code: 1, timedOut: false }, { exitStatus: 'LimitsExceeded' }, { status: 'ACCEPTED' }), 'ACCEPTED');
  assert.equal(classifyRunResult({ code: 0, timedOut: false }, { exitStatus: 'Submitted' }, { status: 'ACCEPTED' }), 'ACCEPTED');
  assert.equal(classifyRunResult({ code: 1, timedOut: false }, { exitStatus: 'LimitsExceeded' }, { status: 'REJECTED' }), 'FAILED');
  assert.equal(classifyRunResult({ code: 0, timedOut: true }, { exitStatus: 'Submitted' }, { status: 'ACCEPTED' }), 'TIMED_OUT');
});

test('Python provider ledger reserves before calls, shares retries and fences unknown usage', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-budget-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const source = resolve('scripts/delivery/baseline').replaceAll('\\', '/');
  const ledger = join(output, 'usage.jsonl').replaceAll('\\', '/');
  const script = `import sys\nsys.path.insert(0, ${JSON.stringify(source)})\nfrom provider_budget import ProviderBudget, BudgetError\nprofile = {'budgets': {'maxInputTokensPerCall': 10, 'maxOutputTokensPerCall': 5, 'maxModelCalls': 2, 'maxTotalTokens': 30, 'maxApiUsd': 1}, 'model': {'maxContextTokens': 20, 'inputUsdPerMillion': 1, 'outputUsdPerMillion': 2}}\np = ProviderBudget(${JSON.stringify(ledger)}, profile, 'T1', 'A1')\na = p.reserve(10, 5)\np.settle(a, 'provider-1', 8, 3)\np2 = ProviderBudget(${JSON.stringify(ledger)}, profile, 'T1', 'A2')\nb = p2.reserve(10, 5)\np2.unknown(b, 'timeout')\ntry:\n    p2.reserve(1, 1)\nexcept BudgetError as e:\n    assert 'unresolved' in str(e)\nelse:\n    raise AssertionError('unknown response must fence retry')\nprint('budget-ok')\n`;
  const result = execFileSync(PYTHON, ['-c', script], { encoding: 'utf8' });
  assert.match(result, /budget-ok/);
  const rows = (await readFile(join(output, 'usage.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(rows.map(row => row.kind), ['RESERVE', 'SETTLED', 'RESERVE', 'UNKNOWN']);
});

test('reservation overshoot and a third attempt cannot exceed the shared call budget', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-budget-limit-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const source = resolve('scripts/delivery/baseline').replaceAll('\\', '/');
  const ledger = join(output, 'usage.jsonl').replaceAll('\\', '/');
  const script = `import sys\nsys.path.insert(0, ${JSON.stringify(source)})\nfrom provider_budget import ProviderBudget, BudgetError\nprofile = {'budgets': {'maxInputTokensPerCall': 10, 'maxOutputTokensPerCall': 5, 'maxModelCalls': 2, 'maxTotalTokens': 30, 'maxApiUsd': 1}, 'model': {'maxContextTokens': 20, 'inputUsdPerMillion': 1, 'outputUsdPerMillion': 2}}\np = ProviderBudget(${JSON.stringify(ledger)}, profile, 'T1', 'A1')\na = p.reserve(10, 5)\np.settle(a, 'provider-1', 8, 3)\np = ProviderBudget(${JSON.stringify(ledger)}, profile, 'T1', 'A2')\nb = p.reserve(10, 5)\np.settle(b, 'provider-2', 8, 3)\ntry:\n    p.reserve(1, 1)\nexcept BudgetError as e:\n    assert 'exhausted' in str(e)\nelse:\n    raise AssertionError('third provider call exceeded budget')\nprint('shared-budget-ok')\n`;
  assert.match(execFileSync(PYTHON, ['-c', script], { encoding: 'utf8' }), /shared-budget-ok/);
  const overshoot = join(output, 'overshoot.jsonl').replaceAll('\\', '/');
  const overshootScript = `import sys\nsys.path.insert(0, ${JSON.stringify(source)})\nfrom provider_budget import ProviderBudget, BudgetError\nprofile = {'budgets': {'maxInputTokensPerCall': 10, 'maxOutputTokensPerCall': 5, 'maxModelCalls': 2, 'maxTotalTokens': 30, 'maxApiUsd': 1}, 'model': {'maxContextTokens': 20, 'inputUsdPerMillion': 1, 'outputUsdPerMillion': 2}}\np = ProviderBudget(${JSON.stringify(overshoot)}, profile, 'T1', 'A1')\na = p.reserve(10, 5)\ntry:\n    p.settle(a, 'provider-1', 11, 3)\nexcept BudgetError as e:\n    assert 'exceeds reservation' in str(e)\nelse:\n    raise AssertionError('overshoot must fail')\ntry:\n    p.reserve(1, 1)\nexcept BudgetError as e:\n    assert 'unresolved' in str(e)\nelse:\n    raise AssertionError('overshoot uncertainty must fence future calls')\nprint('overshoot-fenced')\n`;
  assert.match(execFileSync(PYTHON, ['-c', overshootScript], { encoding: 'utf8' }), /overshoot-fenced/);
});

test('worst-case per-wire reservation exhausts a 50000-token execution instead of under-reserving', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-provider-exhaustion-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const source = resolve('scripts/delivery/baseline').replaceAll('\\', '/');
  const ledger = join(output, 'usage.jsonl').replaceAll('\\', '/');
  const script = `import sys
sys.path.insert(0, ${JSON.stringify(source)})
from provider_budget import ProviderBudget, BudgetError
profile = {'budgets': {'maxInputTokensPerCall': 16384, 'maxOutputTokensPerCall': 4096, 'maxModelCalls': 12, 'maxWireRequestsPerExecution': 24, 'maxTotalTokens': 50000, 'maxApiUsd': 5}, 'model': {'maxContextTokens': 32768, 'inputUsdPerMillion': 0, 'outputUsdPerMillion': 0}}
budget = ProviderBudget(${JSON.stringify(ledger)}, profile, 'NORM-01', 'attempt-1')
for index, usage in enumerate([(12000,1800),(13000,2957)]):
    request = budget.reserve(10000,4096)
    reservation = budget._events()[-1]
    assert reservation['inputTokensReserved'] == 16384 and reservation['outputTokensReserved'] == 4096
    budget.settle(request, 'provider-'+str(index), usage[0], usage[1])
try:
    budget.reserve(100,4096)
except BudgetError as error:
    assert 'exhausted' in str(error)
else:
    raise AssertionError('29,757 actual tokens plus the 20,480 worst-case reservation must exceed 50,000')
assert len([row for row in budget._events() if row['kind']=='RESERVE']) == 2
print('resource-exhaustion-explicit')
`;
  assert.match(execFileSync(PYTHON, ['-c', script], { encoding: 'utf8' }), /resource-exhaustion-explicit/);
});

test('Python provider calls reserve and settle individually in the shared resource journal', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-resource-bridge-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const journalPath = join(output, 'events.jsonl');
  const identity = { profileHash: 'sha256:profile', candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40), protocolHash: 'sha256:protocol' };
  const limits = { maxConcurrentProviderRequests: 1, minRequestIntervalSeconds: 0, maxWireRequestsPerExecution: 8,
    maxTotalTokensPerExecution: 50, maxApiUsdPerExecution: 1, maxAttemptsPerExecution: 2,
    maxProviderWaitSeconds: 3600, maxExecutionActiveSeconds: 1200, maxCohortWallSeconds: 3600 };
  const resource = new ResourceState({ journalPath, experimentId: 'bridge-test', ...identity, limits });
  await resource.registerExecution({ executionId: 'P01:DIRECT', pairId: 'P01', taskId: 'NORM-01', arm: 'DIRECT', repeat: 1, deadline: new Date(Date.now() + 60_000).toISOString() });
  await resource.registerAttempt({ executionId: 'P01:DIRECT', attemptId: 'P01:DIRECT:attempt-1', attemptNumber: 1 });
  const context = { journalPath, experimentId: 'bridge-test', ...identity, limits: resource.limits, executionId: 'P01:DIRECT' };
  const source = resolve('scripts/delivery/baseline').replaceAll('\\', '/');
  const ledger = join(output, 'provider-ledger.jsonl').replaceAll('\\', '/');
  const script = `import sys,json
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(source)})
from provider_budget import ProviderBudget
root = Path(${JSON.stringify(output.replaceAll('\\', '/'))})
profile = {'budgets': {'maxInputTokensPerCall': 10, 'maxOutputTokensPerCall': 5, 'maxModelCalls': 8, 'maxWireRequestsPerExecution': 8, 'maxTotalTokens': 50, 'maxApiUsd': 1, 'maxProviderWaitSeconds': 3600}, 'model': {'maxContextTokens': 20, 'inputUsdPerMillion': 0, 'outputUsdPerMillion': 0}}
resource = json.loads(${JSON.stringify(JSON.stringify(context))})
budget = ProviderBudget(root/'provider-ledger.jsonl', profile, 'NORM-01', 'P01:DIRECT:attempt-1', root, resource, ${JSON.stringify(join(resolve('scripts/delivery/baseline'), 'resource-bridge.mjs').replaceAll('\\', '/'))}, ${JSON.stringify(process.execPath)})
for index in range(3):
    request = budget.reserve(2, 5)
    budget.send_started(request)
    raw = {'id': 'provider-'+str(index), 'model': 'model', 'usage': {'input_tokens': 2, 'output_tokens': 1}}
    proof = budget.attest(request, raw, 'RETRIEVABLE_RECORD')
    budget.settle(request, raw['id'], 2, 1, evidence=proof)
print('resource-bridge-ok')
`;
  assert.match(execFileSync(PYTHON, ['-c', script], { encoding: 'utf8' }), /resource-bridge-ok/);
  const state = await resource.state();
  assert.equal(state.counters.wireRequests, 3);
  assert.equal(state.counters.settled, 3);
  assert.equal(state.executions['P01:DIRECT'].status, 'RUNNING');
  assert.equal(Object.values(state.requests).reduce((sum, row) => sum + row.usage.inputTokens + row.usage.outputTokens, 0), 9);
  assert.ok(Object.values(state.requests).every(row => row.inputTokensReserved === 10 && row.outputTokensReserved === 5));
  assert.ok(Object.values(state.requests).every(row => row.proof.providerEvidenceRef));
});

test('provider preflight accepts only the one exact bounded bash tool call', () => {
  const source = resolve('scripts/delivery/baseline').replaceAll('\\', '/');
  const script = `import json,sys
sys.path.insert(0, ${JSON.stringify(source)})
from probe_driver import validate_tool_call
response = {'choices': [{'message': {'tool_calls': [{'id':'call-1','function': {'name':'bash','arguments': json.dumps({'command': "printf 'EXHARNESS_PROBE_1'"})}}]}}]}
result = validate_tool_call(response, "printf 'EXHARNESS_PROBE_1'")
assert result['toolName'] == 'bash'
for invalid in [
    {'choices': [{'message': {'tool_calls': []}}]},
    {'choices': [{'message': {'tool_calls': [response['choices'][0]['message']['tool_calls'][0], response['choices'][0]['message']['tool_calls'][0]]}}]},
    {'choices': [{'message': {'tool_calls': [{'function': {'name':'bash','arguments':'{}'}}]}}]}
]:
    try: validate_tool_call(invalid, "printf 'EXHARNESS_PROBE_1'")
    except Exception: pass
    else: raise AssertionError('invalid probe tool call accepted')
print('probe-contract-ok')
`;
  assert.match(execFileSync(PYTHON, ['-c', script], { encoding: 'utf8' }), /probe-contract-ok/);
});

test('provider probe driver config binds the registered attempt before launch', () => {
  const attemptId = 'SETUP:PROBE-1:attempt-1';
  const config = buildProviderProbeConfig({ profile: { model: {}, budgets: {} }, probeId: 'PROBE-1',
    probeCommand: "printf 'EXHARNESS_PROBE_1'", attemptId, ledgerPath: '/tmp/provider-ledger.jsonl',
    evidenceRoot: '/tmp/study', resourceContext: { executionId: 'SETUP:PROBE-1' },
    resourceBridgePath: '/tmp/resource-bridge.mjs', nodeExecutable: process.execPath, resultPath: '/tmp/result.json' });
  assert.equal(config.attemptId, attemptId);
  assert.throws(() => buildProviderProbeConfig({ ...config, attemptId: '' }), /configuration is incomplete/);
  assert.equal(providerProbeDriverTimeoutMs(180, 1200), 190_000);
  assert.throws(() => providerProbeDriverTimeoutMs(1200, 1200), /active-time ceiling/);
});

test('proven 429 admission failure releases reservation but keeps the wire attempt', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-budget-non-admission-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const source = resolve('scripts/delivery/baseline').replaceAll('\\\\', '/');
  const ledger = join(output, 'usage.jsonl').replaceAll('\\\\', '/');
  const script = `import sys,json
sys.path.insert(0, ${JSON.stringify(source)})
from provider_budget import ProviderBudget
profile = {'budgets': {'maxInputTokensPerCall': 10, 'maxOutputTokensPerCall': 5, 'maxModelCalls': 3, 'maxWireRequestsPerExecution': 3, 'maxTotalTokens': 50, 'maxApiUsd': 1}, 'model': {'maxContextTokens': 20, 'inputUsdPerMillion': 1, 'outputUsdPerMillion': 2}}
p = ProviderBudget(${JSON.stringify(ledger)}, profile, 'T1', 'A1')
first = p.reserve(10, 5)
proof = p.record_non_admission(first, 429, '2', 'rate limited')
p.not_admitted(first, 'HTTP_429_NOT_ADMITTED', proof)
second = p.reserve(10, 5)
p.settle(second, 'provider-2', 8, 3)
rows = p._events()
assert [row['kind'] for row in rows] == ['RESERVE', 'NOT_ADMITTED', 'RESERVE', 'SETTLED']
assert len([row for row in rows if row['kind'] == 'RESERVE']) == 2
print('non-admission-ok')
`;
  assert.match(execFileSync(PYTHON, ['-c', script], { encoding: 'utf8' }), /non-admission-ok/);
});

test('NIM 200 completes directly and only HTTP 202 polls by requestId', () => {
  const source = resolve('scripts/delivery/baseline').replaceAll('\\', '/');
  const script = `import json,sys,threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, ${JSON.stringify(source)})
from mini_driver import _nim_chat_completion
request_id = '12345678-1234-1234-1234-123456789abc'
completion = {'id':'chatcmpl-test','model':'nvidia/nemotron-3.5-lightning-30b-a3b','choices':[], 'usage':{'prompt_tokens':5,'completion_tokens':3}}
calls = []
class Handler(BaseHTTPRequestHandler):
    pending = True
    def log_message(self, *_): pass
    def send_json(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(encoded))); self.end_headers(); self.wfile.write(encoded)
    def do_POST(self):
        calls.append(('POST',self.path))
        assert self.path == '/v1/chat/completions'
        assert self.headers['Authorization'] == 'Bearer test-token'
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert body['model'] == completion['model'] and body['reasoning_budget'] == 256 and body['tool_choice'] == 'required'
        self.send_json(202, {'requestId':request_id}) if Handler.pending else self.send_json(200, completion)
    def do_GET(self):
        calls.append(('GET',self.path))
        assert self.path == '/v1/status/' + request_id
        self.send_json(200, completion)
server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread = threading.Thread(target=server.serve_forever,daemon=True); thread.start()
model = {'apiBaseUrl':'http://127.0.0.1:'+str(server.server_port)+'/v1','providerModelId':completion['model'],'toolChoice':'required','temperature':1,'topP':0.95,'reasoningBudget':256,'requestTimeoutSeconds':5}
try:
    result, trace = _nim_chat_completion(model,[{'role':'user','content':'test'}],[], 'test-token',16)
    assert result['id'] == completion['id'] and [item['httpStatus'] for item in trace] == [202,200]
    Handler.pending = False
    result, trace = _nim_chat_completion(model,[{'role':'user','content':'test'}],[], 'test-token',16)
    assert result['id'] == completion['id'] and trace == []
    assert [method for method,_ in calls] == ['POST','GET','POST']
finally:
    server.shutdown(); server.server_close()
print('nim-transport-ok')
`;
  assert.match(execFileSync(PYTHON, ['-c', script], { encoding: 'utf8' }), /nim-transport-ok/);
});

test('NIM completion attestation settles measured usage, preserves absent cache, and fences invalid responses', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-nim-ledger-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const source = resolve('scripts/delivery/baseline').replaceAll('\\', '/');
  const script = `import hashlib,json,sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(source)})
from mini_driver import settle_provider_response
from provider_budget import ProviderBudget, BudgetError
root = Path(${JSON.stringify(output.replaceAll('\\', '/'))})
model = {'provider':'nvidia_nim','providerModelId':'nvidia/nemotron-3.5-lightning-30b-a3b','evidenceMode':'ORIGINAL_RESPONSE_ATTESTED','maxContextTokens':20,'inputUsdPerMillion':0,'cachedInputUsdPerMillion':0,'outputUsdPerMillion':0}
profile = {'budgets':{'maxInputTokensPerCall':10,'maxOutputTokensPerCall':5,'maxModelCalls':2,'maxTotalTokens':30,'maxApiUsd':1},'model':model}
raw = {'id':'chatcmpl-1','model':model['providerModelId'],'choices':[],'usage':{'prompt_tokens':8,'completion_tokens':3}}
budget = ProviderBudget(root/'NORM-01'/'provider-ledger.jsonl',profile,'NORM-01','A1')
identity = budget.reserve(10,5)
event = settle_provider_response(budget,identity,raw,model)
assert event['kind']=='SETTLED' and event['cachedInputTokens'] is None and event['cacheEvidence']=='NOT_REPORTED' and event['costUsd']==0
record = root/event['providerEvidenceRef']
assert 'sha256:'+hashlib.sha256(record.read_bytes()).hexdigest() == event['providerEvidenceHash']
for label,bad in [('missing',{'id':'chatcmpl-2','model':model['providerModelId'],'choices':[]}),('wrong-model',{**raw,'model':'other'})]:
    guard = ProviderBudget(root/label/'provider-ledger.jsonl',profile,label,'A1')
    call = guard.reserve(10,5)
    try: settle_provider_response(guard,call,bad,model)
    except BudgetError: pass
    else: raise AssertionError(label+' response was accepted')
    assert guard._events()[-1]['kind']=='UNKNOWN'
    try: guard.reserve(1,1)
    except BudgetError as error: assert 'unresolved' in str(error)
    else: raise AssertionError('unknown response did not fence the next call')
print('nim-ledger-ok')
`;
  assert.match(execFileSync(PYTHON, ['-c', script], { encoding: 'utf8' }), /nim-ledger-ok/);
});

test('NIM evidence auditor rejects changed response bytes and returned model drift', async t => {
  const output = await mkdtemp(join(tmpdir(), 'baseline-nim-audit-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const identities = await fixtureIdentities();
  const template = JSON.parse(await readFile(resolve('scripts/delivery/baseline/profile.json'), 'utf8'));
  const imageDigest = `sha256:${'d'.repeat(64)}`;
  const model = template.model;
  const armHash = sha256({ model, nodeVersion: NODE_VERSION, miniCommit: MINI_COMMIT, agentImageDigest: imageDigest, budgets: PROTOCOL.budgets });
  const profile = { ...template, template: false, experimentId: 'nim-audit-test', operatorId: 'operator', reviewerId: 'reviewer',
    protocolHash: PROTOCOL_HASH, candidateSha: 'a'.repeat(40), candidateTree: 'b'.repeat(40), ...identities,
    nodeVersion: NODE_VERSION, playwrightVersion: PLAYWRIGHT_VERSION, pythonExecutable: 'C:/python312/python.exe',
    nodeImageDigest: imageDigest, browserDigest: imageDigest, pythonLockDigest: imageDigest,
    agentImageDigest: imageDigest, agentImage: `fixture@${imageDigest}`, budgets: structuredClone(PROTOCOL.budgets),
    calibrationTaskIds: [...CALIBRATION_TASK_IDS], contexts: [], armProfileHashes: { DIRECT: armHash, EXHARNESS: armHash } };
  const requestId = 'a'.repeat(32), providerRequestId = 'chatcmpl-nim-audit';
  const ref = `NORM-01/provider-responses/${requestId}.json`;
  const raw = { schemaVersion: 1, evidenceMode: 'ORIGINAL_RESPONSE_ATTESTED', captureFormat: 'NVIDIA_CHAT_COMPLETIONS_JSON_V1',
    requestId, taskId: 'NORM-01', capturedAt: '2026-09-25T00:00:00Z', statusTrace: [],
    response: { id: providerRequestId, model: model.providerModelId, choices: [], usage: { prompt_tokens: 8, completion_tokens: 3 } } };
  const bytes = Buffer.from(JSON.stringify(raw) + '\n');
  const row = { schemaVersion: 1, taskId: 'NORM-01', attemptId: 'A1', requestId, providerRequestId, status: 'SETTLED',
    inputTokens: 8, cachedInputTokens: null, cacheEvidence: 'NOT_REPORTED', outputTokens: 3, costUsd: 0,
    returnedModelId: model.providerModelId, providerEvidenceMode: 'ORIGINAL_RESPONSE_ATTESTED', providerEvidenceRef: ref,
    providerEvidenceHash: `sha256:${sha256(bytes)}` };
  await mkdir(join(output, 'NORM-01', 'provider-responses'), { recursive: true });
  await writeFile(join(output, 'profile.json'), JSON.stringify(profile));
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ profileHash: sha256(profile) }));
  await writeFile(join(output, 'usage.jsonl'), JSON.stringify(row) + '\n');
  await writeFile(join(output, ref), bytes);
  assert.deepEqual(reconcileOriginalResponse(raw, row, model), { cachedInputVerification: 'NOT_REPORTED' });
  assert.throws(() => reconcileOriginalResponse({ ...raw, response: { ...raw.response, model: 'other' } }, row, model), /identity or usage/);
  assert.equal((await exportProviderRecords({ profilePath: join(output, 'profile.json'), output, operatorId: 'operator' })).exported, 1);
  await writeFile(join(output, ref), Buffer.from(JSON.stringify({ ...raw, response: { ...raw.response, usage: { prompt_tokens: 9, completion_tokens: 3 } } }) + '\n'));
  await assert.rejects(() => exportProviderRecords({ profilePath: join(output, 'profile.json'), output, operatorId: 'operator' }), /evidence changed/);
});
