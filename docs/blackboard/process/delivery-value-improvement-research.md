# Delivery value and improvement discovery

Checked: 2026-09-30. Source baseline: `29935fa23cb19af278a6fa8db68b9448bc6b1a0e`. Routing refreshed at `939a5893f418d2adbbf498744bb53b593c9a8642` (BB-104 is now DONE). Status: **RESEARCH DISCOVERY; BB-124..130 DRAFT, not READY or delivered**.
2026-10-01 delivery evaluation (see [research roadmap](research-roadmap.md)): BB-124/125/127/128/129/130 can enter implementation after research READY (and their listed dependencies). BB-126 stays a deferred optimization until baseline, target, and independent quality controls exist. BB-122 OpenCode is now DONE, so BB-128's worker dependencies are delivered.

User direction: improve what is weak, and research capabilities that can ship with a large effect on delivery value. The scope here is the delivered local agent-tool path. No previous objective, plan or Jev judgment is rewritten.

## Meaningful state

DELIVERED_TRUTH: real worktree/command-verifier execution, supervised CLI loop, normalized traces, durable handle, Backend adapter, declared Oracle context and MCP verify/status exist on main. At the probe baseline the local `deliver` implementation was source-present (PR #416), awaiting its delivery receipt. The refreshed graph now marks BB-104 DONE; probe bodies remain bound to their original source baseline.

PLANNED_CONTRACT: BB-120 verifier-independent agent-env restriction, BB-121 durable Board injection, BB-122 OpenCode adapter, BB-099 comparative value, and the existing OpenHands/SCM/sandbox/lifecycle release program. Worker edges remain binding. Research can use these contracts now, labelled as planned.

RESEARCH_DESIRED_STATE: exact recovery contract binding, truthful accounting, independent protected local acceptance, fewer wasted retries, operator tool parity and a portable reviewer handoff.

## Facts and practical consequences

Reproduce all local findings with `node docs/blackboard/evidence/BB-130/local-delivery-audit.mjs`. Each discovery.json pins the baseline and records zero provider calls. Synthetic fixtures use a deliberately broken sum implementation; no actual host secrets are read.

| Evidence | Observed fact | Consequence / limit |
|---|---|---|
| BB-130 | Verifier child inherits a planted parent-only variable | BB-120 covers a different runner; local checks need their own bounded env contract. |
| BB-124 | Truncated Codex stream is marked complete; null Grok cost becomes zero (owned by main BB-123) | Economic reports can appear more complete/cheaper than observed; fix before interpreting cost comparisons. |
| BB-125 | Same-id resume with a new prompt and always-pass verifier accepts a broken candidate | Task identity needs content/config binding, not only id/repository/base. |
| BB-126 | Three identical no-edit candidates cause three verifier executions | Potential retry waste; early stopping may harm delayed fixes, so compare policies first. |
| BB-127 | Removing a repository test assertion passes Backend and fresh QA while code is still wrong | Fresh checkout does not independently pin evaluator content. This is a local trusted-command boundary, not a sandbox exploit. |
| BB-128 | Grok is registered but `deliver` rejects it | Actual supported CLI cannot reach the operator path. OpenCode remains planned until BB-122 delivery. |
| BB-129 | Accepted SHA has no named retention ref or exported bundle | No portable exact candidate handoff. The SHA is readable immediately; GC data loss has not been tested. |

## Why these tasks, and what not to duplicate

| Existing owner | Reuse / boundary |
|---|---|
| BB-106..108 | Test wiring and Oracle failure/reservation defects already tasked; prioritize rather than reopen. |
| BB-123 | Owns observed-only Grok cost normalization and grounded-context exclusion. BB-124 consumes its cost contract and adds usage/aggregate coverage. |
| BB-120 | Agent CLI environment only. BB-130 covers local-command-verifier spawn, including QA; preserve package dependency direction. |
| BB-101 | Preserve its delivered recovery behavior/evidence; BB-125 fixes uncovered content/config drift in a new task. |
| BB-099 | Owns supervised/direct/DIRECT_RETRY value and external hidden acceptance calibration. New retry/accounting work consumes its protocol without changing the accepted experiment. |
| BB-104 / BB-121 | Local CLI composition / durable Board strategy. BB-127..129 are additive evaluator, capability and handoff contracts, not a second workflow. |
| BB-067 / BB-072 | Sandbox, time/token/cost ceilings, cancellation and broad operations are already planned; no duplicate generic security/ops task. |
| BB-068 / BB-073 | Generic SCM/CI and supported distribution remain unchanged; an offline review bundle is a bounded local bridge, not a PR publisher or release. |
| BB-083..086 / BB-075 | Semantic feedback, patterns and HOW promotion stay owned there. BB-126 is single-run retry/diagnostic efficiency only. |

## Research choices and trade-offs

1. **Environment:** constrain both execution paths with explicit allowlist/overlay semantics. Reuse BB-120 policy; reject importing agent-tools into agentic-system because it creates a dependency cycle. Compatibility variables and test overlays must be ratified, not inferred from secrets.
2. **Accounting:** fix missing/null/partial truth first. Incremental stream parsing could preserve more terminal usage but adds parser/lifecycle complexity; start conservatively and adopt it only after a discriminating bounded-output probe. Partial observations may be exposed separately, never mixed with complete totals.
3. **Recovery:** persist canonical task/config digest before dispatch; reject drift before side effects. Same-id matching is insufficient. Credential values stay out of hashes/manifests; credential rotation must not change authority.
4. **Retry:** compare unchanged fixed ceiling, repeated tree+failure fingerprints and one feedback escalation. A new commit SHA is not useful progress. Never reuse cached PASS without an independently frozen evaluator/environment contract. Keep a delayed-fix fixture to catch premature stopping.
5. **Acceptance:** compare protected-path rejection, base-pinned test projection and external operator-owned evaluator. Select the external evaluator plus protected manifest for the narrow trusted local profile; a generic grader framework would add integration cost without resolving authority. External files are not inaccessible to an unsandboxed process; digest validation prevents substitution, and confinement remains BB-067.
6. **Tool parity:** use registered delivered capability rather than another static whitelist. Unknown/missing/unsupported tools fail before dispatch. OpenCode is not fabricated as delivered.
7. **Handoff:** compare SHA-only, binary patch and incremental Git bundle. A patch aids review; a bundle preserves exact commit objects and declared prerequisites. Prefer both with an atomic manifest, published before scratch cleanup, using a temporary export repository so source branches remain untouched.

Primary source ledger: `docs/blackboard/evidence/BB-130/research-sources.json`. Anthropic engineering supports outcome-based evaluation and using observed redundant calls to target improvements, not a claim of ExHarness value. Node documents explicit child env/process control; Git documents portable bundle/prerequisite checks. The sole public repository example is openai/codex (127,383 stars at lookup; Apache-2.0; pinned source commit), meeting the user 1,000-star floor. No new framework adoption is needed for the initial candidate designs.

## Concrete task contracts and measurement

| Task | Output | Direct Worker dependencies | Value / evidence gate |
|---|---|---|---|
| 130 | Constrain local verifier child environment | BB-096, BB-120 | Zero inherited synthetic secrets across agent and verifier spawns; existing local Backend/QA regressions pass. |
| 124 | Preserve partial usage and per-field accounting coverage | BB-098, BB-105, BB-123 | Every incomplete trace has explicit coverage; complete per-tool comparison uses matched observed coverage or reports INCONCLUSIVE. |
| 125 | Bind supervised resume to the exact task and execution contract | BB-101 | All contract drift cases stop before spawn/verifier; unchanged crash-resume retains one semantic attempt and candidate identity. |
| 126 | Stop repeated no-progress retries with evidence-bound feedback | BB-125 | Invocation/verifier count and elapsed time on repeat fixtures; paired held-out accepted quality and cost in BB-099-compatible studies. |
| 127 | Add externally pinned acceptance for local delivery slices | BB-104, BB-130, BB-125 | Zero false ACCEPT for deterministic tamper fixtures; exact evaluator and candidate digests on every accepted result; fresh independent replay. |
| 128 | Expose delivered Grok and OpenCode adapters through operator delivery | BB-104, BB-122 | One manifest-to-Backend-to-QA fixture per supported adapter; optional live smoke separately labelled feasibility, not value. |
| 129 | Export a durable review bundle for the exact local candidate | BB-127 | Exact candidate tree reconstructed in a fresh clone with no source worktree/conversation; timed reviewer steps and replay coverage. |

Task ids are BB-124..130; each task has a distinct Feature/Bug, exact objective, DRAFT plan, explicit components, proposed file scope, named negative tests and one discovery artifact. Embedded subtasks are checklists, not scheduling units. This wave's original allocation advanced to BB-131. Operator CLI composition of already-delivered supervisor APIs is a later registered wave (BB-135..137); remaining command factor parity is BB-139..140; Application adapter composition is BB-142..143. See [operator-cli-composition.md](operator-cli-composition.md), [operator-cli-factor-parity.md](operator-cli-factor-parity.md) and [application-adapter-composition.md](application-adapter-composition.md). Current next allocation is BB-145.

## Delivery order

1. Close existing repair candidates BB-106/108/107 and environment BB-120; run research for BB-130/124/125 immediately in parallel with dependency execution (without creating new worker claims here).
2. Prioritize exact resume binding BB-125 and verifier env BB-130, then accounting BB-124. These protect useful existing runs and credible comparison evidence.
3. Ship local capability parity BB-128 after BB-122 delivery (BB-104 is DONE); this is the smallest operator-visible increment.
4. Research and implement protected acceptance BB-127, then review handoff BB-129. Exit is an exact externally checked candidate another developer can replay.
5. Evaluate retry policy BB-126 with non-regression controls; use the existing BB-099 benchmark before asserting cost or productivity gains. This is independent of the broad OpenHands/async program.

This order is a value priority, not additional dependency edges or a runtime role scheduler. Concurrent work touching supervisor/recovery/deliver-slice needs serialization or isolated rebasing. Research lane remains schedulable even while Worker dependencies are unfinished.

## Research exit and remaining uncertainty

The probes establish gaps, not completed improvements. Drafts still require their task-specific compatibility/threat/measurement decisions, source anchors and objective coverage, then fresh Jev SATISFIED. No readiness, provider performance, runtime cost saving or product release claim is made here. Live experiments are optional, explicitly bounded and separate from offline calibration; report quality, cost coverage, lead time, reviewer effort and repeated-run reliability rather than one opaque score. A live request-tracker pilot remains BB-069/074, not this discovery.

## Concurrent registration

Main reserved BB-123 for observed-only Grok cost and grounded-context exclusion. The verifier-environment task uses BB-130; BB-124 depends on BB-123 and covers partial usage and aggregate field coverage. Existing main tasks, objectives, plans and evidence are preserved. Historical discovery remains bound to its source baseline.
