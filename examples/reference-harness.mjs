// In an external project this import is simply:
// import { AVOCapability, EvaluationValidity, EvaluationVerdict, createHarness } from "exharness";
import {
  AVOCapability,
  EvaluationValidity,
  EvaluationVerdict,
  createHarness
} from "../packages/core-harness/src/index.js";

const harness = createHarness({
  strategy: {
    async run({ input, invoke }) {
      const current = Number(input.candidate.version.slice(1));
      const nextVersion = `v${current + 1}`;
      await invoke(AVOCapability.ACT, { nextVersion });
      await invoke(AVOCapability.EVALUATE);
      await invoke(AVOCapability.PROMOTE);
      return { nextVersion };
    }
  },
  environment: {
    async observe({ candidate }) {
      return { candidate };
    },
    async act({ candidate, action }) {
      return {
        mutated: true,
        candidate: { id: candidate.id, version: action.nextVersion },
        result: { advanced: true }
      };
    }
  },
  objective: {
    async evaluate({ candidate }) {
      return {
        validity: EvaluationValidity.VALID,
        verdict: EvaluationVerdict.PASS,
        evidence: [`accepted:${candidate.version}`]
      };
    }
  }
});

await harness.start({
  sessionId: "reference",
  work: { objective: "advance one committed candidate" },
  seedCandidate: { id: "reference-candidate", version: "v0" }
});

const result = await harness.vary("reference");
if (!result.lineage.advanced || result.lineage.after.candidate.version !== "v1") {
  throw new Error("reference harness failed to advance committed lineage");
}

console.log(JSON.stringify({
  ok: true,
  candidate: result.after,
  lineageHead: result.lineage.after.candidate,
  events: harness.events().length
}));
