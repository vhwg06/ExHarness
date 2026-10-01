
## Plan defect and revision (r2 — supersedes the r1 rule)

Status: RESEARCH INPUT; no implementation authority. The r1 READY plan is
returned to DRAFT; no readiness is claimed.

Executed probe: `docs/blackboard/evidence/BB-120/plan-defect-probe.mjs` →
`plan-defect-probe-result.json` (all corrected-rule checks pass).

- **DELIVERED_TRUTH (defect).** The r1 rule (allowlist plus caller overlay
  only) is unimplementable as specified. The delivered bin
  (`packages/agent-tools/bin/exharness-agent.mjs` `commandRun`/`commandSmoke`)
  calls `runSupervisedTask` with no `env` while the supervisor defaults
  `env = {}`; the delivered AT4/GR3 tests hand `FAKE_AGENT_SCENARIO`
  explicitly to the bin process, and the fake CLI reads it from ambient
  `process.env`. A worker implementation of the r1 plan therefore failed 3
  delivered tests outside its write scope (AT4 run, AT4 smoke, GR3 smoke:
  fake fell back to default `FIX_FIRST` / `ACCEPTED` instead of the
  scenario), and ambient provider auth had no explicit path to the child, so
  a live run could never authenticate. The r1 plan offered no in-scope fix:
  the bin, supervisor and pinned tests were all outside its write scope.
- **Defect numbers.** With the supervisor default (`env = {}`), the r1 D2
  function drops `FAKE_AGENT_SCENARIO` and `FAKE_AGENT_RECORD` (2/2 test
  control vars) and every representative operator auth name (6/6:
  `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AGY_API_KEY`, `XAI_API_KEY`, `ANTHROPIC_API_KEY`), breaking 3 delivered
  tests and live auth for all 5 tools (codex, kiro, agy, grok, opencode).
  Live on current main the overlay channel works and ambient secrets leak,
  confirming both halves of the problem.
- **RESEARCH_DESIRED_STATE (corrected rule).** Child env = allowlisted
  inheritance (D1 list, unchanged) + per-tool declared `authEnvNames`
  passthrough (adapter-frozen, layered under the overlay, never
  `NODE_TEST_CONTEXT`) + explicit caller overlay, which always wins and is
  forwarded end-to-end: the bin forwards `FAKE_AGENT_*` test-control vars
  plus repeated `--env KEY=VALUE` operator flags into the supervisor
  overlay. The ambient secret environment is never forwarded wholesale.
  Proven in the probe by pure simulation: declared auth and bin-forwarded
  `FAKE_AGENT_*` reach the child, undeclared ambient secrets and
  `NODE_TEST_CONTEXT` do not, overlay beats inherited values.
- **PLANNED_CONTRACT (restraint).** No adapter or doc in this repo names
  per-tool auth variables, so the revised plan declares empty `authEnvNames`
  for the delivered adapters and forbids inventing vendor names; operators
  pass auth explicitly via overlay or `--env`. Delivered AT4/GR3 tests stay
  unmodified (bin and fixtures join the write scope instead).
