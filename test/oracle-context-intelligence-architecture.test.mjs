import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as oracle from "../packages/oracle/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
function filesUnder(relative) {
  const base = path.join(root, relative);
  return fs.readdirSync(base, { recursive: true }).filter(name => /\.(?:js|mjs|json)$/.test(name)).map(name => path.join(base, name));
}
function boundaryViolations({ oracleSource, coreSource, adapterSource, agenticPackage, oracleExports }) {
  const violations = [];
  if (/(?:from\s*["'][^"']*(?:agentic-system|core-harness)|import\s*(?:\(["']|["'])[^"']*(?:agentic-system|core-harness))/.test(oracleSource)) violations.push("Oracle reverse import");
  if (/@exharness\/oracle|packages\/oracle|\.\.\/\.\.\/oracle/.test(coreSource)) violations.push("Core Oracle implementation import");
  if (/\.readFile\s*\(|\.readArtifact\s*\(/.test(adapterSource)) violations.push("copied source loop");
  if (agenticPackage.dependencies?.["@exharness/oracle"] !== "file:../oracle") violations.push("missing package dependency");
  if (oracleExports.join(",") !== "DurabilityFailure,ProviderFailure,ProviderFailureReason,ProviderOperation,ResolutionStoreError,SourceObservationState,assertConsumableContextResolution,contextItemDigest,contextMaterializationId,contextRequirementId,contextResolutionId,createContextGraphProvider,createDurableResolutionCoordinator,createExactArtifactProvider,createExactRepositoryProvider,createExternalSourceProvider,createLexicalSearchProvider,createResolutionStore,createRetrievalPlanner,createSemanticCodeProvider,createSourceCatalog,createStructuralMapProvider,defineContextRequirement,defineContextResolution,defineContextResolutionReceipt,defineDerivationInput,defineProviderCandidate,defineProviderDescriptor,defineResolverConfiguration,defineSourceObservation,evaluateReceiptCurrentness,isReusableResolution,observationDigest,projectStructuralMap,readApplicationArtifacts,readRepositorySources,receiptId,resolverConfigDigest,reuseKey") violations.push("Oracle exports");
  if (/\b(?:claimWork|publishDelivery|acceptWork|recoverWork|scheduleWork)\s*\(/.test(oracleSource)) violations.push("Oracle lifecycle authority");
  return violations;
}
const fixture = () => ({
  oracleSource: filesUnder("packages/oracle/src").map(file => fs.readFileSync(file, "utf8")).join("\n"),
  coreSource: filesUnder("packages/core-harness/src").map(file => fs.readFileSync(file, "utf8")).join("\n") + read("packages/core-harness/package.json"),
  adapterSource: read("packages/agentic-system/src/oracle.js"),
  agenticPackage: JSON.parse(read("packages/agentic-system/package.json")),
  oracleExports: Object.keys(oracle).sort()
});

test("Oracle architecture boundary and dependency direction", () => {
  assert.deepEqual(boundaryViolations(fixture()), []);
  assert.match(read("packages/agentic-system/src/oracle.js"), /\.\.\/\.\.\/oracle\/src\/index\.js/);
});

test("architecture guard rejects mutated forbidden imports, loops, wiring, exports and authority", () => {
  const cases = [
    { oracleSource: 'import "../../agentic-system/src/oracle.js";' },
    { oracleSource: 'import "../../core-harness/src/context.js";' },
    { coreSource: 'import "@exharness/oracle";' },
    { adapterSource: 'reader.readFile({ path: "a" })' },
    { adapterSource: 'reader.readArtifact({ ref: "a" })' },
    { agenticPackage: { dependencies: {} } },
    { oracleExports: ["readRepositorySources", "resolveContext"] },
    { oracleSource: 'function publishDelivery() {}' }
  ];
  for (const mutation of cases) assert.notDeepEqual(boundaryViolations({ ...fixture(), ...mutation }), [], JSON.stringify(mutation));
});

test("Living Docs mark delivered semantic contract and deferred limits without work IDs", () => {
  for (const name of ["architecture", "state", "semantics", "workflow"]) {
    const doc = read(`docs/living/system/oracle/${name}.md`);
    assert.match(doc, /@exharness\/oracle/);
    assert.match(doc, /ContextRequirement\/ContextResolution/);
    assert.match(doc, /Core.*(?:resolver|hook)|resolver.*Core/s);
    assert.match(doc, /provider|Provider/);
    assert.doesNotMatch(doc, /\bBB-\d+\b/);
  }
});

test("research evidence and provider selection deferred with license", () => {
  const plan = JSON.parse(read("docs/blackboard/artifacts/ready-implement-plan/BB-060.json"));
  assert.equal(plan.externalEvidenceSummary.comparisons.length >= 3, true);
  for (const comparison of plan.externalEvidenceSummary.comparisons) {
    assert.match(comparison.source, /github\.com\/[^/]+\/[^/]+\/tree\/[a-f0-9]{40}/);
    assert.ok(comparison.license);
  }
  assert.match(plan.externalEvidenceSummary.thresholdRule, />=1,000/);
  assert.match(plan.externalEvidenceSummary.selectionRule, /BB-062/);
  assert.match(read("docs/living/system/oracle/architecture.md"), /Serena.*GPL-3\.0-or-later.*SolidLSP.*MIT/s);
});
