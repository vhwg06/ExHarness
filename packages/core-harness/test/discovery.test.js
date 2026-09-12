import assert from "node:assert/strict";
import test from "node:test";

import {
  Agent,
  DiscoveryMode,
  ExHarnessErrorCode,
  agenticMethod,
  createAgentRuntime,
  createObjectAgent,
  createPredictStrategy,
  defineLiveObjectSurface,
  docLiveObject,
  docObjectAgent,
  getObjectAgentRuntime,
  renderLiveObjectDoc
} from "../src/index.js";

function modelAdapter(generate) {
  return { name: "discovery-model", async generate(request) { return generate(request); } };
}

test("object-agent judgments automatically receive a bounded concise self document", async () => {
  let seenRequest = null;
  class InventoryAgent extends Agent {
    stock(sku) { return sku === "gpu" ? 3 : 0; }
    _secret() { return "nope"; }
    answer = agenticMethod({
      description: "Answer an inventory question.",
      strategy: createPredictStrategy({
        model: modelAdapter((request) => {
          seenRequest = request;
          return "ok";
        })
      }),
      parseOutput(value) {
        if (typeof value !== "string") throw new TypeError("string required");
        return value;
      }
    });
  }

  const agent = createObjectAgent(new InventoryAgent(), {
    methods: { stock: { description: "Read stock by SKU." } },
    discoveryPolicy: { maxMembers: 8, maxChars: 2_048, maxDescriptionChars: 64 }
  });

  assert.equal(await agent.answer("gpu"), "ok");
  const block = seenRequest.promptContext.blocks.find((item) => item.name === "__exharness_self_doc__");
  assert.ok(block);
  assert.equal(block.trust, "TRUSTED");
  assert.equal(block.value.kind, "OBJECT_AGENT_DOC");
  assert.equal(block.value.mode, DiscoveryMode.CONCISE);
  assert.deepEqual(block.value.members.map((item) => item.name), ["answer", "stock"]);
  assert.equal(JSON.stringify(block.value).includes("_secret"), false);
});

test("doc(self) supports concise/full progressive rendering without exposing hidden members", () => {
  class ToolAgent extends Agent {
    alpha() { return 1; }
    beta() { return 2; }
    _private() { return 3; }
    ask = agenticMethod({
      strategy: { async run() { return true; } }
    });
  }

  const agent = createObjectAgent(new ToolAgent(), {
    methods: {
      alpha: { description: "Alpha description.", mutatesCandidate: true },
      beta: { description: "Beta description." }
    }
  });

  const concise = docObjectAgent(agent, { mode: DiscoveryMode.CONCISE });
  const full = docObjectAgent(agent, { mode: DiscoveryMode.FULL });
  assert.ok(concise.metrics.chars < full.metrics.chars);
  assert.deepEqual(concise.document.members.map((item) => item.name), ["alpha", "ask", "beta"]);
  assert.equal(JSON.stringify(full.document).includes("_private"), false);
  assert.equal(full.document.members.find((item) => item.name === "alpha").mutatesCandidate, true);
});

test("discovery bounds deterministically truncate members and descriptions", () => {
  const surface = {
    id: "bounded.surface",
    type: "Bounded",
    methods: Array.from({ length: 10 }, (_, index) => ({
      name: `method${index}`,
      description: "x".repeat(200),
      mutates: false,
      allowLiveArgs: false,
      typedArgs: false,
      typedOutput: false,
      returnsLive: false
    })),
    properties: []
  };
  const rendered = renderLiveObjectDoc(surface, {
    mode: DiscoveryMode.FULL,
    policy: { maxMembers: 3, maxChars: 1_024, maxDescriptionChars: 16 }
  });
  assert.equal(rendered.document.members.length, 3);
  assert.equal(rendered.document.truncation.members, true);
  assert.ok(rendered.metrics.chars <= 1_024);
  assert.equal(rendered.document.members[0].description.length, 16);
  assert.equal(rendered.document.members[0].descriptionTruncated, true);
});

test("doc(handle) respects describe authorization and does not grant invoke authority", async () => {
  const value = {
    visible() { return "visible"; },
    dangerous() { return "danger"; }
  };
  const surface = defineLiveObjectSurface({
    id: "discovery.authority",
    methods: [
      { name: "visible", description: "Visible method." },
      { name: "dangerous", description: "Discoverable but denied." }
    ]
  });
  const runtime = createAgentRuntime({
    strategy: { async run() { return true; } },
    liveObjects: [{ name: "root", value, surface }],
    liveObjectAuthorize(request) {
      if (request.action === "INVOKE_LIVE" && request.member?.name === "dangerous") return false;
      return true;
    }
  });
  const ref = runtime.liveObjects()[0].ref;
  const doc = await docLiveObject(runtime, ref, { mode: DiscoveryMode.FULL });
  assert.ok(doc.document.members.some((item) => item.name === "dangerous"));
  await assert.rejects(
    runtime.invokeLiveObject(ref, "dangerous", []),
    (error) => error.code === ExHarnessErrorCode.LIVE_OBJECT_ACCESS_DENIED
  );
});

test("progressive discovery materially reduces initial disclosure for a broad surface", () => {
  class BroadAgent extends Agent {}
  for (let index = 0; index < 20; index += 1) {
    Object.defineProperty(BroadAgent.prototype, `method${String(index).padStart(2, "0")}`, {
      value() { return index; },
      configurable: true
    });
  }
  BroadAgent.prototype.ask = function ask() { return true; };

  const methods = Object.fromEntries(Array.from({ length: 21 }, (_, index) => {
    const name = index === 20 ? "ask" : `method${String(index).padStart(2, "0")}`;
    return [name, { description: `Detailed API description for ${name}: ${"x".repeat(80)}` }];
  }));
  const agent = createObjectAgent(new BroadAgent(), { methods });
  const concise = docObjectAgent(agent, { mode: DiscoveryMode.CONCISE });
  const full = docObjectAgent(agent, { mode: DiscoveryMode.FULL });

  assert.ok(concise.metrics.chars < full.metrics.chars * 0.6, `${concise.metrics.chars} !< 60% of ${full.metrics.chars}`);
  assert.equal(concise.metrics.members, full.metrics.members);
});

test("runtime remains available for explicit live-object doc composition", async () => {
  class A extends Agent {
    ask = agenticMethod({ strategy: { async run() { return true; } } });
  }
  const agent = createObjectAgent(new A());
  assert.equal(typeof getObjectAgentRuntime(agent).describeLiveObject, "function");
});
