# Benchmark substrate current state

Source-synchronized projection of `packages/benchmark` (`@exharness/benchmark`) and `benchmarks/substrate/`. This is development measurement tooling: it records what happened in benchmark attempts and never decides which harness is better, promotes anything or accepts a release. No comparative harness result exists yet.

## Package contract

`@exharness/benchmark` is private ESM (Node >= 20) and exports only its root (`./src/index.js`); deep imports of `src/**` fail the downstream contract check. Root exports:

- `createExperimentRegistration` / `assertExperimentRegistration` (`EXPERIMENT_REGISTRATION_V1`): seals the fixed factors (protocol, source, workload manifest digest, environment, producer profile, budget, artifact policy, evaluator, reset policy, unit ids) into a computed `registrationDigest`; a supplied digest is rejected.
- `createBenchmarkUnit` / `assertBenchmarkUnit` (`BENCHMARK_UNIT_V1`): task + bundle digest, environment, instruction digest, producer, repeat index, arm and budget hash, bound to one registration.
- `AttemptLedger` / `assertAttemptRecord`: append-only `STARTED`/`SETTLED` events with sealed `BENCHMARK_ATTEMPT_RECORD_V1` records. Attempt ids are unique per experiment; a retry names `retryOfAttemptId` and never overwrites the original; fixed factors are frozen after the first `STARTED`; `AttemptLedger.replay` re-verifies a persisted ledger.
- `normalizeOutcome`: `quality` (`ACCEPTED|REJECTED|NOT_EVALUATED`) comes only from the independent evaluator verdict (`PASS|FAIL|ERROR|NOT_RUN`); `termination`, `providerStatus` and `infrastructureStatus` sit beside it and never produce quality. A verifier error is `NOT_EVALUATED` + `VERIFIER_ERROR`; a verified artifact after budget exhaustion stays `ACCEPTED` with termination `BUDGET_EXHAUSTED`.
- `normalizeAccounting` (`ACCOUNTING_V1`): nullable token and cost fields with status `KNOWN|PARTIAL|UNKNOWN` from what the source reported; a value for an unreported field fails with `ZERO_FILL`.
- `createEvidenceManifest` / `assertEvidenceManifest` (`EVIDENCE_MANIFEST_V1`): role-tagged entries with ref, sha256 and size; `RAW_RESULT`, `USAGE_OBSERVATION`, `RESET_IDENTITY` and `NORMALIZATION` are required, and `SUBSTRATE_RECORD` holds substrate bookkeeping that is not the candidate.
- `auditAttempt` (`BENCHMARK_AUDIT_V1`): reopens every entry by digest, recomputes candidate, evaluator, outcome, accounting and reset identities, and rejects tampered, missing or mismatched evidence and reused resets.
- `assertSubstratePort`: the adapter port `{ identity, prepare, execute, collect }`.

The package does not depend on product runtime, Harbor, provider SDKs, the Blackboard controller or the retired baseline (`packages/benchmark/test/dependency-boundary.test.js`).

## Harbor substrate

`benchmarks/substrate/harbor/adapter.mjs` implements the port around Harbor 0.23.0 (commit `1e5c5c6db929a10a140d05e606882c671ae20729`); `harbor/identity.mjs` refuses a different version, commit or source-tree digest. Each attempt is one fresh `harbor trials start` child with a unique trial name; stdout, stderr and exit status are raw evidence. `prepare` refuses `RESET_REUSED` for an existing output root or trial name and `FIXED_FACTOR_DRIFT` for a changed bundle or instruction digest. Only task-declared artifacts are collected (a symlink or special file is `ARTIFACT_EXTRACTION`). A missing reward is an evaluator `ERROR`, never `FAIL`. Harbor exceptions map to `ENV_BUILD`, `ENV_RUNTIME`, `ADAPTER_SETUP`, `AGENT_TIMEOUT`, provider `RATE_LIMITED`/`PROVIDER_TIMEOUT`/`PROVIDER_5XX` or `VERIFIER_ERROR`; a missing or foreign `result.json` is `HARNESS_PROTOCOL`. Usage comes only from Harbor-reported fields. `harbor/harbor_agent.py` is a scripted, model-free producer with eleven modes that Harbor loads; the package never imports it.

## Calibration and external sanity

`node benchmarks/substrate/run.mjs --mode local-calibration` runs 16 cases (`calibration/manifest.json`) over four sealed fixtures on a digest-pinned `debian:bookworm-slim`; every case must match its expected outcome dimensions, then a fresh Node process audits every attempt with `PASS`. It passes 16/16 in about 72 s on the development box, with zero coding-model calls and no credential. It proves adapter and normalization behavior on synthetic fixtures, not benchmark difficulty, and the audit trusts the local filesystem.

`manifests/terminal-bench-2.1.json` seals Terminal-Bench 2.1 (`7131e437…`, 89 tasks). `preregistration.json` fixed the rule (oracle 5/5 `ACCEPTED`, then nop `REJECTED`, first two in ascending bundle-digest order) and excluded 18 tasks reserved by downstream plans before any control ran. The sealed selection is `terminal-bench/hf-model-inference` and `terminal-bench/sparql-university`, with image and instruction digests; their control evidence is committed under `manifests/terminal-bench-2.1/`. `--mode external-preflight` re-verifies digests, reservation, order, preregistration and selection, fresh-audits both control experiments and confirms zero model calls. These verifiers need container egress; a run broken by host networking must be discarded, never sealed. The controls show the substrate reproduces known-good and known-bad outcomes; they say nothing about any harness or model.

## Retired baseline, downstream and boundary checks

The former `scripts/delivery/baseline/` and `test/delivery/` trees are removed. `manifests/legacy-retirement.json` records the recovery commit, the consumer inventory and each capability's disposition (dropped; accounting and evidence reopening reimplemented generically; the Core arm moved to a downstream consumer; the fixture requalified). `--mode verify-legacy-retirement` checks recoverability, inventory completeness, equivalence tests, absence of the trees and of any reference or legacy study vocabulary, and that system state no longer presents the old path.

`--mode verify-downstream --consumer <id>` runs a consumer contract fixture (currently DIRECT_CODEACT/CORE_SYNC): root-only imports, both arms through `AttemptLedger` under identical fixed factors, no recomputed kernel seals or quality, and tampering caught by the audit. `--mode verify-product-boundary` rejects writes to `packages/core-harness/` or `packages/agentic-system/` and any winner, promotion, value, release or recommendation key in substrate outputs. `npm run test:benchmark` runs the package and substrate tests; it is not part of `npm test` because adapter tests need the pinned Harbor Python package.
