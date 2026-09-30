# Benchmark substrate current state

Source-synchronized projection of `packages/benchmark` (`@exharness/benchmark`) and `benchmarks/substrate/`. This is development measurement tooling: it records what happened in benchmark attempts and never decides which harness is better, whether anything is promoted, or whether a release is accepted. No comparative harness result exists yet.

## Package contract

`@exharness/benchmark` is private, ESM, Node >= 20, and exports only its root (`./src/index.js`). Consumers import the root; deep imports of `src/**` are rejected by the downstream contract check. The root exports:

- `createExperimentRegistration` / `assertExperimentRegistration`: `EXPERIMENT_REGISTRATION_V1`. It seals the fixed factors (protocol id/version/hash, source identity, workload manifest ref+digest, environment identity, producer profile, resource budget, artifact policy, evaluator identity, reset policy, unit ids) into `registrationDigest`. A supplied digest is rejected; it is always computed.
- `createBenchmarkUnit` / `assertBenchmarkUnit`: `BENCHMARK_UNIT_V1`, which binds task id + bundle digest, environment identity, instruction digest, producer profile, repeat index, arm and budget hash to one registration.
- `AttemptLedger` / `assertAttemptRecord`: an append-only ledger of `STARTED` and `SETTLED` events (`ATTEMPT_LEDGER_EVENT_V1`) with sealed `BENCHMARK_ATTEMPT_RECORD_V1` records. Attempt ids are unique per experiment. A retry names `retryOfAttemptId` and never overwrites or removes the original. Fixed factors cannot change after the first `STARTED` event. `AttemptLedger.replay` rebuilds and re-verifies a persisted ledger.
- `normalizeOutcome`: orthogonal dimensions. `quality` (`ACCEPTED|REJECTED|NOT_EVALUATED`) comes only from the independent evaluator verdict (`PASS|FAIL|ERROR|NOT_RUN`). `termination`, `providerStatus` and `infrastructureStatus` sit beside it and never produce quality. A verifier error is `NOT_EVALUATED` + `VERIFIER_ERROR`. A provider failure without an evaluable artifact is `NOT_EVALUATED`. A verified artifact after budget exhaustion stays `ACCEPTED` with termination `BUDGET_EXHAUSTED`.
- `normalizeAccounting`: `ACCOUNTING_V1` with nullable `inputTokens`, `outputTokens`, `cachedTokens`, `cacheWriteTokens`, `providerCostUsd` and `normalizedCostUsd`. The status is `KNOWN`, `PARTIAL` or `UNKNOWN`, derived from the fields the source reported. An unreported field that carries a value fails with `ZERO_FILL`.
- `createEvidenceManifest` / `assertEvidenceManifest`: `EVIDENCE_MANIFEST_V1` over role-tagged entries (`RAW_RESULT`, `STDOUT`, `STDERR`, `TRAJECTORY`, `ARTIFACT`, `ARTIFACT_MANIFEST`, `VERIFIER_OUTPUT`, `USAGE_OBSERVATION`, `RESET_IDENTITY`, `NORMALIZATION`, `SUBSTRATE_RECORD`), each with ref, sha256 digest and byte size. `RAW_RESULT`, `USAGE_OBSERVATION`, `RESET_IDENTITY` and `NORMALIZATION` are required. `SUBSTRATE_RECORD` holds substrate bookkeeping that is not the candidate (for example Harbor's own artifact download manifest, or files from a failed extraction).
- `auditAttempt`: `BENCHMARK_AUDIT_V1`. It reopens every manifest entry by digest and recomputes the candidate, evaluator, outcome, accounting and reset identities from the stored normalization input and usage observation. It rejects tampered, missing or mismatched evidence and reused reset identities.
- `assertSubstratePort`: the adapter port `{ identity, prepare, execute, collect }`.

The package has no dependency on product runtime (`packages/core-harness`, `packages/agentic-system`), Harbor, provider SDKs, the Blackboard controller or the retired delivery baseline. `packages/benchmark/test/dependency-boundary.test.js` enforces this.

## Harbor substrate

`benchmarks/substrate/harbor/adapter.mjs` implements the port around Harbor 0.23.0 (commit `1e5c5c6db929a10a140d05e606882c671ae20729`). `harbor/identity.mjs` refuses to run when the installed Harbor differs from that pin by version, commit or source-tree digest.

- **Invocation.** Each attempt runs one `harbor trials start -p <task> -a <agent> --trials-dir <attempt>/trials --trial-name <x-sha256(experiment,unit,attempt)>` child process. stdout, stderr and exit status are raw evidence.
- **Fresh reset.** `prepare` refuses with `RESET_REUSED` if the attempt output root or trial name already exists, including across adapter instances. It refuses with `FIXED_FACTOR_DRIFT` if the task bundle digest (Harbor's own packager) or instruction digest differs from the registered unit. `reset.json` records the trial id, Harbor trial UUID, output ref, `environment.delete` and the pre-existing entries (always empty).
- **Artifacts.** Only task-declared artifact paths are collected. A symlink or special file is `ARTIFACT_EXTRACTION`, never a verifier judgement.
- **Verifier.** Verifier output is read only when the candidate is evaluable. A missing reward is an evaluator `ERROR`, never `FAIL`.
- **Failure mapping.**

  | Harbor exception | Normalized as |
  | --- | --- |
  | environment start timeout or sandbox build failure | `ENV_BUILD` |
  | healthcheck or out-of-memory failure | `ENV_RUNTIME` |
  | agent setup failure or timeout | `ADAPTER_SETUP` |
  | `AgentTimeoutError` | termination `AGENT_TIMEOUT` |
  | rate or usage limit | provider `RATE_LIMITED` |
  | stalled response or closed connection | provider `PROVIDER_TIMEOUT` |
  | internal server error or overload | provider `PROVIDER_5XX` |
  | reward file, parse, timeout or tests-dir failure | `VERIFIER_ERROR` |

  A missing, malformed or foreign `result.json` is `HARNESS_PROTOCOL`.
- **Usage.** Usage comes only from fields Harbor's agent context reported (`n_input_tokens`, `n_output_tokens`, `n_cache_tokens`, `cost_usd`).

`harbor/harbor_agent.py` (`CalibrationProducerAgent`) is a scripted, model-free producer with eleven modes: correct, wrong artifact, budget stop, usage known, provider timeout/rate-limit/5xx, verifier crash, broken artifact, agent timeout and bootstrap failure. Harbor loads it; the package never imports it.

## Local calibration

`node benchmarks/substrate/run.mjs --mode local-calibration` runs the 16-case matrix in `calibration/manifest.json` over four sealed fixtures in `fixtures/` (pass, artifact, reject, failure), using `debian:bookworm-slim` pinned by digest. Cases run concurrently (default 6, `BENCHMARK_CALIBRATION_CONCURRENCY`), and a retry case starts only after its original settles. Every case must match its expected quality, termination, provider, infrastructure, extraction, usage and producer status. A fresh Node process must then audit every materialized attempt with `PASS`. On this repository's development box the matrix passes 16/16 in about 72 s with Docker. The run makes zero coding-model calls and needs no credential.

Limitations:

- Calibration proves adapter and normalization behavior on synthetic fixtures, not benchmark difficulty.
- Harbor's reported usage for the scripted producer is itself scripted.
- The fresh-process audit trusts the local filesystem and does not sign evidence.

## External sanity

`benchmarks/substrate/manifests/terminal-bench-2.1.json` is a sealed `BENCHMARK_SUBSTRATE_MANIFEST_V1` for Terminal-Bench 2.1 (`harbor-framework/terminal-bench-2-1` at `7131e4375048a0e408a8fb404b5f499d726b695b`, 89 tasks, dataset manifest bound by digest). It was produced once by `--mode external-preflight --execute`; the default mode only re-verifies it.

- **Preregistration before any control.** `preregistration.json` binds the Harbor identity, the pinned source, the rule (oracle 5/5 `ACCEPTED`, then nop 1/1 `REJECTED`, select the first two) and the candidate order, and its digest is the protocol hash of every control experiment. Tasks named in, or referenced by digest from, the canonical downstream plans at the reservation commit are reserved and never become sanity tasks (18 tasks from three plans at main `86c2b737`). The remaining 71 tasks are ordered by ascending pinned bundle digest.
- **Controls.** Candidates run strictly in that order with Harbor's `oracle` and `nop` agents only, each attempt through `AttemptLedger` and the Harbor adapter. A task stops at its first non-`ACCEPTED` oracle, and nothing runs after two tasks qualify. The sealed selection is `terminal-bench/hf-model-inference` and `terminal-bench/sparql-university` (the first two in digest order), each oracle 5/5 `ACCEPTED` and nop `REJECTED`. Their environments are pinned by image digest, `alexgshaw/hf-model-inference:20260430@sha256:0ef475ae…` and `alexgshaw/sparql-university:20251031@sha256:92fa4304…`, together with their instruction digests. The control evidence (records, manifests, raw Harbor results, verifier output, reset identities) is committed under `manifests/terminal-bench-2.1/`; Harbor's trial working directories are not.
- **Verification.** It recomputes the pinned bundle digests, the reservation, the candidate order, the preregistration digest and the selection from the committed tallies. It fresh-audits both control experiments and rejects any selection that does not follow the rule, which includes one changed after outcomes were seen. It also confirms zero coding-model calls and that no downstream model result was read.
- **Environment.** These task verifiers install their test tooling at run time, so container egress must work. On a Docker host with a stale `FORWARD DROP` policy for new bridge networks, every oracle fails at `apt-get`/`uv` before it can pass. Such a run must be discarded and executed again, never sealed.

Limitations:

- The two tasks prove that the substrate reproduces known-good and known-bad outcomes on real benchmark tasks. They say nothing about any harness or model.
- Oracle runs download upstream images and packages, so a later re-execution depends on those remaining available at the pinned digests.

## Retired delivery baseline

The former `scripts/delivery/baseline/` and `test/delivery/` trees (request-tracker fixture, direct mini-SWE-agent arm, provider-budget accounting, six-pair Core comparison study and their tests) are retired and removed. `manifests/legacy-retirement.json` records the baseline commit they remain recoverable from, the full consumer inventory and each capability's disposition:

- **Dropped:** the study runner, value judgement, report reducer and mini driver.
- **Reimplemented generically:** accounting in `accounting.js`; evidence reopening in `evidence.js` + `audit.js`.
- **Moved to a downstream comparison consumer:** the Core arm.
- **Requalified:** the fixture as substrate fixtures.

`--mode verify-legacy-retirement` checks the following, and does not rewrite historical Blackboard evidence:

- the baseline is recoverable;
- the inventory is complete;
- the equivalence tests exist;
- the trees are absent;
- no root script, import or executable reference to them remains;
- no legacy study vocabulary remains in benchmark code;
- the system state no longer presents the old path as current.

## Downstream and boundary checks

- `--mode verify-downstream --consumer <id>` runs a consumer contract fixture, currently the DIRECT_CODEACT/CORE_SYNC comparison consumer. It checks that the consumer:
  - imports only the package root;
  - drives both arms through `AttemptLedger` under identical fixed factors;
  - does not recompute kernel seals, usage status or quality;
  - gets tampering caught by the kernel audit.

  The consumer owns its adapters, fixed-factor protocol, economics metrics, schedule and comparison reducer.
- `--mode verify-product-boundary` checks the change set against the declared write scope. It rejects writes to `packages/core-harness/` or `packages/agentic-system/`, and rejects any harness-winner, promotion, delivery-value, release or recommendation key in the substrate manifests and calibration outputs.
- `npm run test:benchmark` runs `packages/benchmark/test/*.test.js` and `benchmarks/substrate/test/*` under `node --test`. It is not wired into `npm test`: the adapter tests compute task bundle digests with the pinned Harbor Python package, which the default test environment does not install. `benchmarks/substrate/test/test_harbor_agent.py` runs under pytest in the Harbor environment.
