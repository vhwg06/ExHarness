// Deterministic fake MCP client for tests. Speaks NDJSON JSON-RPC 2.0 over a
// stdin/stdout stream pair with no runtime dependencies and no live CLI.
export class FakeMcpClient {
  constructor({ writable, readable }) {
    if (!writable || typeof writable.write !== "function") throw new TypeError("FakeMcpClient requires writable");
    if (!readable || typeof readable.on !== "function") throw new TypeError("FakeMcpClient requires readable");
    this.writable = writable;
    this.readable = readable;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    readable.setEncoding?.("utf8");
    readable.on("data", (chunk) => this.#onData(String(chunk)));
  }

  #onData(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf("\n");
      if (line.trim() === "") continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message && message.id !== undefined && message.id !== null && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          const error = new Error(message.error.message ?? "MCP error");
          error.code = message.error.code;
          error.data = message.error.data;
          reject(error);
        } else {
          resolve(message.result);
        }
      }
    }
  }

  request(method, params = undefined) {
    const id = this.nextId;
    this.nextId += 1;
    const message = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writable.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method, params = undefined) {
    const message = { jsonrpc: "2.0", method };
    if (params !== undefined) message.params = params;
    this.writable.write(`${JSON.stringify(message)}\n`);
  }

  sendRaw(line) {
    this.writable.write(`${line}\n`);
  }

  async initialize(params = { protocolVersion: "2025-03-26" }) {
    return this.request("initialize", params);
  }

  async listTools() {
    return this.request("tools/list", {});
  }

  async callTool(name, args = {}) {
    return this.request("tools/call", { name, arguments: args });
  }
}

export function createFakeMcpClient({ writable, readable }) {
  return new FakeMcpClient({ writable, readable });
}
