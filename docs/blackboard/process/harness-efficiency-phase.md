# Async-first Core harness efficiency phase

Status: SCHEDULED RESEARCH; benchmark premise reset 2026-09-27; no async-first profile is delivered by this document.
Living-system impact: CURRENT_SYSTEM_NOT_CHANGED — this phase schedules research and future work only.
Benchmark research contract: `docs/blackboard/process/harness-benchmark-program-research.md`.
Primary implementation reference remains Unreal Agent; external benchmark results are motivation, not ExHarness acceptance evidence.

## Why this phase exists

ExHarness Core already has correctness primitives that an async harness must not weaken: deterministic EffectOperation identity, replay/reconciliation, ActionIntent/effect linking, bounded context and runtime/model usage reporting. The candidate improvement is scheduling/context efficiency: detached operations, cache-stable result context, steering/wakeup and recovery.

The previous phase assumed a narrow matched sync-vs-async benchmark was sufficient to establish harness value. That premise is revoked. Current research treats the harness as a first-class experimental variable and requires a neutral, fixed-factor benchmark contract before implementation or profile promotion.

## Benchmark-program reset

BB-077 and BB-081 are returned to `RESEARCH_SA / RESEARCH`. Their previous READY judgments remain historical and do not authorize Worker execution.

The phase now uses four distinct questions:

```text
BB-065  substrate calibration
   ↓
BB-077  harness isolation / economics
   ↓
BB-078..080  candidate implementation, only after BB-077 is ready/delivered
   ↓
BB-081  held-out component ablation + robustness acceptance
   ↓
BB-074  end-to-end delivery harness value
```

The fixed comparison contract must hold model snapshot, task input, prompt, initial workspace, resource ceilings, artifact extraction and evaluator constant while the harness/profile changes. Native harness behavior remains observable; provider or infrastructure failures stay separate from independent quality verdicts.

## Evidence snapshot

- **Harness-Bench** (arXiv:2605.27922) evaluates harness configurations under shared task environments, budgets and evaluation protocols and records artifacts, traces, usage and validator results.
- **Claw-SWE-Bench** (arXiv:2606.12344) fixes prompt, runtime budget, workspace contract, patch extraction and evaluator while comparing harnesses, demonstrating why adapter/harness design must be isolated from model choice.
- **The Scaffold Effect in Coding Agents** (arXiv:2607.22585) reports large harness-driven differences in token efficiency and repeatable failure patterns even when pass-rate differences are much smaller.
- **Harbor** (`harbor-framework/harbor`) is the preferred neutral substrate candidate for research because it can run arbitrary agents in isolated environments and collect trial artifacts, trajectories, timing, verifier output and token/cost usage. Adoption is not decided by this document.
- Existing ExHarness Core remains the preferred implementation substrate. Do not replace effect authority or product authority with a benchmark framework.

## Boundary

```text
Application / Worker semantics
        |
        v
AgentRuntime strategy
        |
        +--> synchronous capability profile (control)
        |
        +--> async candidate
                 |
                 +--> BB-078 detached operation scheduling
                 +--> BB-079 cache-stable result context
                 +--> BB-080 steering / wakeup / recovery
```

The scheduler never owns effect truth. EffectOperation confirmation/reconciliation remains authoritative for external effects. Context/cache state is optimization evidence only.

## Work

| Work | Current lane/result | Exit evidence |
|---|---|---|
| BB-077 | **RESEARCH** harness-isolation protocol | neutral substrate/adapter decision; fixed-factor comparison; preregistered metric/failure contract; fresh Jev readiness |
| BB-078 | Worker candidate, blocked by BB-077 | detached RUNNING→terminal scheduling without duplicate non-idempotent effects |
| BB-079 | Worker candidate, blocked by BB-077/078 | cache-stable result context with observable reuse/fallback |
| BB-080 | Worker candidate, blocked by BB-078/079 | steering/wakeup/recovery without lost results or turn storms |
| BB-081 | **RESEARCH** held-out ablation/acceptance protocol | fixed-factor A/B/C/D ablation, repeated/fault runs, Pareto/non-inferiority gate, fresh Jev readiness |

Research may run ahead, but Worker execution respects direct dependencies.

## Ablation contract to research

BB-081 must be able to attribute each capability rather than compare one bundled async profile only:

```text
A = current synchronous Core
B = A + BB-078 detached operations
C = B + BB-079 cache-stable result context
D = C + BB-080 steering / wakeup / recovery
```

All arms use the same model/task/prompt/workspace/budget/evaluator contract. Repeated runs and injected timeout/provider ambiguity, tool failure, kill/restart, cancellation and duplicate wakeup/effect scenarios are part of the acceptance research.

## Metrics that matter

Record every attempt, including failures/retries:

- independently accepted quality;
- tokens and total cost per accepted task;
- model turns, tool calls and no-progress behavior;
- elapsed time and useful operation overlap;
- cache reuse evidence where the provider exposes it;
- repeated-run consistency;
- fault robustness and recovery success;
- duplicate-effect count;
- failure fingerprint by harness/profile.

Do not reduce these to one opaque score. A candidate is not accepted because it is asynchronous. Promotion requires preregistered quality non-inferiority plus acceptable cost/latency/recovery trade-offs.

## Integration point

BB-066 still depends on BB-081. This intentionally prevents the real coding-agent runtime from freezing a supported Core profile before the harness measurement and acceptance contracts stabilize.

BB-078/079/080 are not benchmark tasks, so this reset does not automatically move them back to research. They remain Worker candidates and are blocked by the newly reopened BB-077 dependency.

## Oracle continuation

Oracle BB-060..064 remains a separate Context Intelligence research phase. Future Oracle efficiency work must reuse the benchmark program's fixed-factor and ablation discipline so Oracle contribution can be separated from async-runtime contribution. Do not infer Oracle value from the combined target architecture alone.
