import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentRuntime,
  createEventBus,
  defineJudgment,
  instrumentAgentRuntime
} from "../src/index.js";

function textInput(value) {
  assert.equal(typeof value, "string");
  assert.ok(value.length > 0);
  return value;
}

function categoryOutput(value) {
  assert.ok(value && typeof value === "object");
  assert.ok(["A", "B"].includes(value.category));
  return Object.freeze({ category: value.category });
}

test("typed judgment validates input before strategy execution", async () => {
  let calls = 0;
  const runtime = createAgentRuntime({
    strategy: {
      async run({ input }) {
        calls += 1;
        return { category: input === "alpha" ? "A" : "B" };
      }
    },
    judgments: [
      defineJudgment({
        name: "classify",
        parseInput: textInput,
        parseOutput: categoryOutput
      })
    ]
  });

  await assert.rejects(
    runtime.invokeJudgment("classify", ""),
    /false == true|The expression evaluated to a falsy value/
  );
  assert.equal(calls, 0);

  assert.deepEqual(await runtime.invokeJudgment("classify", "alpha"), { category: "A" });
  assert.equal(calls, 1);
});

test("typed judgment rejects invalid output before it reaches the caller", async () => {
  const runtime = createAgentRuntime({
    strategy: {
      async run() {
        return { category: "NOT_ALLOWED" };
      }
    },
    judgments: [
      defineJudgment({
        name: "classify",
        parseOutput: categoryOutput
      })
    ]
  });

  await assert.rejects(
    runtime.invokeJudgment("classify", "alpha"),
    /false == true|The expression evaluated to a falsy value/
  );
});

test("judgment-local strategy overrides only that judgment", async () => {
  const defaultCalls = [];
  const overrideCalls = [];
  const runtime = createAgentRuntime({
    strategy: {
      async run({ input }) {
        defaultCalls.push(input);
        return `default:${input}`;
      }
    },
    judgments: [
      defineJudgment({
        name: "special",
        strategy: {
          async run({ input }) {
            overrideCalls.push(input);
            return `special:${input}`;
          }
        }
      }),
      defineJudgment({ name: "normal" })
    ]
  });

  assert.equal(await runtime.invokeJudgment("special", "x"), "special:x");
  assert.equal(await runtime.invokeJudgment("normal", "y"), "default:y");
  assert.equal(await runtime.run({ input: "z" }), "default:z");

  assert.deepEqual(overrideCalls, ["x"]);
  assert.deepEqual(defaultCalls, ["y", "z"]);
});

test("runtime exposes judgment metadata without exposing parser or strategy functions", () => {
  const runtime = createAgentRuntime({
    strategy: { async run() { return null; } },
    judgments: [
      defineJudgment({
        name: "classify",
        description: "Classify one item.",
        parseInput: textInput,
        parseOutput: categoryOutput,
        strategy: { async run() { return { category: "A" }; } }
      })
    ]
  });

  assert.deepEqual(runtime.judgments(), [
    {
      name: "classify",
      description: "Classify one item.",
      typedInput: true,
      typedOutput: true,
      strategyOverride: true
    }
  ]);
});

test("duplicate judgment names fail fast", () => {
  assert.throws(
    () => createAgentRuntime({
      strategy: { async run() { return null; } },
      judgments: [
        defineJudgment({ name: "same" }),
        defineJudgment({ name: "same" })
      ]
    }),
    /duplicate judgment: same/
  );
});

test("judgment report preserves generic run usage semantics", async () => {
  const runtime = createAgentRuntime({
    strategy: {
      async run({ invoke }) {
        return invoke("echo", "hello");
      }
    },
    capabilities: [
      {
        name: "echo",
        execute(value) {
          return value;
        }
      }
    ],
    judgments: [defineJudgment({ name: "echo-judgment" })]
  });

  const report = await runtime.invokeJudgmentWithReport("echo-judgment", null, {
    budget: { maxCapabilityCalls: 2 }
  });

  assert.equal(report.result, "hello");
  assert.equal(report.usage.capabilityCalls, 1);
  assert.equal(report.usage.maxCapabilityCalls, 2);
  assert.equal(report.judgment.name, "echo-judgment");
});

test("observability instrumentation preserves the typed judgment surface", async () => {
  const runtime = createAgentRuntime({
    strategy: {
      async run({ input }) {
        return { category: input === "alpha" ? "A" : "B" };
      }
    },
    judgments: [
      defineJudgment({
        name: "classify",
        parseInput: textInput,
        parseOutput: categoryOutput
      })
    ]
  });
  const instrumented = instrumentAgentRuntime(runtime, createEventBus());

  assert.equal(typeof instrumented.invokeJudgment, "function");
  assert.equal(typeof instrumented.invokeJudgmentWithReport, "function");
  assert.deepEqual(instrumented.judgments(), runtime.judgments());
  assert.deepEqual(await instrumented.invokeJudgment("classify", "alpha"), { category: "A" });
});
