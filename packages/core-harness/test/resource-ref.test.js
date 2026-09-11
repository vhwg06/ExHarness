import assert from "node:assert/strict";
import test from "node:test";

import {
  ExHarnessErrorCode,
  ResourceLifetime,
  ResourceRefKind,
  createAgentRuntime,
  createEventBus,
  createPredictStrategy,
  createResourceRegistry,
  defineResource,
  instrumentAgentRuntime
} from "../src/index.js";

function repoResource(name = "repo", value = null, lifetime = ResourceLifetime.AGENT) {
  const live = value ?? {
    publicName: "example",
    secretToken: "super-secret",
    files: new Map([["README.md", "hello"]]),
    dangerousInternalDelete() {
      return "must never be reflected";
    }
  };

  return defineResource({
    name,
    description: "Repository workspace",
    lifetime,
    metadata: { kind: "repository" },
    value: live,
    operations: [
      {
        name: "read",
        description: "Read one file",
        async execute(resource, input) {
          return { content: resource.files.get(input.path) ?? null };
        }
      },
      {
        name: "write",
        description: "Write one file",
        mutates: true,
        async execute(resource, input) {
          resource.files.set(input.path, input.content);
          return { written: true };
        }
      }
    ]
  });
}

test("ResourceRef progressively exposes declared metadata without serializing the live object", async () => {
  let observed = null;
  const runtime = createAgentRuntime({
    resources: [repoResource()],
    strategy: {
      async run({ resources, describeResource }) {
        observed = {
          ref: resources[0],
          description: await describeResource(resources[0])
        };
        return "ok";
      }
    }
  });

  await runtime.run();

  assert.equal(observed.ref.kind, ResourceRefKind);
  assert.equal(observed.ref.name, "repo");
  assert.equal("value" in observed.ref, false);
  assert.equal("operations" in observed.ref, false, "operation list requires explicit discovery");
  assert.deepEqual(observed.description.metadata, { kind: "repository" });
  assert.deepEqual(observed.description.operations.map((operation) => operation.name), ["read", "write"]);

  const visible = JSON.stringify(observed);
  assert.equal(visible.includes("super-secret"), false);
  assert.equal(visible.includes("dangerousInternalDelete"), false);
});

test("only declared resource operations are invokable; live methods are never reflected", async () => {
  const runtime = createAgentRuntime({
    resources: [repoResource()],
    strategy: {
      async run({ resources, invokeResource }) {
        await assert.rejects(
          () => invokeResource(resources[0], "dangerousInternalDelete"),
          (error) => error.code === ExHarnessErrorCode.RESOURCE_OPERATION_NOT_ALLOWED
        );
        return invokeResource(resources[0], "read", { path: "README.md" });
      }
    }
  });

  assert.deepEqual(await runtime.run(), { content: "hello" });
});

test("CALL resources expire deterministically after the owning invocation", async () => {
  let captured = null;
  const runtime = createAgentRuntime({
    strategy: {
      async run({ resources, invokeResource }) {
        captured = resources[0];
        return invokeResource(captured, "read", { path: "README.md" });
      }
    }
  });

  assert.deepEqual(await runtime.run({
    resources: [repoResource("repo", null, ResourceLifetime.CALL)]
  }), { content: "hello" });

  await assert.rejects(
    () => runtime.describeResource(captured),
    (error) => error.code === ExHarnessErrorCode.RESOURCE_EXPIRED
  );
});

test("revoked AGENT resources fail deterministically", async () => {
  const runtime = createAgentRuntime({
    resources: [repoResource()],
    strategy: { async run() { return null; } }
  });
  const [ref] = runtime.resourceRefs();
  assert.equal(runtime.revokeResource(ref), true);
  assert.deepEqual(runtime.resourceRefs(), []);

  await assert.rejects(
    () => runtime.describeResource(ref),
    (error) => error.code === ExHarnessErrorCode.RESOURCE_REVOKED
  );
});

test("a ref from another runtime cannot cross-resolve even when names match", async () => {
  const left = createAgentRuntime({ resources: [repoResource()], strategy: { async run() { return null; } } });
  const right = createAgentRuntime({ resources: [repoResource()], strategy: { async run() { return null; } } });
  const [leftRef] = left.resourceRefs();

  await assert.rejects(
    () => right.describeResource(leftRef),
    (error) => error.code === ExHarnessErrorCode.RESOURCE_REF_INVALID
  );
});

test("concurrent CALL scopes may use the same resource name without cross-resolution", async () => {
  const runtime = createAgentRuntime({
    strategy: {
      async run({ input, resources, invokeResource }) {
        await new Promise((resolve) => setTimeout(resolve, input.delay));
        return invokeResource(resources[0], "read", { path: "README.md" });
      }
    }
  });

  const make = (content) => repoResource("repo", {
    files: new Map([["README.md", content]])
  }, ResourceLifetime.CALL);

  const [first, second] = await Promise.all([
    runtime.run({ input: { delay: 5 }, resources: [make("first")] }),
    runtime.run({ input: { delay: 0 }, resources: [make("second")] })
  ]);

  assert.deepEqual(first, { content: "first" });
  assert.deepEqual(second, { content: "second" });
});

test("CALL resources cannot shadow an AGENT resource name", async () => {
  const runtime = createAgentRuntime({
    resources: [repoResource()],
    strategy: { async run() { return null; } }
  });

  await assert.rejects(
    () => runtime.run({ resources: [repoResource("repo", null, ResourceLifetime.CALL)] }),
    /scoped resource cannot shadow runtime resource: repo/
  );
});

test("consumer authorization policy can deny a declared resource operation", async () => {
  const registry = createResourceRegistry({
    authorize({ action, operation }) {
      if (action === "INVOKE" && operation?.mutates) return false;
      return true;
    }
  });
  const runtime = createAgentRuntime({
    resourceRegistry: registry,
    resources: [repoResource()],
    strategy: {
      async run({ resources, invokeResource }) {
        return invokeResource(resources[0], "write", { path: "x", content: "y" });
      }
    }
  });

  await assert.rejects(
    () => runtime.run(),
    (error) => error.code === ExHarnessErrorCode.RESOURCE_ACCESS_DENIED
  );
});

test("resource-visible metadata and descriptions are bounded by policy", () => {
  assert.throws(
    () => createAgentRuntime({
      resourcePolicy: { maxDescriptionChars: 4 },
      resources: [repoResource()],
      strategy: { async run() { return null; } }
    }),
    (error) => error.code === ExHarnessErrorCode.RESOURCE_LIMIT_EXCEEDED
  );
});

test("resource outputs must cross a stable JSON transport boundary", async () => {
  const runtime = createAgentRuntime({
    resources: [defineResource({
      name: "opaque",
      value: { map: new Map([["x", 1]]) },
      operations: [{
        name: "leak",
        async execute(resource) {
          return resource.map;
        }
      }]
    })],
    strategy: {
      async run({ resources, invokeResource }) {
        return invokeResource(resources[0], "leak");
      }
    }
  });

  await assert.rejects(runtime.run(), /must contain only plain objects and arrays/);
});

test("Predict does not automatically forward ResourceRef or resource invocation authority to the model", async () => {
  const requests = [];
  const runtime = createAgentRuntime({
    resources: [repoResource()],
    strategy: createPredictStrategy({
      model: {
        async generate(request) {
          requests.push(request);
          return { ok: true };
        }
      }
    })
  });

  await runtime.run({ input: { task: "inspect" } });
  assert.equal("resources" in requests[0], false);
  assert.equal("describeResource" in requests[0], false);
  assert.equal("invokeResource" in requests[0], false);
  assert.equal(JSON.stringify(requests[0]).includes("super-secret"), false);
});

test("observability instrumentation preserves resource APIs without exposing live values", async () => {
  const base = createAgentRuntime({
    resources: [repoResource()],
    strategy: { async run() { return null; } }
  });
  const runtime = instrumentAgentRuntime(base, createEventBus());
  const [ref] = runtime.resourceRefs();

  assert.deepEqual(runtime.resourcePolicy(), base.resourcePolicy());
  const description = await runtime.describeResource(ref);
  assert.deepEqual(description.operations.map((operation) => operation.name), ["read", "write"]);
  assert.equal(JSON.stringify(description).includes("super-secret"), false);
});
