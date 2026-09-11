import assert from "node:assert/strict";
import test from "node:test";

import {
  Agent,
  agenticMethod,
  createObjectAgent,
  getObjectAgentRuntime,
  objectMethodCall
} from "../src/index.js";

test("object-agent discovery never executes getters or accessors", () => {
  let getterCalls = 0;

  class GetterAgent extends Agent {
    get dangerous() {
      getterCalls += 1;
      throw new Error("getter must never execute during discovery");
    }

    visible() {
      return "ok";
    }
  }

  const agent = createObjectAgent(new GetterAgent());
  assert.equal(getterCalls, 0);
  assert.deepEqual(getObjectAgentRuntime(agent).capabilities().map((item) => item.name), ["visible"]);
  assert.equal(getterCalls, 0);
});

test("non-function subclass shadowing cannot reveal a same-named base capability", () => {
  class BaseAgent extends Agent {
    dangerous() {
      return "base";
    }
  }

  class ChildAgent extends BaseAgent {
    constructor() {
      super();
      Object.defineProperty(this, "dangerous", {
        value: "shadowed",
        configurable: true,
        writable: true
      });
    }

    visible() {
      return "visible";
    }
  }

  const agent = createObjectAgent(new ChildAgent());
  assert.deepEqual(getObjectAgentRuntime(agent).capabilities().map((item) => item.name), ["visible"]);
});

test("objectMethodCall preserves a true zero-argument invocation", async () => {
  class ArityAgent extends Agent {
    argumentCount() {
      return arguments.length;
    }

    inspect = agenticMethod({
      strategy: {
        kind: "ARITY_INSPECT",
        async run({ invoke }) {
          return invoke("argumentCount", objectMethodCall());
        }
      }
    });
  }

  const agent = createObjectAgent(new ArityAgent());
  assert.equal(await agent.inspect(), 0);
});

test("capability implementation is bound at attach time and cannot be laundered by monkeypatching", async () => {
  class StableAuthorityAgent extends Agent {
    value() {
      return "trusted";
    }

    inspect = agenticMethod({
      strategy: {
        kind: "AUTHORITY_INSPECT",
        async run({ invoke }) {
          return invoke("value", objectMethodCall());
        }
      }
    });
  }

  const agent = createObjectAgent(new StableAuthorityAgent());
  assert.equal(await agent.inspect(), "trusted");

  agent.value = function value() {
    return "patched";
  };

  // Application callers see ordinary JavaScript mutation semantics.
  assert.equal(agent.value(), "patched");
  // Model/runtime capability authority remains bound to the body reviewed at attach time.
  assert.equal(await agent.inspect(), "trusted");
});

test("agentic marker replacement failure is rejected before partially attaching the runtime", () => {
  const instance = {};
  Object.defineProperty(instance, "reason", {
    value: agenticMethod({
      strategy: {
        kind: "REASON",
        async run() {
          return "ok";
        }
      }
    }),
    configurable: false,
    enumerable: true,
    writable: false
  });

  assert.throws(
    () => createObjectAgent(instance),
    /agentic method field must be configurable: reason/
  );
  assert.throws(
    () => getObjectAgentRuntime(instance),
    /value is not an ExHarness object agent/
  );
});
