# Agent tools MCP verification queries

The stdio MCP server in `packages/agent-tools/src/mcp-server.js` is a transport for
verification queries, not acceptance authority. Outer supervision owns candidate
identity, verification, retry and promotion; the MCP tools only let a supervised
agent ask what the current worktree would verify as.

## Tools

- `exharness_verify`: reads the worktree `HEAD` and runs each declared command
  verifier at that revision. It returns `{ ok, results: [{ name, status, reason }] }`
  where `reason` comes from the verifier evidence `:reason=` line. It never
  promotes, accepts or mutates lineage.
- `exharness_status`: returns `{ attemptIndex, candidateSha, lastVerification }`
  for the current supervised attempt. There is no promote, accept, merge or
  credential tool, and a planted promote tool name is rejected at construction.

## Opt-in wiring

`runSupervisedTask` accepts `mcpVerify` (default `false`) after
`invocationObserver`:

- `false` (also `null` or `undefined`): the server is never constructed and the
  run never listens.
- `true`: the server starts on an internal supervisor-owned stdio pair bound to
  that worktree only.
- `{ stdin, stdout }`: the server starts on the provided streams.

When on, the server is created for `workspace.root` with a live status object
`{ attemptIndex: 0, candidateSha: <baseRevision>, lastVerification: null }`,
updated through `statusSink` after ACT and after verifiers, and `stop()` runs in
a `finally` block before the worktree is disposed. The server never writes user
CLI configuration (no `.codex`, `.kiro` or `.gemini` entries) and never changes
adapter argv. `invocationObserver` keeps its default (`null`) and payload.

## Protocol

NDJSON JSON-RPC 2.0 over stdio with `protocolVersion: "2025-03-26"`:

- `initialize` returns the protocol version, `capabilities: { tools: {} }` and
  the `exharness-verify` server info.
- `tools/list` returns `exharness_verify` then `exharness_status`, each with an
  empty-object input schema.
- `tools/call` returns `{ content: [{ type: "text", text }], isError: false }`
  with a JSON payload. Unknown methods and tools return `-32601`; parse errors
  return `-32700`; invalid requests return `-32600`.

## Dependencies

No runtime MCP SDK was added: the server uses node built-ins plus the existing
`runProcess` and command-verifier seams. Tests speak the protocol through
`test/fixtures/fake-mcp-client.mjs` on a stdin/stdout pair, so no live coding
CLI is required.
