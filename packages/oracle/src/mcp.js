function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function assertOracle(oracle) {
  invariant(oracle && typeof oracle.listResourceTemplates === "function", "MCP adapter requires oracle.listResourceTemplates()");
  invariant(oracle && typeof oracle.readResource === "function", "MCP adapter requires oracle.readResource(uri)");
}

function assertServer(server) {
  invariant(server && typeof server.registerResource === "function", "MCP adapter requires server.registerResource()");
}

export function registerOracleMcpResources({ oracle, server, ResourceTemplate }) {
  assertOracle(oracle);
  assertServer(server);
  invariant(typeof ResourceTemplate === "function", "MCP adapter requires ResourceTemplate constructor");

  for (const definition of oracle.listResourceTemplates()) {
    server.registerResource(
      definition.name,
      new ResourceTemplate(definition.uriTemplate, { list: undefined }),
      {
        description: definition.description,
        mimeType: definition.mimeType
      },
      async (uri) => {
        const result = await oracle.readResource(uri.href);
        return {
          contents: [
            {
              uri: result.uri,
              mimeType: result.mimeType,
              text: JSON.stringify(result.value)
            }
          ]
        };
      }
    );
  }

  return server;
}

async function loadMcpServerSdk() {
  try {
    return await import("@modelcontextprotocol/server");
  } catch (error) {
    throw new Error(
      "MCP support requires @modelcontextprotocol/server@^2 and its zod@^4 peer dependency",
      { cause: error }
    );
  }
}

export async function createOracleMcpServer({
  oracle,
  name = "exharness-oracle",
  version = "0.1.0"
} = {}) {
  assertOracle(oracle);
  const { McpServer, ResourceTemplate } = await loadMcpServerSdk();
  const server = new McpServer({ name, version });
  return registerOracleMcpResources({ oracle, server, ResourceTemplate });
}
