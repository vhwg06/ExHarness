# ExHarness harness benchmark program research

Status: RESEARCH RESET
Evidence checked: 2026-09-27.
Canonical scheduling remains `docs/blackboard/work-graph.json`.

## Why this reset exists

The previous benchmark work mixed three different questions:

1. whether the benchmark substrate itself is trustworthy,
2. whether a harness changes coding-agent quality/efficiency,
3. whether ExHarness creates end-to-end software-delivery value.

A single DIRECT-vs-ExHarness study cannot reliably answer all three or attribute a gain to a particular harness capability. From this reset onward the harness is a first-class experimental variable.

The comparison unit is:

```text
Model snapshot
  x Harness
  x Environment
  x Task
  x Resource budget
```

To estimate a harness effect, hold model/task/prompt/start workspace/resource ceilings/artifact extraction/evaluator fixed and change the harness. Preserve the native execution behavior of each harness rather than rewriting every harness into a common loop.

## Research evidence

Primary benchmark-method evidence:

- Harness-Bench, arXiv:2605.27922 — shared task environments, budgets and evaluation protocols across harness/model configurations; 106 sandboxed tasks; captures artifacts, execution traces, usage and validator output. This is evidence for treating harness configuration as a first-class evaluation variable.
- Claw-SWE-Bench, arXiv:2606.12344 — fixes prompt, runtime budget, workspace contract, patch extraction and evaluator while comparing harnesses; reports harness effects separately from model effects and includes cost accounting.
- The Scaffold Effect in Coding Agents, arXiv:2607.22585 — fixed-model harness comparisons show large efficiency/failure-pattern differences can coexist with much smaller pass-rate differences. This motivates tokens/cost/latency/failure fingerprints in addition to quality.
- Harbor (`harbor-framework/harbor`) — Apache-2.0, 5,625 GitHub stars at evidence check. It can run arbitrary agents in isolated environments, collect trial artifacts/trajectories, timing, verifier output and token/cost usage. Treat it as the preferred neutral substrate candidate, not an adoption decision.
- mini-SWE-agent (`SWE-agent/mini-swe-agent`) — MIT, 7,994 stars at evidence check. Keep as an eligible minimal-agent/direct-control reference.
- OpenHands software-agent-sdk (`OpenHands/software-agent-sdk`) — MIT, 1,173 stars at evidence check. Keep as an eligible alternative harness/runtime reference.

Public GitHub implementation examples below 1,000 stars are not used as canonical examples. Papers may still be cited as research evidence independent of repository-star eligibility.

## Benchmark architecture

The program has four layers. They share run identity/accounting but answer different questions.

### Layer A — substrate calibration (BB-065)

Purpose: prove that task/environment/evaluator/accounting are trustworthy before comparing harnesses.

Required controls:

- pinned task and starting workspace;
- oracle/pass control and no-op/fail control where the benchmark format supports them;
- independent evaluator/validator;
- fresh reset between attempts;
- exact candidate/artifact extraction;
- trace plus token/tool/cost/time accounting;
- explicit provider/infra/termination status separate from quality;
- repeated calibration sufficient to detect flaky environment/provider behavior.

BB-065 MUST NOT claim ExHarness product value.

### Layer B — harness isolation and economics (BB-077)

Purpose: measure the harness as the experimental variable.

Minimum comparison:

```text
fixed model/task/prompt/workspace/budget/evaluator

minimal/direct harness
current ExHarness synchronous Core
future ExHarness candidate profile
```

Use an external/public workload where practical for external validity. Prefer Harbor as the neutral substrate if research confirms its adapter/evidence contract is sufficient.

Report a vector, not one score:

- accepted quality / Pass@1 where applicable;
- cost and tokens per accepted task;
- model turns and tool calls;
- no-progress behavior;
- latency / elapsed time;
- repeat consistency;
- failure fingerprint.

### Layer C — component ablation and robustness (BB-081)

Purpose: attribute effects of Core-harness changes.

Predeclare an ablation matrix over:

```text
A = current synchronous Core
B = A + detached operation scheduling (BB-078)
C = B + cache-stable result context (BB-079)
D = C + steering / wakeup / recovery (BB-080)
```

Keep the same fixed comparison contract. Add repeated runs and injected failure scenarios such as timeout/provider ambiguity, tool failure, kill/restart, cancellation and duplicate wakeup/effect paths.

Promotion is a Pareto/non-inferiority decision across quality, cost/latency and recovery/safety evidence. Async is never accepted because it is async.

### Layer D — delivery harness value (BB-074)

Purpose: measure what public coding benchmarks do not capture: ExHarness's end-to-end delivery lifecycle.

Keep a controlled minimal/direct comparison where meaningful, but also run ExHarness-specific delivery scenarios:

- verifier rejection followed by bounded repair;
- stale context/currentness rejection;
- process crash and resume;
- session/device handoff;
- provider 429/timeout/unknown usage;
- CI failure and repair routing;
- blocked dependency/currentness fencing;
- research finding invalidates an implementation premise;
- duplicate claim/takeover and stale-worker fencing.

Primary result profile:

```text
quality
economics
lead time
human active effort
consistency
fault robustness
recovery success
failure fingerprint
```

Do not collapse these dimensions into an opaque "ExHarness score".

## Downstream research impact

- BB-075 consumes BB-074/081 failure fingerprints or ablation evidence. A HOW candidate must be selected from observed evidence, then tested on held-out tasks under the same benchmark contract.
- BB-076 release acceptance must reproduce both supported product behavior and the benchmark profile on the exact release. A green CI, successful agent exit or one aggregate score is insufficient.
- BB-066 remains worker-blocked by BB-065 and BB-081. This is intentional: the real coding-agent runtime must not freeze a harness profile before the measurement and acceptance contracts are stable.
- BB-078/079/080 remain implementation candidates. They are not benchmark tasks, so they are not automatically returned to research; BB-077 blocks their worker execution until the new measurement premise is ready.
- Future Oracle efficiency work must reuse this fixed-factor/ablation discipline so Oracle contribution can be separated from async-runtime contribution.

## Research gates before READY

A benchmark-related task cannot become READY until it has all of the following:

1. exact benchmark question and experimental unit;
2. fixed variables and allowed varying variable(s);
3. neutral substrate/adapter decision with pinned source/release;
4. task/dataset selection and leakage/reset policy;
5. independent evaluator and artifact extraction contract;
6. complete attempt accounting and provider/infra failure semantics;
7. repeat/sample policy and uncertainty reporting;
8. predeclared metric vector and decision gate;
9. fault-injection plan when robustness/recovery is part of the claim;
10. executable verification commands and a fresh Jev readiness binding.

Historical READY judgments based on the previous benchmark premise remain history and do not authorize Worker execution after this reset.
