// External sanity selection: pure, preregistered and blind to downstream model outcomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RULE, candidateOrder, parseDatasetToml, reservedTasks, selectExternalSanity, shortName } from '../external-sanity.mjs';

const d = n => `sha256:${n.toString(16).padStart(64, '0')}`;
const tasks = [
  { name: 'terminal-bench/zeta', digest: d(5) }, { name: 'terminal-bench/alpha', digest: d(3) }, { name: 'terminal-bench/fix-git', digest: d(1) },
  { name: 'terminal-bench/beta', digest: d(4) }, { name: 'terminal-bench/gamma', digest: d(2) }, { name: 'terminal-bench/fix-git-extra', digest: d(6) }
];
const pass = { oracle: Array(5).fill('ACCEPTED'), nop: ['REJECTED'] };

test('dataset.toml parsing takes name and pinned digest of every task', () => {
  const text = '[dataset]\nname = "tb"\n\n[[tasks]]\nname = "terminal-bench/a"\ndigest = "' + d(1) + '"\n\n[[tasks]]\nname = "terminal-bench/b"\ndigest = "' + d(2) + '"\n';
  assert.deepEqual(parseDatasetToml(text), [{ name: 'terminal-bench/a', digest: d(1) }, { name: 'terminal-bench/b', digest: d(2) }]);
  assert.throws(() => parseDatasetToml('[[tasks]]\nname = "x"\n'.padStart(30, '\n')), /malformed/);
  assert.equal(shortName('terminal-bench/fix-git'), 'fix-git');
});

test('tasks named by whole word or referenced by digest in a canonical plan are reserved', () => {
  const plans = [{ ref: 'plan-a.json', text: 'uses fix-git and ' + d(4).slice(7) }, { ref: 'plan-b.json', text: 'nothing about fix-gitx here' }];
  const reserved = reservedTasks(plans, tasks);
  assert.deepEqual(reserved.map(entry => entry.name), ['terminal-bench/fix-git', 'terminal-bench/beta']);
  assert.ok(!reserved.some(entry => entry.name === 'terminal-bench/fix-git-extra'), 'a longer task name is not reserved by a prefix');
  assert.deepEqual(reserved[0].plans, ['plan-a.json']);
});

test('candidate order is ascending pinned digest over the unreserved tasks', () => {
  const order = candidateOrder(tasks, reservedTasks([{ ref: 'p', text: 'fix-git' }], tasks));
  assert.deepEqual(order.map(task => shortName(task.name)), ['gamma', 'alpha', 'beta', 'zeta', 'fix-git-extra']);
});

test('selection seals exactly two tasks after oracle 5/5 and nop fail 1/1, disqualifying in order', () => {
  const order = candidateOrder(tasks, []);
  const controls = {
    'terminal-bench/fix-git': { oracle: ['REJECTED'], nop: [] },
    'terminal-bench/gamma': { oracle: Array(5).fill('ACCEPTED'), nop: ['ACCEPTED'] },
    'terminal-bench/alpha': pass,
    'terminal-bench/beta': pass
  };
  const result = selectExternalSanity(order, controls);
  assert.equal(result.status, 'SEALED');
  assert.deepEqual(result.selected.map(entry => shortName(entry.name)), ['alpha', 'beta']);
  assert.deepEqual(result.disqualified.map(entry => shortName(entry.name)), ['fix-git', 'gamma']);
  assert.match(result.disqualified[1].reason, /nop was ACCEPTED/);
  assert.equal(RULE.select, 2);
});

test('an oracle that is NOT_EVALUATED also disqualifies (only ACCEPTED counts)', () => {
  const order = candidateOrder(tasks.slice(1, 4), []);
  const result = selectExternalSanity(order, { [order[0].name]: { oracle: ['ACCEPTED', 'NOT_EVALUATED'], nop: [] }, [order[1].name]: pass, [order[2].name]: pass });
  assert.equal(result.status, 'SEALED');
  assert.equal(result.disqualified[0].name, order[0].name);
});

test('changing selection after seeing outcomes is INVALID: skipping ahead, extra runs, or running past two', () => {
  const order = candidateOrder(tasks, []);
  const skipped = selectExternalSanity(order, { [order[1].name]: pass, [order[2].name]: pass });
  assert.equal(skipped.status, 'INVALID');
  assert.match(skipped.violations.join(';'), /out of order/);
  const pastTwo = selectExternalSanity(order, { [order[0].name]: pass, [order[1].name]: pass, [order[2].name]: pass });
  assert.equal(pastTwo.status, 'INVALID');
  assert.match(pastTwo.violations.join(';'), /already selected/);
  const continued = selectExternalSanity(order, { [order[0].name]: { oracle: ['REJECTED', 'ACCEPTED'], nop: [] }, [order[1].name]: pass, [order[2].name]: pass });
  assert.equal(continued.status, 'INVALID');
  const extraOracle = selectExternalSanity(order, { [order[0].name]: { oracle: Array(6).fill('ACCEPTED'), nop: ['REJECTED'] }, [order[1].name]: pass });
  assert.equal(extraOracle.status, 'INVALID');
});

test('fewer than two qualifying tasks is INCONCLUSIVE, never padded', () => {
  const order = candidateOrder(tasks.slice(0, 2), []);
  const result = selectExternalSanity(order, { [order[0].name]: pass, [order[1].name]: { oracle: ['REJECTED'], nop: [] } });
  assert.equal(result.status, 'INCONCLUSIVE');
  assert.equal(result.selected.length, 1);
});
