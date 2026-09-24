# Async-first Core harness efficiency phase

Status: SCHEDULED RESEARCH; no async-first profile is delivered by this document.
Evidence checked: 2026-09-24.
ExHarness baseline: aa91ba16548f31772d441f51975917397cbf73d7.
Primary external reference: Unreal Agent v0.2.0, commit `1b9f778453f411c029b39b85102aaefb95e7e48d`.

## Why this phase exists

ExHarness Core already has the expensive correctness primitives that an async harness must not weaken: deterministic effect operation identity, `INTENDED -> DISPATCHED -> CONFIRMED | UNKNOWN`, replay-policy reconciliation, ActionIntent/effect linking, bounded context and runtime/model usage reporting.

The missing mechanism is scheduling efficiency. `AgentRuntime.invoke()` currently awaits `capability.execute(...)`, so a long-running capability blocks strategy progress. Unreal Agent demonstrates a concrete alternative: persist a running tool result immediately, execute serializable operations independently, wake the model on useful input/completion, and keep a stable committed prompt prefix where possible.

This phase does **not** assume Unreal Agent's published savings transfer to ExHarness. Those numbers are vendor evidence. Promotion requires matched ExHarness measurements with fixed model, task semantics, tools and acceptance.

## Evidence snapshot

- **Unreal Agent** — MIT, Go, 1,850 GitHub stars at evidence check; v0.2.0. Relevant source seams: coordinator event loop, serializable operation manager, append-only session store, and context builder committed-prefix/staged-suffix handling.
- **HarnessTax / AgentBRANE** — independent research evidence that model-harness choice can materially alter cost even when task success is close. It is evidence for measuring the harness as a first-class variable, not an implementation dependency.
- **OpenHands software-agent-sdk** — MIT, 1,165 stars at evidence check; retained as a real coding-agent adapter comparison.
- Existing ExHarness Core remains the smallest preferred implementation substrate. A new workflow engine is not justified by this phase.

## Boundary

```text
Application / Worker semantics
        |
        v
AgentRuntime strategy
        |
        +--> synchronous capability profile (current baseline)
        |
        +--> async operation scheduler (candidate HOW)
                 |
                 +--> exact EffectOperation identity / replay policy
                 +--> operation update events
                 +--> cache-stable context projection
                 +--> steering / cancel / recovery
```

The scheduler does not own effect truth. EffectOperation confirmation/reconciliation remains authoritative for external side effects. Context/cache state is optimization evidence only.

## Work

| Work | Research/product result | Exit evidence |
|---|---|---|
| BB-077 | Measure current harness tax and pin matched protocol | Reproducible same-model/task baseline + predeclared gate |
| BB-078 | Durable detached operation scheduling | RUNNING -> terminal without blocking unrelated work or duplicating effects |
| BB-079 | Cache-stable async result context | Stable committed prefix / explicit provider fallback |
| BB-080 | Steering, wakeup, coalescing and recovery | No lost wakeups/results; bounded turns; safe cancel/restart |
| BB-081 | Profile acceptance | PROMOTE_ASYNC or KEEP_SYNC_BASELINE from held-out matched evidence |

## Metrics that matter

Record all attempts, including failures/retries: accepted quality, provider input/output/cached tokens when available, total estimated cost, model turns, tool calls, useful operations per model turn, operation overlap, elapsed time, steering latency, cache reuse evidence, duplicate-effect count and recovery result.

A candidate is not accepted because it is asynchronous. BB-077 must predeclare the non-inferiority bound and improvement threshold before candidate results. BB-081 may promote only if fixed-quality and safety/recovery gates pass; otherwise the current synchronous profile remains supported.

## Integration point

The phase is inserted before BB-066 real coding-agent runtime integration. This prevents ExHarness from locking the delivery product onto an unmeasured synchronous harness shape, while preserving research-ahead semantics: all BB-077–081 research can proceed before worker dependencies are delivered.
