# @exharness/agent-tools

Outer supervision of CLI coding agents (Codex, Kiro, agy, grok) under ExHarness Core. The current behavior is documented in `docs/living/system/agent-tools/state.md`.

- `npm run test:agent-tools`: deterministic tests with a fake CLI (`test/fixtures/fake-agent.mjs`) and temporary git repositories.
- Run observation: `exharness-agent run … --trace-dir <dir>` writes digest-chained, redacted `AGENT_TOOL_RUN_TRACE_V1` traces, and `exharness-agent report <dir>` prints a descriptive per-tool/arm report (`docs/living/system/agent-tools/observation.md`).
- `npm run smoke:agent-tools -- --tool <codex|kiro|agy|grok>`: opt-in live check against an installed, authenticated CLI. It is not part of `npm test` or `npm run verify`.

The adapters are not a sandbox: a live run executes the agent with your CLI permissions, with cwd at a temporary git worktree only. Sandbox, network and credential isolation is separate future work.
