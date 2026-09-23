import test from 'node:test';
import assert from 'node:assert/strict';
import { callJev, validateResponse } from '../scripts/blackboard-jev.mjs';

const payload = { model: 'jev-1.13.0', questions: {
  'objective-0': { type: 'choice', criteria: { SATISFIED: 'yes', INSUFFICIENT_EVIDENCE: 'no' } }
}};
function response(probabilities) {
  return { model: payload.model, answers: { 'objective-0': {
    type: 'choice', choice: 'SATISFIED', confidence: 0.5, probabilities
  }}, usage: { input_tokens: 1, output_tokens: 1 } };
}
test('probability diagnostics retain strict normalization and identify the failing question', () => {
  assert.throws(() => validateResponse(response({ SATISFIED: 0.6, INSUFFICIENT_EVIDENCE: 0.3 }), payload),
    /invalid probabilities: objective-0; validRange=true; sum=0.8999999999999999; count=2/);
  assert.throws(() => validateResponse(response({ SATISFIED: 0.99998, INSUFFICIENT_EVIDENCE: 0 }), payload), /invalid probabilities/);
  assert.doesNotThrow(() => validateResponse(response({ SATISFIED: 0.7, INSUFFICIENT_EVIDENCE: 0.3 }), payload));
});
test('malformed probability data is not echoed or retried', async () => {
  let calls = 0;
  await assert.rejects(() => callJev(payload, {
    apiKey: 'test-only-secret',
    fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify(response({ SATISFIED: 'untrusted-secret-text', INSUFFICIENT_EVIDENCE: 0 })));
    }
  }), error => {
    assert.match(error.message, /objective-0; validRange=false; sum=null; count=2/);
    assert.doesNotMatch(error.message, /untrusted-secret-text|test-only-secret/);
    return true;
  });
  assert.equal(calls, 1);
});
