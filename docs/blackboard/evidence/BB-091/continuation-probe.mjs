// Discrimination + progression probe for Oracle post-foundation continuations (BB-091/BB-092 research).
// Usage from repository root: node docs/blackboard/evidence/BB-091/continuation-probe.mjs
// Runs the delivered BB-062 retrieval benchmark and a ContextResolution progression check. No network/model.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as O from '../../../../packages/oracle/src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const bench = JSON.parse(execFileSync('node', ['scripts/oracle-context-intelligence/bb062-retrieval-benchmark.mjs'], { cwd: root, encoding: 'utf8' }));
const arms = Object.fromEntries(Object.entries(bench.aggregate).map(([arm, a]) => [arm, { recallAt3: +a.recallAt3.toFixed(3), mrr: +a.mrr.toFixed(3), materializedBytes: Math.round(a.materializedBytes) }]));
const selections = (arm) => bench.attempts.filter((x) => x.arm === arm).map((x) => x.selectedCorpusIndexes.join(','));
const identical = (a, b) => JSON.stringify(selections(a)) === JSON.stringify(selections(b));

// Progression: the delivered contract accepts step 1 chained to step 0; the delivered facade exposes no progression input.
const requirement = O.defineContextRequirement({ consumerRef: 'probe', semanticNeed: 'n', evidence: [
  { id: 'a', necessity: 'REQUIRED', need: 'n', source: { kind: 'REPOSITORY', ref: 'r', snapshot: { mode: 'EXACT', ref: 's' }, itemRefs: ['a.js'] } },
  { id: 'b', necessity: 'OPTIONAL', need: 'n', source: { kind: 'REPOSITORY', ref: 'r', snapshot: { mode: 'EXACT', ref: 's' }, itemRefs: ['b.js'] } }
], budget: { maxItems: 4, maxMaterializedBytes: 100000, maxProviderCalls: 4, maxResolutionSteps: 2 } });
const item = (id) => ({ evidenceId: id, rank: 0, source: { kind: 'REPOSITORY', ref: 'r', snapshotRef: 's', itemRef: `${id}.js` }, currentness: { validators: [{ kind: 'REVISION', value: 's', strength: 'STRONG' }] }, provenance: [{ kind: 'SOURCE_REF', ref: `r@s:${id}.js` }], content: id });
const step0 = O.defineContextResolution({ requirementId: requirement.requirementId, step: { index: 0, previousResolutionId: null }, status: 'PARTIAL', items: [item('a')], unresolved: [{ evidenceId: 'b', reason: 'BUDGET_EXHAUSTED' }], consumed: { items: 1, materializedBytes: 1000, providerCalls: 1, resolutionSteps: 1 } }, requirement);
const step1 = O.defineContextResolution({ requirementId: requirement.requirementId, step: { index: 1, previousResolutionId: step0.resolutionId }, status: 'COMPLETE', items: [item('a'), item('b')], unresolved: [], consumed: { items: 2, materializedBytes: 2000, providerCalls: 2, resolutionSteps: 2 } }, requirement, step0);
let overStep = null;
try { O.defineContextResolution({ requirementId: requirement.requirementId, step: { index: 2, previousResolutionId: step1.resolutionId }, status: 'COMPLETE', items: [item('a'), item('b')], unresolved: [], consumed: { items: 2, materializedBytes: 2000, providerCalls: 2, resolutionSteps: 3 } }, requirement, step1); } catch (e) { overStep = e.message; }
const facadeSource = fs.readFileSync(path.join(root, 'packages/oracle/src/context-resolution.js'), 'utf8');

const result = {
  kind: 'BB091_CONTINUATION_PROBE_RESULT', version: 1, snapshotRef: bench.snapshotRef,
  deliveredBenchmark: {
    arms,
    referenceResearch: bench.referenceResearch,
    structuralPrimaryReported: bench.structuralPrimary,
    lexicalEqualsSemanticSelections: identical('lexical', 'semantic/symbol'),
    lexicalEqualsStructuralSelections: identical('lexical', 'structural-map'),
    aggregateRecallMrrIdenticalAcrossLexicalSemanticStructural: ['semantic/symbol','structural-map'].every((a) => arms[a].recallAt3 === arms.lexical.recallAt3 && arms[a].mrr === arms.lexical.mrr),
    deliveredTypedGraphBelowResearch: arms['typed graph/context'].recallAt3 < bench.referenceResearch.typedGraphRecallAt3
  },
  progression: {
    contractAcceptsChainedStep: step1.step.index === 1 && step1.step.previousResolutionId === step0.resolutionId,
    contractRejectsStepBeyondBudget: overStep,
    facadeHardcodesStepZero: /step: \{ index: 0, previousResolutionId: null \}/.test(facadeSource),
    facadeResolveSignature: (facadeSource.match(/async function resolve\([^)]*\)/) ?? [null])[0],
    facadeAcceptsPrevious: /async function resolve\([^)]*previous/.test(facadeSource)
  }
};
fs.writeFileSync(path.join(here, 'continuation-probe-result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ arms: result.deliveredBenchmark.arms, bench: result.deliveredBenchmark, progression: result.progression }));
