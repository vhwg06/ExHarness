import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeContains } from '../scripts/blackboard-delivery-contract.mjs';

test('single-segment glob matches in-scope adversarial write', () => {
  assert.equal(scopeContains('packages/agentic-system/test/adversarial-*.test.js', 'packages/agentic-system/test/adversarial-currentness-races.test.js'), true);
});

test('single-segment glob does not cross directories or stems', () => {
  assert.equal(scopeContains('packages/agentic-system/test/adversarial-*.test.js', 'packages/agentic-system/test/sub/adversarial-x.test.js'), false);
  assert.equal(scopeContains('packages/agentic-system/test/adversarial-*.test.js', 'packages/agentic-system/test/other.test.js'), false);
});

test('single-segment glob in test dir and forbidden scripts glob', () => {
  assert.equal(scopeContains('packages/agentic-system/test/*.test.js', 'packages/agentic-system/test/other.test.js'), true);
  assert.equal(scopeContains('packages/agentic-system/test/*.test.js', 'packages/agentic-system/test/sub/other.test.js'), false);
  assert.equal(scopeContains('scripts/blackboard-*.mjs', 'scripts/blackboard-jev.mjs'), true);
  assert.equal(scopeContains('scripts/blackboard-*.mjs', 'scripts/other.mjs'), false);
  assert.equal(scopeContains('packages/agentic-system/src/qa-*.js', 'packages/agentic-system/src/qa-helper.js'), true);
  assert.equal(scopeContains('packages/agentic-system/src/qa-*.js', 'packages/agentic-system/src/other.js'), false);
});

test('regex metacharacters in the literal part are escaped', () => {
  assert.equal(scopeContains('a.b/*.js', 'aXb/c.js'), false);
  assert.equal(scopeContains('a.b/*.js', 'a.b/c.js'), true);
  assert.equal(scopeContains('a+b/*.js', 'a+b/c.js'), true);
  assert.equal(scopeContains('a+b/*.js', 'aaab/c.js'), false);
});

test('existing **, exact and dir/** cases still behave as before', () => {
  assert.equal(scopeContains('**', 'anything/at/all.js'), true);
  assert.equal(scopeContains('source.js', 'source.js'), true);
  assert.equal(scopeContains('source.js', 'other.js'), false);
  assert.equal(scopeContains('docs/living/**', 'docs/living'), true);
  assert.equal(scopeContains('docs/living/**', 'docs/living/x/y.md'), true);
  assert.equal(scopeContains('docs/living/**', 'docs/livingx/y.md'), false);
});

test('forbiddenWrite glob forbids matching refs via scopeContains', () => {
  const write = ['packages/agentic-system/test/adversarial-*.test.js'];
  const forbiddenWrite = ['scripts/blackboard-*.mjs'];
  const inScope = ref => write.some(p => scopeContains(p, ref)) && !forbiddenWrite.some(p => scopeContains(p, ref));
  assert.equal(inScope('packages/agentic-system/test/adversarial-currentness-races.test.js'), true);
  assert.equal(inScope('scripts/blackboard-jev.mjs'), false);
});

test('** segment in the middle matches zero or more segments', () => {
  assert.equal(scopeContains('packages/**/x.js', 'packages/x.js'), true);
  assert.equal(scopeContains('packages/**/x.js', 'packages/a/b/x.js'), true);
  assert.equal(scopeContains('packages/**/x.js', 'packages/a/b/y.js'), false);
});
