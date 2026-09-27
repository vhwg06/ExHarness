# ExHarness harness benchmark program research

Status: RESEARCH CONVERGED CANDIDATE — 2026-09-27.
Evidence checked: 2026-09-27.
Canonical scheduling remains `docs/blackboard/work-graph.json`.

## Research conclusion

The benchmark program must answer four different questions in order and must not collapse them into one DIRECT-vs-ExHarness score:

```text
Layer A — BB-065  neutral substrate calibration
        ↓
Layer B — BB-077  harness isolation / economics
        ↓
BB-078 / BB-079 / BB-080  bounded harness capability candidates
        ↓
Layer C — BB-081  component ablation + robustness + profile promotion
        ↓
Layer D — BB-074  end-to-end delivery value
        ↓
BB-075  one evidence-selected HOW improvement
        ↓
BB-076  clean-room release reproduction / release no-go
```

The comparison unit for any causal harness study is:

```text
Model snapshot
  x Harness
  x Environment
  x Task
  x Resource budget
```

To estimate a harness effect, hold model/task/prompt/start workspace/tool envelope/resource ceilings/artifact extraction/evaluator fixed and vary the harness. Native harness execution behavior is observed rather than normalized away.

## Research evidence

Primary benchmark-method evidence:

- Harness-Bench, arXiv:2605.27922 — shared task environments, budgets and evaluation protocols across harness/model configurations; records artifacts, execution traces, usage and validator output. This supports treating harness configuration as a first-class experimental variable.
- Claw-SWE-Bench, arXiv:2606.12344 — fixes prompt, runtime budget, workspace contract, patch extraction and evaluator while comparing heterogeneous harnesses. It reports harness effects separately from model effects and includes cost accounting.
- The Scaffold Effect in Coding Agents, arXiv:2607.22585 — fixed-model harness comparisons show large efficiency/failure-pattern differences can coexist with smaller pass-rate differences. This motivates tokens/cost/latency/failure fingerprints in addition to quality.
- Harbor `v0.23.0`, annotated tag resolving to commit `1e5c5c6db929a10a140d05e606882c671ae20729` — selected neutral outer benchmark substrate. Harbor owns task sandbox lifecycle, trial identity, verifier invocation and raw trial artifacts; ExHarness keeps its native orchestration semantics.
- Terminal-Bench 2.1 source snapshot `7131e4375048a0e408a8fb404b5f499d726b695b` — selected external workload snapshot.
- mini-SWE-agent and OpenHands software-agent-sdk remain eligible reference implementations under the project >=1,000-star rule; neither is adopted as ExHarness runtime by this research.
- SLSA provenance v1.2 is used only as release-provenance design guidance in BB-076: bind source, resolved dependencies, builder/invocation identity and produced artifact digests. No SLSA level claim is implied.

Public GitHub implementation examples below 1,000 stars are not canonical reusable examples. Papers and official provider/specification documentation may still be cited as research evidence independent of repository-star eligibility.

## Shared benchmark invariants

Every downstream benchmark task consumes these invariants.

### Fixed-factor manifest

Every registered benchmark unit binds:

```text
protocol id + version
evaluated source SHA/tree
task id + immutable task digest
environment image/runtime identity
model + provider route identity
prompt/instruction digest
tool/capability profile digest
harness/profile identity
resource-budget identity
artifact-extraction policy
independent evaluator/verifier identity
reset policy
repeat index
registered arm
```

Any drift after registration invalidates the unit. It is never silently repaired in-place.

### Attempt accounting

Every started attempt remains in append-only accounting. Retries are new attempts related to the original unit. No best-of-k selection is allowed unless a future benchmark explicitly declares it before execution.

Unknown token/cost/timing data remains null/unknown. It is never imputed as zero.

### Orthogonal outcomes

Independent quality is separate from execution state:

```text
quality:
  ACCEPTED | REJECTED | NOT_EVALUATED

termination:
  COMPLETED | BUDGET_EXHAUSTED | AGENT_TIMEOUT | AGENT_ERROR | CANCELLED

provider:
  NONE | RATE_LIMITED | PROVIDER_TIMEOUT | PROVIDER_5XX |
  ROUTE_MISMATCH | USAGE_UNKNOWN

infrastructure:
  NONE | ENV_BUILD | ENV_RUNTIME | ADAPTER_SETUP |
  HARNESS_PROTOCOL | ARTIFACT_EXTRACTION | VERIFIER_ERROR
```

A candidate may be independently ACCEPTED even if the producer later exhausts a budget. Conversely, a provider or infrastructure failure without a valid independent evaluation is not a quality rejection.

### Calibration and leakage rules

- Oracle/pass and nop/fail controls happen before live model comparisons.
- Task/environment flakiness discovered by oracle/nop preflight starts a new preregistered cohort; tasks are not removed after model outcomes are observed.
- Fresh task environment, runtime state and provider session are required for each registered arm unit unless a benchmark explicitly studies recovery.
- Development, held-out evaluation and release-reserve cohorts are disjoint by task digest.
- Reserved cohort task names/digests may be committed to prove reservation, but model results from that cohort must not be opened by upstream tuning work.

## Layer A — BB-065 neutral substrate calibration

BB-065 proves the substrate before any ExHarness comparison.

It selects Harbor v0.23.0 as the neutral outer runner and produces a benchmark-owned substrate library plus a provider-independent normalized attempt record. BB-065 does not implement ExHarness harness arms and does not claim Core or product value.

Worker implementation after objective supersession is restricted to benchmark infrastructure:

```text
benchmarks/substrate/**
benchmarks/substrate/test/**
```

Required calibration:

1. local deterministic pass/fail fixtures validate reset, verifier, candidate/artifact extraction and raw evidence reopening;
2. Harbor oracle passes repeatedly and nop fails on the frozen calibration tasks;
3. normalization tests independently exercise ACCEPTED+budget-stop, provider failure+NOT_EVALUATED, UNKNOWN usage, artifact extraction failure and verifier failure;
4. an audit command reopens on-disk Harbor evidence and recomputes the normalized record rather than trusting an in-memory summary.

BB-065 emits `BENCHMARK_ATTEMPT_RECORD_V1`. BB-077 may extend that record with harness-specific model/turn/cache timing fields; it must not redefine the orthogonal outcome semantics.

BB-065's current canonical OBJECTIVE still describes the retired mini-SWE DIRECT-vs-Core value study. Publication of the replacement objective is therefore intentionally fenced by BB-082. Research convergence does not bypass that control.

## Layer B — BB-077 harness isolation / economics

BB-077 asks only:

> Under fixed model/task/prompt/workspace/tools/budgets/evaluator, what changes when the orchestration harness changes?

The control remains:

```text
DIRECT_CODEACT
vs
CORE_SYNC
```

Harbor is the same outer runner for both. One benchmark adapter surface forwards the same task instruction and installs the same benchmark runtime. The JavaScript CodeAct strategy, reference executor, model route and capabilities are held fixed; only the minimal direct runtime vs current Core runtime differs.

External development cohort and held-out reservation remain those frozen in the current BB-077 plan. Three paired repeats per development task remain the primary live protocol. BB-077 reports the full metric vector and never emits a single winner score.

## BB-078 / BB-079 / BB-080 capability candidates

These tasks remain implementation candidates, not benchmark decisions:

- BB-078: durable detached operation scheduling and recovery.
- BB-079: immutable async-result/context projection and cache-stable context contract.
- BB-080: steering, wakeup/coalescing, cancellation fencing and restart recovery.

Their worker plans remain bounded and do not claim economic value. Each re-resolves delivered dependencies at worker start and stops with `PLAN_INPUT_CONTRADICTION` on incompatible seams.

## Layer C — BB-081 component ablation + robustness

A/B/C/D remains:

```text
A = CORE_SYNC
B = A + BB-078
C = B + BB-079
D = C + BB-080
```

B/C are diagnostic only; D is the sole promotion candidate.

The current four-task held-out reservation, two repeats, 32 registered arm units, deterministic fault matrix and frozen promotion reducer remain valid. Fault-injection evidence is kept separate from live-provider economics.

BB-081 must produce exactly one of:

```text
PROMOTE_ASYNC
KEEP_SYNC_BASELINE
INCONCLUSIVE
```

The decision comes from the frozen deterministic reducer. Jev validates semantic/evidence claims but cannot rewrite the reducer result.

## Layer D — BB-074 end-to-end delivery value

BB-074 asks a different question:

> Does the supported ExHarness delivery system create measurable software-delivery value relative to the same direct coding-agent control?

The current BB-074 plan remains valid:

- six separate Terminal-Bench 2.1 external tasks;
- two repeats, D=direct vs E=supported ExHarness;
- 24 registered external arm units;
- explicit human-event ledger;
- separate delivery-lifecycle scenarios;
- outcomes `VALUE_DEMONSTRATED | NO_VALUE_DEMONSTRATED | INCONCLUSIVE`.

The primary gates remain multidimensional: quality, human active effort, provider economics and lifecycle. No scalar "ExHarness score" is introduced.

## BB-075 evidence-selected HOW improvement

BB-075 research is now executable without guessing an optimization in advance.

Worker input must include immutable DONE BB-074 evidence and DONE BB-059 HOW-evolution authority. A deterministic selection reducer chooses at most one eligible observed bottleneck from BB-074 evidence.

Eligible improvement scope is intentionally narrow:

```text
STRATEGY_POLICY
CONTEXT_POLICY
TOOL_POLICY
NONE
```

A fingerprint is eligible only if it can be changed through a delivered bounded HOW/configuration seam without changing WHAT, acceptance, evaluator, task, benchmark budget or product authority. If the observed problem requires new runtime/product architecture, BB-075 returns KEEP_BASELINE and records a follow-up research requirement instead of expanding Worker source scope.

Before candidate construction, BB-075 deterministically partitions the remaining pinned Terminal-Bench 2.1 pool after excluding every task digest used/reserved by BB-077, BB-081 and BB-074:

1. preflight candidates with oracle 5/5 and nop failure;
2. sort eligible task bundles by immutable digest;
3. seal the first six as `IMPROVEMENT_HOLDOUT`;
4. seal the next four as `RELEASE_RESERVE`.

BB-075 may execute the six improvement-held-out tasks. It MUST NOT execute model arms on the four release-reserve tasks.

The candidate is compared to the exact baseline on the six held-out tasks with two repeats per task/arm. Promotion requires fixed acceptance, no new critical defect, no recovery/currentness regression, and the preregistered metric for the selected fingerprint to meet its minimum effect. Otherwise the result is KEEP_BASELINE or INCONCLUSIVE.

## BB-076 release reproduction

BB-076 consumes the exact BB-074 result and BB-075 promotion/keep-baseline result. It does not tune.

It freezes a release candidate and emits a release provenance manifest inspired by SLSA provenance fields:

```text
source commit/tree
resolved dependency/lock digest
supported profile identity
build command/type
builder/runtime identity
build invocation id
artifact/package digests
benchmark protocol/profile hashes
delivered dependency evidence refs
known limitations
```

No SLSA certification or level is claimed.

A clean-room reproducer installs only the frozen BB-073-supported artifact/profile and proves artifact/source identity before evaluation.

Then BB-076 is the first task allowed to open `RELEASE_RESERVE`. It runs the same direct-vs-release fixed-factor contract on those four tasks, two repeats per arm, for 16 registered arm units. It also reruns the required product lifecycle acceptance on the exact packaged release.

BB-076 returns exactly one of:

```text
RELEASE_ACCEPTED
RELEASE_NO_GO
INCONCLUSIVE
```

A failed value, lifecycle, identity or clean-install gate is RELEASE_NO_GO when evidence is complete. Missing/unknown evidence is INCONCLUSIVE. The goal is never silently downgraded to "merged + CI green".

## Worker handoff order

Research readiness and worker schedulability are different.

```text
BB-082 DONE
  -> publish BB-065 objective supersession
  -> fresh BB-065 Jev readiness
  -> BB-065 Worker

BB-065 DONE
  -> BB-077 Worker
  -> BB-078 Worker
  -> BB-079 Worker
  -> BB-080 Worker
  -> BB-081 Worker

separate delivery dependencies DONE
  -> BB-074 Worker
  -> BB-075 Worker
  -> BB-076 Worker
```

Research may finish downstream plans before upstream delivery. Worker execution always re-resolves exact DONE direct dependencies and fails closed on incompatible delivered contracts.

## Research readiness matrix

As of this research pass:

```text
BB-065  research design converged; canonical objective/plan promotion BLOCKED by BB-082
BB-077  READY plan retained
BB-078  READY plan retained
BB-079  READY plan retained
BB-080  READY plan retained
BB-081  READY plan retained
BB-074  READY plan retained
BB-075  converged implementation-plan candidate; fresh Jev still required
BB-076  converged implementation-plan candidate; fresh Jev still required
```

No task is moved to Worker by this research change.

## Research gate for any future benchmark task

A benchmark-related task cannot become READY until it has:

1. exact benchmark question and experimental unit;
2. fixed variables and allowed varying variables;
3. neutral substrate/adapter decision with pinned source/release;
4. task/dataset selection plus leakage/reset policy;
5. independent evaluator and artifact extraction contract;
6. complete attempt accounting and provider/infra failure semantics;
7. repeat/sample policy and uncertainty reporting;
8. predeclared metric vector and deterministic decision gate;
9. fault-injection plan when robustness/recovery is part of the claim;
10. executable verification commands and a fresh Jev readiness binding.

Historical READY judgments based on a superseded semantic premise remain history and do not authorize Worker execution.
