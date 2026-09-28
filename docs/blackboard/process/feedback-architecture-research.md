# BB-083 — Feedback lifecycle and cross-episode learning research

Status: NEW RESEARCH / DRAFT. No implementation readiness or delivery claim.

User direction (2026-09-28): preserve tasks whose research is complete; introduce new research work. PR #321 was closed unmerged and is not an accepted contract.

## Goal

Evidence -> Observation -> relevant Context -> Finding + Impact -> authorized Disposition -> Response -> fresh Outcome -> FeedbackResolution.

Reuse established boundaries instead of reopening BB-058, BB-059 or BB-075. The new task owns all additional research and any later additive implementation plan.

## Research work

1. Separate exact observed facts from context-grounded interpretation. Pin subject/attempt/candidate, evidence refs, uncertainty and measured versus hypothesized impact. Missing context remains explicit; use Oracle for IO/provenance, not judgment.
2. Define application-owned CURRENT_WORK / EXISTING_WORK / NEW_WORK / NON_ACTIONABLE routing separately from scope classification. Define ACTED / REJECTED / DEFERRED / SUPERSEDED response, rationale, owner and linked work/experiment. Distinguish response acknowledgement from outcome completion; deferred responses need revisit conditions and superseded responses need successor links.
3. Observe fresh IMPROVED / NO_CHANGE / REGRESSED / UNKNOWN outcomes. Work creation or completion is not usefulness evidence. Rejected feedback can close its response without claiming improvement.
4. Define INSTANCE / PATTERN / SYSTEM proposals. Require cohort/window, denominator, deduplicated independent episodes, comparable contexts and counterexamples. Repetition alone cannot establish system causality. Retain disconfirming evidence.
5. Include REINFORCE_PATTERN / KEEP proposals with quality constraints. Observer proposes; application authority routes; independent evaluator judges; existing promotion authority decides. Neither feedback nor memory grants authority.
6. Keep inner runtime feedback and outer development/Jev feedback separate with explicit provenance links. Jev is one evaluation boundary, not the feedback system.

## Dependencies and sequencing

Direct execution dependencies: BB-059 (HOW evolution and upstream Observer), BB-064 (Oracle acceptance), BB-075 (held-out improvement proof and upstream benchmark program). These dependencies point from new work to existing work; no reverse edge is added and no old task is blocked by BB-083. Research can run ahead against explicitly planned contracts; implementation cannot use non-DONE outputs as delivered truth. Transitive dependencies are not repeated in the graph.

Research stages: contract inventory -> episode/context -> response/resolution -> aggregation/reinforcement -> additive integration and independent evaluation. Stages are a checklist inside one claimed task, not independently schedulable hidden tasks. If decomposition becomes necessary, allocate new task IDs rather than expand existing accepted plans.

## Evidence and trade-offs

[Healthy Feedback](https://martinfowler.com/articles/healthy-peer-feedback.html), by Anuja Karnik and Sumeet Gayathri Moghe, supplies conceptual motivation; the typed runtime model is an ExHarness proposal.

User-provided shortlist to investigate: OpenHands observation/events; Reflexion trial/reflection; LangGraph durability; LangMem consolidation; DSPy/GEPA candidate evaluation. Current stars and end-to-end semantics are not verified here. Require >=1,000 stars and pin relevant source/tests/license before using a repository as evidence; state none if no eligible example exists. Compare reuse/adapters with the smallest native extension. Separate source claim, observed evidence and design conclusion. No assertion that no repository implements the complete model.

## Required output and gates

A concrete READY_IMPLEMENT_PLAN candidate with exact exports/schema, owning packages, immutable/current identities, application write authority, retry/replay/idempotency/fencing, migration compatibility, file-level source scope, direct dependencies and executable verification commands. Resolve all research gaps and obtain fresh independent Jev readiness; DRAFT is not executable.

Discriminating probes: same observation/different context; missing/stale context; duplicate retries cannot manufacture recurrence; counterevidence; response crash/recovery; deferred revisit; supersession; unknown/no-change/regressed outcomes; positive reinforcement; forged authority and self-promotion rejection. Freeze task/model/environment/budget and evaluator before held-out baseline/candidate comparisons. Do not treat subjective reflection as ground truth.

Measure evidence completeness, unresolved/deferred age, response-to-outcome coverage, false-pattern rate on labeled fixtures, quality/cost/latency and regression. Predeclare thresholds and account for feedback overhead. No generated-finding/work count can substitute for measured usefulness.
