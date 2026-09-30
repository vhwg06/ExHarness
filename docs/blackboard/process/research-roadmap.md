# ExHarness research roadmap: delivery value and current truth

Checked: 2026-09-30. Probe baseline: `29935fa23cb19af278a6fa8db68b9448bc6b1a0e`; routing snapshot refreshed at `5391d1a855bdf92f1d598982edefb7acc1144070`. Scheduling authority is `docs/blackboard/work-graph.json`; this is a value-priority view, not a second work graph.

DELIVERED_TRUTH is grounded in current source/Living and terminal receipts. SOURCE_PRESENT means implementation exists on main while its graph receipt is pending. PLANNED_CONTRACT means an existing plan; RESEARCH_DESIRED_STATE is an unaccepted improvement. Do not collapse these labels.

## Current areas

| Area | Current truth | Remaining gap / existing owner | Canonical task snapshot |
|---|---|---|---|
| Core / benchmark | Neutral benchmark package and sync Core are delivered. | BB-077 is now DONE with its offline receipt; no live comparative result is claimed. Async candidates and held-out ablation remain planned. | DONE: BB-065, BB-077; planned: BB-078, BB-079, BB-080, BB-081 |
| Oracle | Foundation, Context Graph, opt-in Backend/QA adoption, planner strategies and progressive resolution are delivered. | Budget profiles are delivered; Core conformance / held-out acceptance remain planned; reservation repair remains BB-107; typed boundary repair BB-108 is DONE. BB-093 is now DONE with its delivery receipt; BB-107 has returned to Research through objective supersession. | DONE: BB-060, BB-061, BB-062, BB-063, BB-064, BB-087, BB-088, BB-089, BB-091, BB-092, BB-093, BB-108; planned: BB-094, BB-095, BB-107 |
| Application | Cross-domain authority, activation and exact deployment QA are delivered. | Closure, recovery, observation and HOW remain planned. | DONE: BB-052, BB-053, BB-054; planned: BB-055, BB-057, BB-058, BB-059 |
| Agent tools | Real worktree verification, supervision, traces, Backend adapter, durable recovery, Oracle files, MCP and Grok are delivered. BB-104 local deliver is now DONE after its exact delivery receipt. | Verifier env, accounting and resume-binding probes expose additional gaps. Durable Board/OpenCode/agent-env remain planned. BB-099 experiment tooling is source-present; its delivery receipt and comparative value are separate. | DONE: BB-096, BB-097, BB-098, BB-100, BB-101, BB-102, BB-103, BB-104, BB-105; planned: BB-120, BB-121, BB-122 |
| Feedback | Existing correctness feedback and routing remain delivered primitives. | Observed / Feedback Lifecycle / Self-Improve additive plans are Worker-blocked; no research reopening. | DONE: none; planned: BB-083, BB-084, BB-085, BB-086 |
| Broader delivery | Real local execution exists; the planned OpenHands/sandbox/SCM path is distinct. | No installed supported product or controlled end-to-end value claim yet. | DONE: none; planned: BB-066, BB-067, BB-068, BB-069, BB-070, BB-071, BB-072, BB-073, BB-074, BB-075, BB-076 |
| Outer Blackboard | Two lanes, objective supersession and negative binding are delivered. | Use the current gates; standing test wiring repair is BB-106, no new generic control-plane expansion. | DONE: BB-056, BB-082, BB-090; planned: BB-106 |

## Capability discovery takes priority

The current [capability discovery](delivery-capability-discovery.md) surveys six eligible OSS projects and primary reports, executes a local manifest/source boundary audit, and routes additional discoveries to existing lifecycle/value owners. Optimization needs a current measured baseline, target and independent quality constraints first.

| Research task | Useful outcome | Direct Worker dependencies | Priority |
|---|---|---|---|
| BB-131 | Reproducible repository preview, service state, observed readiness and owned cleanup | BB-104, BB-130 | P1: make the candidate runnable |
| BB-132 | Independent browser journeys reject broken interactions with criterion/trace evidence | BB-054, BB-131, BB-127 | P1: verify the feature users exercise |
| BB-133 | Prior API consumers and persisted data remain valid after a declared change | BB-054, BB-131, BB-127 | P1: support useful existing-repository evolution |

All three are PLANNED Research with DRAFT plans. No browser/container/API prototype has run yet; the named integration gap is observed and its value is a hypothesis. Existing BB-070/071/073/074/099 own input clarification, lifecycle, installation and measured delivery value. Next allocation: BB-134.

## New research from executed delivery-path probes

[Discovery and trade-offs](delivery-value-improvement-research.md) contains exact source evidence, alternative designs, direct dependencies and proposed implementation seams. Reproduce with `node docs/blackboard/evidence/BB-130/local-delivery-audit.mjs`. Seven synthetic local probes made zero provider calls.

| Task | Classification | Concrete improvement | Direct dependencies | Priority / value |
|---|---|---|---|---|
| BB-130 | Confirmed defect | Constrain verifier child env; BB-120 covers agent child env only | BB-096, BB-120 | P0: close remaining implicit credential inheritance |
| BB-124 | Confirmed defect | Preserve partial usage and complete per-field accounting coverage | BB-098, BB-105, BB-123 | P0: credible economics, no false zero cost |
| BB-125 | Confirmed defect | Exact task/config binding before resumed side effects | BB-101 | P0: prevent changed task/gate under same id |
| BB-126 | Improvement hypothesis with observed waste | Opt-in no-progress stop + evidence-bound repair feedback | BB-125 | P2: fewer wasted invocations, delayed-fix non-regression |
| BB-127 | Confirmed local acceptance gap | Externally pinned local evaluator and protected manifest | BB-104, BB-130, BB-125 | P1: agent-edited test cannot substitute acceptance |
| BB-128 | Confirmed operator mismatch | Grok/OpenCode capability parity in deliver | BB-104, BB-122 | P1: small usable increment for available CLI |
| BB-129 | Confirmed handoff gap; GC loss untested | Portable exact candidate review/replay bundle | BB-127 | P1: another developer can inspect and use the result |

All seven are PLANNED RESEARCH_SA/RESEARCH with DRAFT plans, proposed future tests, task-specific researchGaps and no readiness/delivery verdict. Research can run ahead; Worker waits for the listed dependencies DONE. Existing task bodies/plans/judgments remain unchanged. One canonical objective/plan/discovery artifact per new task; allocation for that registration was BB-131; the capability discovery below advances it to BB-134.

## Delivery queue by useful outcome

1. **Protect the existing path:** finish BB-106 and BB-120; close the corrected BB-107 Research plan before its repair, then prioritize BB-125/130/123/124. These are real bounded defects, not new architecture programs.
2. **Make the local path usable:** BB-122 then BB-128; BB-121 composes supervised agents into durable Board. BB-104 is delivered in the refreshed graph.
3. **Return a change another developer can trust:** BB-127 protected local acceptance then BB-129 review/replay handoff. These do not wait on the OpenHands/async profile; their own direct edges still apply.
4. **Prove efficiency before expanding:** BB-099 per-tool fixed-factor comparison and BB-077 harness isolation. Defer BB-126 optimization priority until the exact baseline, target, quality controls and observed coverage are ratified; its current DRAFT stays a hypothesis.
5. **Continue the broader product:** BB-055/057..059, BB-066..076, BB-078..081, BB-093..095 and BB-083..086 keep their accepted sequence. Release and end-to-end value remain BB-074/076 obligations.

These priorities are not dependency edges. Serialize/rebase overlapping supervisor/recovery/deliver-slice writes without inventing semantic dependencies.

## Existing work to reuse, not duplicate

- BB-106 test wiring, BB-107 planner reservation and BB-108 typed facade boundaries already own the confirmed Oracle/regression debt.
- BB-120 explicit inherited agent env; BB-121 durable supervised Backend strategy; BB-122 OpenCode adapter.
- BB-067 sandbox, time/token/cost ceilings and cancellation; BB-068 SCM/CI; BB-072 operations; BB-073 installable support. New local tasks do not claim these capabilities.
- BB-099 owns supervised/direct/DIRECT_RETRY study; BB-074 owns end-to-end value, reviewer/human effort and lifecycle; BB-075/086 own evaluated HOW improvement and promotion.
- BB-083/084/085/086 preserve Observed Implementation -> Feedback Lifecycle -> Self-Improve separation. Single-run retry efficiency is not cross-episode learning.

## Evidence and research exit

The [source ledger](../evidence/BB-130/research-sources.json) pins primary docs and a 1,000-star-eligible Codex source example. External practices justify discriminating experiments, not an ExHarness productivity claim. Local probes establish reproducible gaps; live provider quality, saved cost and release behavior remain unmeasured.

Research must finish the exact API/compatibility/threat/measurement gaps, objective coverage/source anchors and named subject-invoking negative bindings before fresh Jev. DRAFT tests are proposed implementation outputs, not files claimed to exist now. Keep paid/model experiments optional and budgeted, preserve failed/inconclusive findings, and report accepted quality, observed accounting coverage, elapsed time, reviewer steps and repeated-run reliability separately.
