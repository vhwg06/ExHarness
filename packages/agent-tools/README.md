# @exharness/agent-tools

Outer supervision of CLI coding agents (Codex, Kiro, agy) under ExHarness Core. The current behavior is documented in `docs/living/system/agent-tools/state.md`.

- `npm run test:agent-tools`: deterministic tests with a fake CLI (`test/fixtures/fake-agent.mjs`) and temporary git repositories.
- `npm run smoke:agent-tools -- --tool <codex|kiro|agy>`: opt-in live check against an installed, authenticated CLI. It is not part of `npm test` or `npm run verify`.

The adapters are not a sandbox: a live run executes the agent with your CLI permissions, with cwd at a temporary git worktree only. Sandbox, network and credential isolation is Blackboard work item BB-067.
