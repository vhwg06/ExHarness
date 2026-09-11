import assert from "node:assert/strict";
import test from "node:test";

import {
  Agent,
  ContextBlockTrust,
  ModelRouteScope,
  ObjectAgentMemberKind,
  TraceSpanKind,
  agenticMethod,
  createObjectAgent,
  createPredictStrategy,
  createTraceRecorder,
  getObjectAgentRuntime,
  objectAgentSurface,
  objectMethodCall
} from "../src/index.js";

test("object agent preserves identity while ordinary methods become runtime capabilities", async () => {
  class InventoryAgent extends Agent {
    constructor() {
      super();
      this.inventory = new Map([["gpu", 3]]);
    }

    stock(sku) {
      return this.inventory.get(sku) ?? 0;
    }

    answer = agenticMethod({
      description: "Answer one stock query.",
      strategy: {
        kind: "STOCK_ANSWER",
        async run({ input, invoke }) {
          return invoke("stock", input);
        }
      },
      parseInput(value) {
        if (typeof value !== "string") throw new TypeError("sku must be text");
        return value;
      },
      parseOutput(value) {
        if (!Number.isInteger(value)) throw new TypeError("stock must be integer");
        return value;
      }
    });
  }

  const raw = new InventoryAgent();
  const agent = createObjectAgent(raw, {
    methods: {
      stock: { description: "Return current stock for one SKU." }
    }
  });

  assert.equal(agent, raw);
  assert.equal(agent instanceof InventoryAgent, true);
  assert.equal(agent instanceof Agent, true);
  assert.equal(agent.stock("gpu"), 3);
  assert.equal(typeof agent.answer, "function");
  assert.equal(await agent.answer("gpu"), 3);

  const runtime = getObjectAgentRuntime(agent);
  assert.deepEqual(runtime.capabilities().map((item) => item.name), ["stock"]);
  assert.deepEqual(runtime.judgments().map((item) => item.name), ["answer"]);
});

test("object method capability supports explicit multi-argument calls without confusing one array argument", async () => {
  class MathAgent extends Agent {
    add(left, right) {
      return left + right;
    }

    arrayLength(values) {
      return values.length;
    }

    solve = agenticMethod({
      strategy: {
        kind: "MATH_SOLVE",
        async run({ input, invoke }) {
          const sum = await invoke("add", objectMethodCall(input[0], input[1]));
          const length = await invoke("arrayLength", [1, 2, 3]);
          return { sum, length };
        }
      }
    });
  }

  const agent = createObjectAgent(new MathAgent());
  assert.deepEqual(await agent.solve(2, 5), { sum: 7, length: 3 });
});

test("subclass dispatch and inherited agent methods use the real object implementation", async () => {
  class BaseAgent extends Agent {
    inherited() {
      return "base-only";
    }

    label() {
      return "base";
    }
  }

  class ChildAgent extends BaseAgent {
    label() {
      return "child";
    }

    inspect = agenticMethod({
      strategy: {
        kind: "DISPATCH_INSPECT",
        async run({ invoke }) {
          return {
            label: await invoke("label", null),
            inherited: await invoke("inherited", null)
          };
        }
      }
    });
  }

  const agent = createObjectAgent(new ChildAgent());
  assert.deepEqual(await agent.inspect(), { label: "child", inherited: "base-only" });
  assert.deepEqual(
    getObjectAgentRuntime(agent).capabilities().map((item) => item.name).sort(),
    ["inherited", "label"]
  );
});

test("stateful tools remain isolated per object instance", async () => {
  class CounterAgent extends Agent {
    constructor() {
      super();
      this.count = 0;
    }

    increment(delta) {
      this.count += delta;
      return this.count;
    }

    bump = agenticMethod({
      strategy: {
        kind: "COUNTER_BUMP",
        async run({ input, invoke }) {
          return invoke("increment", input);
        }
      }
    });
  }

  const first = createObjectAgent(new CounterAgent());
  const second = createObjectAgent(new CounterAgent());

  assert.equal(await first.bump(2), 2);
  assert.equal(await first.bump(3), 5);
  assert.equal(await second.bump(1), 1);
  assert.equal(first.count, 5);
  assert.equal(second.count, 1);
});

test("hidden/private methods never become automatic capabilities but remain ordinary caller methods", async () => {
  class SafetyAgent extends Agent {
    visible() {
      return "visible";
    }

    dangerous() {
      return "caller-only";
    }

    _secret() {
      return "secret";
    }

    _hiddenThought = agenticMethod({
      hidden: true,
      strategy: {
        kind: "HIDDEN_THOUGHT",
        async run() {
          return "hidden-agentic";
        }
      }
    });
  }

  const agent = createObjectAgent(new SafetyAgent(), {
    methods: {
      dangerous: { hidden: true, description: "Must never be model-visible." }
    }
  });
  const runtime = getObjectAgentRuntime(agent);

  assert.deepEqual(runtime.capabilities().map((item) => item.name), ["visible"]);
  assert.equal(agent.dangerous(), "caller-only");
  assert.equal(agent._secret(), "secret");
  assert.equal(await agent._hiddenThought(), "hidden-agentic");

  const visible = objectAgentSurface(agent);
  assert.deepEqual(visible.members.map((member) => member.name), ["visible"]);

  const all = objectAgentSurface(agent, { includeHidden: true });
  const hiddenNames = all.members.filter((member) => member.hidden).map((member) => member.name).sort();
  assert.deepEqual(hiddenNames, ["_hiddenThought", "_secret", "dangerous"]);
});

test("arbitrary class wrapping does not expose inherited library prototype APIs by default", () => {
  class VisibleMap extends Map {
    lookup(key) {
      return this.get(key) ?? null;
    }
  }

  const agent = createObjectAgent(new VisibleMap([["x", 1]]));
  const names = getObjectAgentRuntime(agent).capabilities().map((item) => item.name);
  assert.deepEqual(names, ["lookup"]);
  assert.equal(names.includes("set"), false);
  assert.equal(names.includes("get"), false);
});

test("agentic ordinary method preserves typed judgment, context, routing and tracing semantics", async () => {
  let seenRequest = null;
  const tracer = createTraceRecorder();

  class ClassifierAgent extends Agent {
    classify = agenticMethod({
      description: "Classify one text input.",
      strategy: createPredictStrategy({ maxAttempts: 1 }),
      model: "primary",
      context: { blocks: ["policy"], history: false },
      parseInput(value) {
        if (typeof value !== "string") throw new TypeError("text must be string");
        return { text: value };
      },
      parseOutput(value) {
        if (!value || value.label !== "ok") throw new TypeError("invalid classification");
        return value;
      }
    });
  }

  const agent = createObjectAgent(new ClassifierAgent(), {
    tracer,
    contextBlocks: [{
      name: "policy",
      trust: ContextBlockTrust.TRUSTED,
      value: { rule: "grounded" }
    }],
    models: [
      {
        name: "primary",
        version: "1",
        async generate(request) {
          seenRequest = request;
          return { label: "ok", source: "primary" };
        }
      },
      {
        name: "alternate",
        version: "1",
        async generate() {
          return { label: "ok", source: "alternate" };
        }
      }
    ]
  });

  const report = await agent.classify.report("hello");
  assert.deepEqual(report.result, { label: "ok", source: "primary" });
  assert.deepEqual(seenRequest.input, { text: "hello" });
  assert.equal(seenRequest.promptContext.blocks[0].name, "policy");
  assert.equal(seenRequest.promptContext.blocks[0].value.rule, "grounded");
  assert.equal(report.modelRoute.scope, ModelRouteScope.JUDGMENT);
  assert.equal(report.modelRoute.adapter.name, "primary");
  assert.equal(report.modelUsage.calls, 1);

  const alternate = await agent.classify.withOptions({ model: "alternate" }, "hello");
  assert.deepEqual(alternate, { label: "ok", source: "alternate" });

  const spans = tracer.spans();
  assert.ok(spans.some((span) => span.kind === TraceSpanKind.JUDGMENT));
  assert.ok(spans.some((span) => span.kind === TraceSpanKind.MODEL));
});

test("deterministic method can call an agentic sibling through normal this dispatch", async () => {
  class WorkflowAgent extends Agent {
    answer = agenticMethod({
      strategy: {
        kind: "ANSWER",
        async run({ input }) {
          return `agent:${input}`;
        }
      }
    });

    async workflow(input) {
      return this.answer(input);
    }
  }

  const agent = createObjectAgent(new WorkflowAgent());
  assert.equal(await agent.workflow("x"), "agent:x");
});

test("public then method is rejected unless explicitly hidden", () => {
  class ThenableAgent extends Agent {
    then() {
      return "dangerous";
    }
  }

  assert.throws(
    () => createObjectAgent(new ThenableAgent()),
    /public method 'then' must be hidden/
  );

  const hidden = createObjectAgent(new ThenableAgent(), { hidden: ["then"] });
  assert.equal(hidden.then(), "dangerous");
  assert.deepEqual(getObjectAgentRuntime(hidden).capabilities(), []);
});

test("surface distinguishes deterministic and agentic members without exposing function bodies", () => {
  class SurfaceAgent extends Agent {
    deterministic() {
      return true;
    }

    reason = agenticMethod({
      description: "Reason over input.",
      strategy: {
        kind: "REASON",
        async run() {
          return true;
        }
      },
      parseInput(value) { return value; },
      parseOutput(value) { return value; }
    });
  }

  const agent = createObjectAgent(new SurfaceAgent(), {
    methods: { deterministic: { description: "Deterministic helper." } }
  });
  const surface = objectAgentSurface(agent);
  const deterministic = surface.members.find((item) => item.name === "deterministic");
  const reason = surface.members.find((item) => item.name === "reason");

  assert.equal(surface.type, "SurfaceAgent");
  assert.equal(deterministic.kind, ObjectAgentMemberKind.DETERMINISTIC);
  assert.equal(deterministic.description, "Deterministic helper.");
  assert.equal(reason.kind, ObjectAgentMemberKind.AGENTIC);
  assert.equal(reason.typedInput, true);
  assert.equal(reason.typedOutput, true);
  assert.equal(JSON.stringify(surface).includes("async run"), false);
});
