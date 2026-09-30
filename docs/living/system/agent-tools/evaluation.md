# Agent-tools value evaluation

`exharness-agent eval` (also `npm run eval:agent-tools -- …`) measures, per CLI coding agent, whether running the agent under ExHarness supervision produces more independently accepted results than running it directly. It uses an owned, calibrated fixture suite, a pre-registered protocol and hidden tests that the agent never sees. The implementation lives in `packages/agent-tools/src/experiment/`, and the suite is in `benchmarks/agent-tools/fixtures/`.

```text
exharness-agent eval --tool <id>[,<id>] --out <dir> [--command <path>] [--model M]
  [--tasks a,b] [--repeats N] [--max-invocations N] [--max-usd X]
  [--fake-scenario FIX_FIRST|FIX_AFTER_FEEDBACK|NEVER_FIX|CLAIM_SUCCESS_NO_EDIT] [--seed S]
```

The command writes `<out>/report.json` (`AGENT_TOOLS_VALUE_REPORT_V1`), `<out>/report.md` and one directory per evaluated tool. Each tool directory holds `registration.json`, `ledger-events.json` and `attempts/<unit>/` with evidence, record and manifest. Exit code 0 means the report was written, whatever the verdicts. Usage errors exit 64.

## Suite

The suite has eight fixtures in four categories:
- bug-fix: `bug-sum`, `bug-clamp`;
- feature: `feat-prefix`, `feat-count`;
- test-guided-refactor: `refactor-extract`, `refactor-rename`;
- multi-file: `multifile-split`, `multifile-config`.

Each fixture has:
- `repo/**`: the agent-visible starting repository, committed as the base;
- `hidden/**`: independent hidden tests;
- `solution.patch`: a reference solution;
- `task.json`: `{ id, category, prompt, visibleVerifications, hiddenVerifications }`.

`benchmarks/agent-tools/build-fixtures.mjs` regenerates the tree deterministically.

**Calibration.** `calibrateSuite()` checks every fixture:
- the base fails both its visible and hidden verifications;
- base plus `solution.patch` passes both;
- no hidden file exists in the agent-visible repository.

A fixture whose base already passes its hidden tests fails calibration with `BASE_PASSES_HIDDEN`.

**Hidden tests.** They are stored outside the worktree and applied only at independent evaluation. The agent worktree is checked for hidden files before and after every direct invocation and after every supervised attempt, and a leak aborts the attempt (`HIDDEN_PRESENT`).

## Arms

All three arms use only delivered agent-tools entry points:

| Arm | What runs |
|---|---|
| `DIRECT_SINGLE` | one direct invocation (`runObservedInvocation`) |
| `DIRECT_RETRY` | up to K direct invocations on the same worktree, resuming the tool session with the fixed prompt "Continue until the task is complete." It never receives verification output. It stops early after two consecutive invocations that changed nothing. |
| `EXHARNESS_SUPERVISED` | `runSupervisedTask` with `maxAttempts` K over the visible verifications only, observed through `createSupervisedObservation` |

The fixed factors are the same for every arm of one tool:
- K = 3;
- timeoutMs = 600000 per invocation;
- permission profile `WORKSPACE_EDIT`;
- the explicit model, or the tool default.

A run whose arms differ in any fixed factor aborts with `FACTOR_MISMATCH` before anything is registered.

Producer exit status is telemetry and never quality.

## Pre-registration and records

Each tool gets one experiment registration (`agent-tools-value:<tool>`), made through the shared benchmark kernel (the `packages/benchmark` public entry `src/index.js`, imported by relative path so no install step is needed). The registration contains:
- a protocol hash over the arms, fixed factors, repeats, seed, decision rule and caps;
- the suite digest;
- a producer profile, including the expected tool version;
- a resource budget;
- the evaluator identity `hidden-command-verifier`;
- one benchmark unit per fixture × arm × repeat.

**Refusal before any attempt.** `registration.json` is written before the first attempt starts. The run refuses to start (`REGISTRATION_MISMATCH`, `REGISTRATION_EXISTS`, `TOOL_VERSION_MISMATCH`) when:
- an expected registration digest differs;
- an output directory already holds a registration;
- the live tool version differs from the registered one.

**Attempt lifecycle.** Every attempt runs through these steps:
1. It is `STARTED` in the kernel `AttemptLedger`.
2. It runs in a fresh git workspace.
3. It is evaluated independently on a detached checkout of the candidate with the hidden tests overlaid.
4. It is normalized (all hidden PASS → `ACCEPTED`; any FAIL → `REJECTED`; unavailable or error → `NOT_EVALUATED`).
5. It is `SETTLED` with an evidence manifest: raw result, usage observation, reset identity, normalization input and trajectory.

Afterwards, every settled attempt is re-audited from disk in a fresh Node process with the kernel `auditAttempt`.

**Usage.** Usage comes from the agent traces. A field is reported only when every invocation of the attempt reported it. Nothing is zero-filled or estimated. A grok-reported `total_cost_usd` becomes the provider cost.

## Reducer and verdicts

For each tool, attempts are paired by (task, repeat). For X in {`DIRECT_RETRY`, `DIRECT_SINGLE`}:

```text
delta = 1[ACCEPTED](EXHARNESS_SUPERVISED) − 1[ACCEPTED](X)
```

A seeded paired bootstrap (10,000 resamples, 95% percentile interval) gives:
- `SUPERIOR` if the lower bound is above 0;
- `INFERIOR` if the upper bound is below 0;
- `INCONCLUSIVE` otherwise. INCONCLUSIVE is a valid outcome.

**Per-arm metrics.** The report also gives, per arm:
- acceptance rate;
- false-success rate: a direct arm whose last invocation exited 0, or a supervised `ACCEPTED`, while the hidden evaluation rejected the candidate;
- median duration;
- invocations;
- token coverage and provider cost where observed.

Identical seed and inputs produce a byte-identical `report.json`.

## Calibration verdicts

The deterministic fake CLI (`--tool codex --command packages/agent-tools/test/fixtures/fake-agent.mjs --fake-scenario …`) calibrates the pipeline on `bug-sum` and `feat-prefix` with two repeats (12 attempts per scenario):

| Scenario | Expected outcome |
|---|---|
| `FIX_FIRST` | every arm accepts; `INCONCLUSIVE` (delta 0) |
| `FIX_AFTER_FEEDBACK` | only supervision (which feeds verification output back) accepts; `SUPERIOR` against both direct arms |
| `NEVER_FIX` | no arm accepts; `INCONCLUSIVE` with rates 0 |
| `CLAIM_SUCCESS_NO_EDIT` | direct arms show false-success rate 1, supervision shows 0 |

`--fake-scenario` is accepted only together with an explicit `--command`.

## NOT_EVALUATED

A tool or attempt that cannot be evaluated is reported as `NOT_EVALUATED` with a reason. It is never counted as a success or a failure. The reasons are:

| Reason | When |
|---|---|
| `ADAPTER_NOT_DELIVERED` | the tool id has no agent-tools adapter |
| `NOT_INSTALLED` | the executable (or `--command`) cannot be started |
| `TOOL_UNAVAILABLE` | the executable could not be started when an attempt ran |
| `MAX_INVOCATIONS` | the attempt's worst-case invocations no longer fit `--max-invocations`. The cap is pre-reserved, so no producer is started for such attempts. |
| `MAX_USD` | `--max-usd` was already spent |
| `USD_CAP_UNENFORCEABLE` | reported as the tool's `usdCap` when the tool does not report cost, so only the invocation cap bounds the run |

The evaluated tool's environment blanks `TYPESAFE_API_KEY`, `GITHUB_TOKEN`, `GH_TOKEN`, `NPM_TOKEN`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.

## Live grok pilot procedure

A bounded live pilot on a host with an authenticated Grok Build CLI is:

```text
exharness-agent eval --tool grok --command <path-to-grok> --model grok-4.6 \
  --tasks bug-sum,feat-prefix --repeats 1 --max-invocations 12 --max-usd 2 --out <dir>
```

Grok reports `total_cost_usd`, so the USD cap is enforced from observed cost. Such a pilot spends real provider money and has not been run: no live evaluation result exists yet. Codex, Kiro and agy results require those CLIs to be installed. Where they are not installed they are `NOT_INSTALLED`, never inferred.

## Claim boundary

Results hold only for:
- this owned eight-fixture suite;
- these arms and fixed factors;
- the reported tool versions on the evaluating host.

Two more limits apply:
- A tool without an adapter or executable is `NOT_EVALUATED`.
- Grok results do not stand in for Codex, Kiro or agy.

The report carries this boundary as `claimBoundary`.
