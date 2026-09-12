import { spawn } from "node:child_process";
import readline from "node:readline";

function errorView(error) {
  return {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  };
}

function errorFrom(raw) {
  const error = new Error(raw?.message ?? "worker failure");
  error.name = raw?.name ?? "Error";
  error.code = raw?.code ?? null;
  return error;
}

export function createReferenceJavaScriptExecutor(workerPath, {
  abortedCode = "EXECUTION_ABORTED",
  terminalFeature = "CELL_ABORT"
} = {}) {
  const metrics = {
    opens: 0,
    closes: 0,
    cells: 0,
    hostCalls: 0,
    forcedKills: 0,
    executionErrors: 0
  };

  return {
    metrics,
    async open({ host, bindings }) {
      metrics.opens += 1;
      const child = spawn(process.execPath, [workerPath], {
        stdio: ["pipe", "pipe", "pipe"]
      });
      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      const pending = new Map();
      let nextId = 1;
      let stderr = "";
      let intentionalClose = false;

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });

      function send(message) {
        if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`);
      }

      function request(type, payload = {}) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject, type });
          send({ type, id, ...payload });
        });
      }

      function abortError(message) {
        const error = new Error(message);
        error.code = abortedCode;
        return error;
      }

      lines.on("line", (line) => {
        const message = JSON.parse(line);
        if (message.type === "host") {
          metrics.hostCalls += 1;
          Promise.resolve()
            .then(() => host.request(message.request))
            .then(
              (value) => send({ type: "host_result", id: message.id, ok: true, value }),
              (error) => send({
                type: "host_result",
                id: message.id,
                ok: false,
                error: errorView(error)
              })
            );
          return;
        }

        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.type === "execution_error") {
          metrics.executionErrors += 1;
          waiter.reject(errorFrom(message.error));
        } else if (message.type === "execute_result") {
          waiter.resolve(message.result);
        } else {
          waiter.resolve(message);
        }
      });

      child.on("exit", (code, signal) => {
        if (intentionalClose) return;
        const error = abortError(
          `javascript reference worker exited unexpectedly: ${String(code)}/${String(signal)}${stderr ? ` ${stderr}` : ""}`
        );
        for (const waiter of pending.values()) waiter.reject(error);
        pending.clear();
      });

      await request("init", { bindings });

      return {
        features: [terminalFeature],
        async execute(cell, { signal } = {}) {
          metrics.cells += 1;
          const operation = request("execute", { code: cell.code });
          if (!signal) return operation;

          if (signal.aborted && signal.reason !== "return_result") {
            metrics.forcedKills += 1;
            child.kill("SIGKILL");
            throw abortError("javascript reference worker aborted before execution");
          }

          return new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => {
              if (signal.reason === "return_result") return;
              if (settled) return;
              settled = true;
              metrics.forcedKills += 1;
              child.kill("SIGKILL");
              reject(abortError("javascript reference worker aborted"));
            };
            signal.addEventListener("abort", onAbort, { once: true });
            operation.then(
              (value) => {
                if (settled) return;
                settled = true;
                signal.removeEventListener("abort", onAbort);
                resolve(value);
              },
              (error) => {
                if (settled) return;
                settled = true;
                signal.removeEventListener("abort", onAbort);
                reject(error);
              }
            );
          });
        },
        async close() {
          metrics.closes += 1;
          if (child.exitCode != null || child.signalCode != null) {
            intentionalClose = true;
            lines.close();
            return;
          }
          intentionalClose = true;
          try {
            await Promise.race([
              request("close"),
              new Promise((resolve) => setTimeout(resolve, 100))
            ]);
          } finally {
            child.kill();
            lines.close();
          }
        }
      };
    }
  };
}
