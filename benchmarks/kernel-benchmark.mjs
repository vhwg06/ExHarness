import { performance } from "node:perf_hooks";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  createHarness
} from "../packages/core-harness/src/index.js";

function createCommitHarness({ supervision = false } = {}) {
  return createHarness({
    strategy: {
      async run({ invoke }) {
        await invoke(AVOCapability.ACT, { nextVersion: "v1" });
        await invoke(AVOCapability.EVALUATE);
        await invoke(AVOCapability.PROMOTE);
      }
    },
    environment: {
      async observe() { return null; },
      async act({ candidate, action }) {
        return {
          mutated: true,
          candidate: { id: candidate.id, version: action.nextVersion }
        };
      }
    },
    objective: {
      async evaluate() {
        return { validity: EvaluationValidity.VALID, verdict: EvaluationVerdict.PASS };
      }
    },
    supervisor: supervision ? { async inspect() { return null; } } : null
  });
}

async function runVariant(name, { runs = 25, supervision = false } = {}) {
  let committed = 0;
  let falsePromotions = 0;
  const startedAt = performance.now();

  for (let index = 0; index < runs; index += 1) {
    const harness = createCommitHarness({ supervision });
    const sessionId = `${name}-${index}`;
    await harness.start({
      sessionId,
      work: { objective: "benchmark commit" },
      seedCandidate: { id: `candidate-${index}`, version: "v0" }
    });
    const result = await harness.vary(sessionId);
    if (result.lineage.advanced) committed += 1;
    const lineage = await harness.lineage(sessionId);
    if (lineage.length > 2) falsePromotions += 1;
  }

  const elapsedMs = performance.now() - startedAt;
  return {
    name,
    runs,
    committed,
    commitSuccessRate: committed / runs,
    falsePromotions,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    avgVariationMs: Number((elapsedMs / runs).toFixed(3))
  };
}

const baseline = await runVariant("baseline", { supervision: false });
const supervised = await runVariant("supervision-noop", { supervision: true });

const report = {
  benchmark: "kernel-control-plane",
  note: "Deterministic plumbing benchmark only; domain/model quality requires consumer workload benchmarks.",
  variants: [baseline, supervised],
  assertions: {
    allCommitted: baseline.commitSuccessRate === 1 && supervised.commitSuccessRate === 1,
    noFalsePromotion: baseline.falsePromotions === 0 && supervised.falsePromotions === 0
  }
};

if (!report.assertions.allCommitted || !report.assertions.noFalsePromotion) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(report, null, 2));
}
