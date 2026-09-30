// Adversarial semantic-currentness races: stale inputs cannot publish,
// invalidation stays reverse-dependent and bounded, and a mid-flight race
// lands STALE instead of silently accepted (AC-4, INV-6). All pauses are
// explicit barrier rendezvous; no sleeps, no test-only locks.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createJsonImmutableArtifactStore } from "../src/organization-artifact-store.js";
import { createDomainExecutionArtifactRegistry } from "../src/domain-execution-store.js";
import {
  createDomainPublicationGate,
  createDomainWriteAuthority,
} from "../src/domain-write-authority.js";
import { createProductLineageStore, productRevision } from "../src/product-lineage.js";
import { deferred, withScratch } from "./helpers/recovery-harness.js";

const claim = (key, content = "v1", domain = "BA") => ({
  kind: "SEMANTIC_CLAIM",
  projectId: "p",
  rootIntentId: "intent",
  domain,
  semanticKind: domain === "BA" ? "requirement" : "architecture",
  subjectKey: key,
  content,
});

async function openLineageWorld(t) {
  const dir = await withScratch(t, "exharness-bb057-currentness-");
  const artifactStore = createJsonImmutableArtifactStore({ path: join(dir, "artifacts.json") });
  const registry = createDomainExecutionArtifactRegistry({ store: artifactStore });
  const lineage = createProductLineageStore({ path: join(dir, "lineage.json"), artifactStore });
  const writeAuthority = createDomainWriteAuthority({
    path: join(dir, "writers.json"),
    artifactStore,
    policyAuthority: {
      async verifyDomainWriteAuthorityPublisher({ publisher }) {
        return publisher === "admin" ? { authorityRef: "write-policy-admin" } : null;
      },
    },
  });
  await writeAuthority.publish({
    publisher: "admin",
    policy: {
      domain: "BA",
      generation: 1,
      principalRefs: ["principal:BA"],
      semanticKinds: ["requirement"],
      obligations: [],
    },
  });
  await writeAuthority.publish({
    publisher: "admin",
    policy: {
      domain: "SA",
      generation: 1,
      principalRefs: ["principal:SA"],
      semanticKinds: ["architecture"],
      obligations: [],
    },
  });
  let count = 0;
  let receiptHook = null;
  const hookedRegistry = {
    ...registry,
    async putDomainPublicationReceipt(value) {
      if (receiptHook) await receiptHook(value);
      return registry.putDomainPublicationReceipt(value);
    },
  };
  const hooks = {
    setReceiptHook(hook) { receiptHook = hook; },
  };
  function makeGate(artifactRegistry, domain = "BA") {
    return createDomainPublicationGate({
      writeAuthority,
      lineage,
      artifactRegistry,
      resolveProductOutput: (ref) => artifactStore.resolve(ref),
      producerPrincipalRef: `principal:${domain}`,
    });
  }
  const gate = makeGate(registry);
  const hookedGate = makeGate(hookedRegistry);
  const saGate = makeGate(registry, "SA");
  const hookedSaGate = makeGate(hookedRegistry, "SA");
  async function prepare(values, { inputs = [], key = null, domain = "BA" } = {}) {
    const records = values.map(productRevision);
    for (const record of records) {
      assert.equal(
        await artifactStore.put("semantic-claim", record.value),
        record.ref,
      );
    }
    const publicationKey = key ?? `publication:${++count}`;
    const contract = {
      projectId: "p",
      rootIntentId: "intent",
      contractRef: `contract:${publicationKey}`,
      owningDomain: domain,
    };
    const outcome = {
      outputArtifactRefs: records.map((record) => ({ ref: record.ref, digest: record.ref.split(":").at(-1) })),
      proposedDerivationEdges: records.map((record) => ({ outputRef: record.ref, derivedFrom: inputs })),
    };
    const completionDecision = {
      kind: "DOMAIN_COMPLETION_DECISION",
      version: 1,
      verdict: "ACCEPT",
      domain,
      workContractRef: contract.contractRef,
      executionAttemptOutcomeRef: `outcome:${publicationKey}`,
      executionAttemptBindingRef: `binding:${publicationKey}`,
    };
    const completionDecisionRef = await registry.putDomainCompletionDecision(completionDecision);
    return {
      publicationKey,
      contract,
      outcome,
      completionDecision,
      completionDecisionRef,
      outcomeRef: completionDecision.executionAttemptOutcomeRef,
      bindingRef: completionDecision.executionAttemptBindingRef,
      lifecycleObservation: {
        workContractRef: contract.contractRef,
        claimRelease: { receiptRef: `claim-release:${publicationKey}` },
      },
    };
  }
  async function publish(values, { inputs = [], key = null, hooked = false, domain = "BA" } = {}) {
    const args = await prepare(values, { inputs, key, domain });
    const plain = domain === "SA" ? saGate : gate;
    const hookedActive = domain === "SA" ? hookedSaGate : hookedGate;
    const active = hooked ? hookedActive : plain;
    return active.withCurrentWriteAuthority(
      { domain, producerPrincipalRef: active.producerPrincipalRef },
      (observation) => active.publishIdempotent({ ...args, writeAuthorityObservation: observation }),
    );
  }
  return { dir, artifactStore, registry, lineage, gate, saGate, hooks, prepare, publish };
}

test("semantic input drift during execution blocks stale publication while the sibling stays current", async (t) => {
  const world = await openLineageWorld(t);
  const upstreamV1 = claim("upstream", "v1");
  const sibling = claim("sibling", "v1");
  const upstreamRefV1 = productRevision(upstreamV1).ref;
  const siblingRef = productRevision(sibling).ref;
  await world.publish([upstreamV1], { key: "seed-upstream-v1" });
  await world.publish([sibling], { key: "seed-sibling" });
  // Drift lands first: the input revision the stale worker consumed is gone.
  const upstreamV2 = claim("upstream", "v2");
  await world.publish([upstreamV2], { key: "drift-upstream-v2" });
  const stale = productRevision({ ...claim("dependent", "built-on-v1") }).ref;
  const args = await world.prepare([claim("dependent", "built-on-v1")], { inputs: [upstreamRefV1], key: "stale-attempt" });
  assert.equal(args.outcome.proposedDerivationEdges[0].derivedFrom[0], upstreamRefV1);
  await assert.rejects(
    world.gate.withCurrentWriteAuthority(
      { domain: "BA", producerPrincipalRef: world.gate.producerPrincipalRef },
      (observation) => world.gate.publishIdempotent({ ...args, writeAuthorityObservation: observation }),
    ),
    /not ACTIVE/,
    "stale semantic input must block publication",
  );
  assert.equal((await world.lineage.assertCurrent(productRevision(upstreamV2).ref)).revisionRef, productRevision(upstreamV2).ref);
  assert.equal((await world.lineage.assertCurrent(siblingRef)).revisionRef, siblingRef, "unrelated sibling stays current");
  await assert.rejects(world.lineage.assertCurrent(stale), /not ACTIVE/, "the stale dependent never became current");
});

test("invalidation is reverse-dependent and bounded: only the affected closure goes stale", async (t) => {
  const world = await openLineageWorld(t);
  const upstream = claim("upstream", "v1");
  const dependent = claim("dependent", "v1");
  const leaf = claim("leaf", "v1");
  const sibling = claim("sibling", "v1");
  const upstreamRecord = productRevision(upstream);
  const dependentRecord = productRevision(dependent);
  const leafRecord = productRevision(leaf);
  const siblingRecord = productRevision(sibling);
  await world.publish([upstream], { key: "chain-u" });
  await world.publish([dependent], { inputs: [upstreamRecord.ref], key: "chain-d" });
  await world.publish([leaf], { inputs: [dependentRecord.ref], key: "chain-e" });
  await world.publish([sibling], { key: "chain-s" });

  const impacted = await world.lineage.invalidate([upstreamRecord.subjectKey], { reasonRef: "drift:upstream-v2" });
  assert.deepEqual(
    impacted,
    [upstreamRecord.subjectKey, dependentRecord.subjectKey, leafRecord.subjectKey].sort(),
    "invalidation covers exactly the reverse-dependent closure",
  );
  const snapshot = await world.lineage.snapshot();
  assert.equal(snapshot.heads[upstreamRecord.subjectKey].status, "STALE");
  assert.equal(snapshot.heads[dependentRecord.subjectKey].status, "STALE");
  assert.equal(snapshot.heads[leafRecord.subjectKey].status, "STALE");
  assert.equal(snapshot.heads[siblingRecord.subjectKey].status, "ACTIVE", "unrelated work remains current");
  assert.equal((await world.lineage.assertCurrent(siblingRecord.ref)).revisionRef, siblingRecord.ref);
  await assert.rejects(world.lineage.assertCurrent(dependentRecord.ref), /not ACTIVE/);
  await assert.rejects(world.lineage.assertCurrent(leafRecord.ref), /not ACTIVE/);
});

test("a publication racing supersession lands STALE instead of silently accepted", async (t) => {
  const world = await openLineageWorld(t);
  const upstreamV1 = claim("upstream", "v1");
  const upstreamRefV1 = productRevision(upstreamV1).ref;
  await world.publish([upstreamV1], { key: "race-seed" });
  const entered = deferred();
  const resume = deferred();
  world.hooks.setReceiptHook(async (receipt) => {
    if (receipt.publicationKey !== "racing") return;
    entered.resolve();
    await resume.promise;
  });
  const racing = world.publish([claim("dependent", "built-on-v1", "SA")], {
    inputs: [upstreamRefV1],
    key: "racing",
    hooked: true,
    domain: "SA",
  });
  await entered.promise;
  await world.publish([claim("upstream", "v2")], { key: "race-drift" });
  resume.resolve();
  await racing;
  const snapshot = await world.lineage.snapshot();
  const dependentSubject = productRevision(claim("dependent", "built-on-v1", "SA")).subjectKey;
  assert.equal(snapshot.heads[dependentSubject].status, "STALE", "consumed-head drift reconciles the dependent STALE");
  await assert.rejects(
    world.lineage.assertCurrent(productRevision(claim("dependent", "built-on-v1", "SA")).ref),
    /not ACTIVE/,
  );
  assert.equal(
    (await world.lineage.assertCurrent(productRevision(claim("upstream", "v2")).ref)).head.status,
    "ACTIVE",
  );
});

test("a superseded historical revision cannot authorize a new mutation", async (t) => {
  const world = await openLineageWorld(t);
  const upstreamV1 = claim("upstream", "v1");
  await world.publish([upstreamV1], { key: "hist-seed" });
  await world.publish([claim("upstream", "v2")], { key: "hist-drift" });
  const args = await world.prepare([upstreamV1], { key: "hist-replay" });
  await assert.rejects(
    world.gate.withCurrentWriteAuthority(
      { domain: "BA", producerPrincipalRef: world.gate.producerPrincipalRef },
      (observation) => world.gate.publishIdempotent({ ...args, writeAuthorityObservation: observation }),
    ),
    /cannot authorize new mutation/,
    "superseded bytes must not authorize new effects",
  );
});
