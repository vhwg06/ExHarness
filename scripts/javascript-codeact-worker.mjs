import vm from "node:vm";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pendingHost = new Map();
let nextHostId = 1;
let context = null;
let currentOutput = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorView(error) {
  return {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  };
}

function hostCall(request) {
  const id = nextHostId++;
  return new Promise((resolve, reject) => {
    pendingHost.set(id, { resolve, reject });
    send({ type: "host", id, request });
  });
}

function reviveHostError(raw) {
  const error = new Error(raw?.message ?? "host request failed");
  error.name = raw?.name ?? "Error";
  error.code = raw?.code ?? null;
  return error;
}

function isLiveRef(value) {
  return Boolean(value && typeof value === "object" && value.kind === "LIVE_OBJECT_REF");
}

const proxyRefs = new WeakMap();
const refsToProxy = new Map();

function refKey(ref) {
  return `${ref.registryId}:${ref.id}`;
}

function revive(value) {
  if (isLiveRef(value)) return liveProxy(value);
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, revive(child)]));
  }
  return value;
}

function dehydrate(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object") return value;
  if (proxyRefs.has(value)) return proxyRefs.get(value);
  if (seen.has(value)) throw new TypeError("javascript worker cannot transport cycles");
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => dehydrate(item, seen));
    seen.delete(value);
    return result;
  }
  const result = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, dehydrate(child, seen)])
  );
  seen.delete(value);
  return result;
}

function liveProxy(ref) {
  const key = refKey(ref);
  if (refsToProxy.has(key)) return refsToProxy.get(key);
  const target = Object.create(null);
  const proxy = new Proxy(target, {
    get(_target, property) {
      if (property === "then") return undefined;
      if (property === Symbol.toStringTag) return "ExHarnessLiveObject";
      if (property === "$read") {
        return async (name) => revive(await hostCall({
          type: "READ_LIVE",
          ref,
          name
        }));
      }
      if (typeof property !== "string") return undefined;
      return async (...args) => revive(await hostCall({
        type: "INVOKE_LIVE",
        ref,
        name: property,
        args: dehydrate(args)
      }));
    }
  });
  proxyRefs.set(proxy, ref);
  refsToProxy.set(key, proxy);
  return proxy;
}

function selfProxy(methods) {
  const allowed = new Set((methods ?? []).map((item) => item.name));
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === "then") return undefined;
      if (typeof property !== "string" || !allowed.has(property)) return undefined;
      return async (...args) => {
        const input = args.length === 0 ? null : args.length === 1 ? dehydrate(args[0]) : dehydrate(args);
        return revive(await hostCall({ type: "CALL_CAPABILITY", name: property, input }));
      };
    }
  });
}

class TerminalSignal extends Error {
  constructor() {
    super("return_result");
    this.name = "TerminalSignal";
  }
}

async function returnResult(value) {
  try {
    await hostCall({ type: "RETURN_RESULT", value: dehydrate(value) });
  } catch (error) {
    if (error?.code === "EXHARNESS_JAVASCRIPT_TERMINAL_INTERRUPT") throw new TerminalSignal();
    throw error;
  }
  throw new TerminalSignal();
}

async function doc(value, mode = "CONCISE") {
  if (value === context.self) return revive(await hostCall({ type: "DOC_SELF", mode }));
  const ref = value && typeof value === "object" ? proxyRefs.get(value) : null;
  if (!ref) throw new TypeError("doc() requires self or a live object proxy");
  return revive(await hostCall({ type: "DOC_LIVE", ref, mode }));
}

function initialize(bindings) {
  const sandbox = Object.create(null);
  sandbox.self = selfProxy(bindings?.self?.methods ?? []);
  sandbox.doc = doc;
  sandbox.return_result = returnResult;
  sandbox.console = Object.freeze({
    log(...values) {
      if (currentOutput) currentOutput.stdout.push(values.map(String).join(" "));
    },
    error(...values) {
      if (currentOutput) currentOutput.stderr.push(values.map(String).join(" "));
    }
  });
  for (const item of bindings?.liveObjects ?? []) sandbox[item.name] = liveProxy(item.ref);
  sandbox.globalThis = sandbox;
  context = vm.createContext(sandbox, { name: "exharness-js-codeact-reference" });
}

async function execute(message) {
  if (!context) throw new Error("worker is not initialized");
  currentOutput = { stdout: [], stderr: [] };
  try {
    // vm supplies a persistent JavaScript realm only. The parent process owns
    // cancellation/termination; this worker is not a production sandbox.
    const script = new vm.Script(`(async () => {\n${message.code}\n})()`, {
      filename: `codeact-cell-${message.id}.js`
    });
    const value = await script.runInContext(context);
    send({
      type: "execute_result",
      id: message.id,
      result: {
        stdout: currentOutput.stdout.join("\n"),
        stderr: currentOutput.stderr.join("\n"),
        value: dehydrate(value ?? null),
        terminated: false
      }
    });
  } catch (error) {
    if (error instanceof TerminalSignal) {
      send({
        type: "execute_result",
        id: message.id,
        result: {
          stdout: currentOutput.stdout.join("\n"),
          stderr: currentOutput.stderr.join("\n"),
          value: null,
          terminated: true
        }
      });
      return;
    }
    send({ type: "execution_error", id: message.id, error: errorView(error) });
  } finally {
    currentOutput = null;
  }
}

rl.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.type === "host_result") {
    const pending = pendingHost.get(message.id);
    if (!pending) return;
    pendingHost.delete(message.id);
    // Keep the RPC layer transport-neutral. The call site owns exactly one
    // revival step so a LIVE_OBJECT_REF becomes one stable proxy rather than
    // being revived twice and accidentally collapsed into a plain object.
    if (message.ok) pending.resolve(message.value);
    else pending.reject(reviveHostError(message.error));
    return;
  }
  if (message.type === "init") {
    initialize(message.bindings);
    send({ type: "ready", id: message.id });
    return;
  }
  if (message.type === "execute") {
    await execute(message);
    return;
  }
  if (message.type === "close") {
    send({ type: "closed", id: message.id });
    process.exit(0);
  }
});
