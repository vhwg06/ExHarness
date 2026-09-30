# Delivery capability discovery

Checked: 2026-09-30. Executed audit source baseline: `e9007f861fd95c678c0c4048bb3d82626855bda1`.
Routing refreshed against `5391d1a855bdf92f1d598982edefb7acc1144070`; BB-093/108 are DONE and BB-107 is back in Research.
User direction: discover useful capabilities with material delivery impact; defer optimization when the problem, target or measurement is unclear. This is Research, with three new DRAFT subjects and no implementation/readiness claim.

## Decision and useful milestone

Prioritize a feature that another developer can run, use and independently verify: prepare an existing repository, obtain a preview, exercise the user journey, check the prior API/data behavior, and hand over the exact candidate plus evidence. Capability enablement is the immediate hypothesis. Human effort and quality-adjusted value remain measurements owned by BB-074; source popularity and a successful demo cannot establish them.

The current local delivery command already edits through a supervised agent and performs independent command checks on a fresh checkout. Product QA already has exact acceptance identities and an injected criterion verifier. The missing pieces are reusable local environment and evaluator profiles. Caller-authored scripts can already do browser/API work; this discovery does not claim those generic seams are defective.

## Executed evidence and limits

Run `node docs/blackboard/evidence/BB-131/capability-audit.mjs`. The audit invokes the real `validateDeliverSlice` with synthetic preview, browser-journey and compatibility descriptors. None are retained in the normalized manifest. Pinned source inspection confirms the generic command runner and injected Product QA criterion seam. The [result](../evidence/BB-131/capability-audit.json) records source digests and existing owners.

This establishes an absent named profile at the local manifest boundary, not false acceptance or absence of arbitrary custom integrations. No browser, Docker, database, provider or productivity trial ran. The proposed capability prototypes below remain NOT_RUN and must discriminate whether packaging these profiles is useful enough to proceed.

## Primary research and what follows from it

Sources, pinned eligible repositories, licenses and limits are in [delivery-capability-sources.json](delivery-capability-sources.json).

| Primary source | Finding used | ExHarness implication / limit |
|---|---|---|
| Anthropic, [effective long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), 2025-11-26 | Environment preparation, explicit feature criteria and browser verification address incomplete application work across sessions. | Investigate a prepared preview and user journeys. This experience report supplies no ExHarness productivity result. |
| Anthropic, [application harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps), 2026-03-24 | A running-app evaluator finds missing interactions; useful scaffolding varies with model and task. | A build or attractive UI can miss feature behavior. Calibrate the actual evaluator; do not copy extra roles/sprints without evidence. |
| Anthropic, [agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), 2026-01-09 | Task outcome, grader and trajectory need separate treatment and concrete calibration. | Store criterion-specific observations and challenge the checker with seeded broken fixtures before using it. |
| [SWE-CI v4](https://arxiv.org/abs/2603.03823v4), 2026-04-01 | Evaluate retained functional behavior through successive repository changes. | Add a two-change/prior-client cohort to existing BB-071/074 discovery. Its benchmark is not a replacement for BB-065 or a proven local value result. |
| [Harness component study](https://arxiv.org/abs/2609.20804), 2026-09-17 | Matched planning/action/context effects depend on model proficiency and context budget. | Require a measured target and matched ablation before optimization. Do not generalize its context strategies into new defaults. |
| [METR productivity study](https://arxiv.org/abs/2507.09089), 2025-07-12 | Perceived acceleration can differ from observed task completion. | BB-074 must count prompting, clarification, review and repair effort. Early-2025 tools and familiar mature repositories limit transfer. |

These implications are research inferences from the sources and current ExHarness seams. They are not external claims that these specific ExHarness tasks will improve productivity.

## OSS reuse shortlist

All examples exceed the user's 1,000-star floor at lookup on 2026-09-30. Commit, exact stars/license and inspected README paths are in the ledger. README/source-surface inspection is discovery; relevant implementation/test inspection and a reproducible seam prototype remain required before adoption.

| Eligible repository | Lookup stars / license | Helpful reuse | Trade-off and decision |
|---|---|---|---|
| [Playwright](https://github.com/microsoft/playwright) | 96,918 / Apache-2.0 | Executable UI journeys and trace DOM/actions/network. | Compare deterministic Test runner with bounded exploratory observation. Binary support, flaky selectors, evaluator calibration and trace privacy need decisions. Candidate for BB-132. |
| [Dev Container CLI](https://github.com/devcontainers/cli) | 2,972 / MIT | Declared development environment and lifecycle commands. | Compare a minimal explicit-command profile. Lifecycle hooks execute code; Docker/platform support and owned cleanup are not automatically solved. Candidate for BB-131. |
| [Testcontainers Node](https://github.com/testcontainers/testcontainers-node) | 2,617 / MIT | Disposable service/data fixtures and readiness lifecycle. | Requires a supported container runtime and pinned images; reset/cleanup ownership must be tested. Candidate for BB-131/133. |
| [Schemathesis](https://github.com/schemathesis/schemathesis) | 3,643 / MIT | Schema-derived and stateful API probes with reproducers. | Python CLI adds installation cost; schemas cannot supply independent business semantics or prior compatibility. Compare small Node HTTP assertions first. Candidate for BB-133. |
| [MarkItDown](https://github.com/microsoft/markitdown) | 187,740 / MIT | Extract declared documents into inspectable input with provenance. | Conversion is lossy and runs with process access. Requirement authority, unresolved decisions and protected criteria stay explicit. Existing BB-070 discovery only. |
| [Spec Kit](https://github.com/github/spec-kit) | 139,541 / MIT | Specification/clarification practices and an assess-or-stop entry. | Borrow criteria/clarification patterns; do not import its workflow as a second Blackboard or treat generated prose as approval. Existing BB-070 discovery only. |

## New capability contracts

| Task / Feature | Useful output | Direct Worker dependencies | Prototype and exit |
|---|---|---|---|
| BB-131 / reproducible local preview | One declared candidate/config/service receipt, observed readiness, reset and owned cleanup. | BB-104, BB-130 | Three fixture repositories; correct previews succeed, wrong release/readiness timeout/foreign port/partial start fail with typed evidence and preserve foreign resources. Compare explicit commands with container reuse. |
| BB-132 / independent browser journeys | Protected create/list/update/validation criteria exercised against the preview, with criterion-bound behavior and trace evidence. | BB-054, BB-131, BB-127 | Correct request-tracker passes; inert submit, stale list, missing persistence, skipped assertions, evaluator drift and wrong preview never count as PASS. Browser setup failure stays distinct. |
| BB-133 / API and retained data | A prior client contract and seeded old records remain valid after a declared change/migration/restart. | BB-054, BB-131, BB-127 | Reject breaking required fields/responses and deleted old records even if the candidate weakens its schema; retain a minimal request/data reproducer. Split scope if the prototype cannot remain bounded. |

All are PLANNED RESEARCH_SA/RESEARCH with DRAFT plans, explicit research gaps, proposed file scope and future named negative tests. Those product/test files do not exist yet. Embedded subtasks are checklists. Allocation advances to BB-134. Neither external tools nor these profiles obtain acceptance authority; BB-054 and protected evaluator ownership remain binding.

## Additional high-impact discovery routed to existing owners

| Capability opportunity | Existing owner | Concrete next research evidence | Reason not to register another task |
|---|---|---|---|
| Goal/document/design seed to executable feature criteria | BB-070 | Compare goal-only, a declared Markdown spec and a converted document containing ambiguity. Pin extraction/source refs; require an owner decision where product semantics are absent. Measure manual clarification and omitted criteria. | Its accepted objective already owns partial seeds and clarification. MarkItDown/Spec Kit are candidate aids, not a parallel planner. |
| Real feature from repository to observed usable output | BB-069 | Use the new preview/journey profiles when delivered; retain seeded broken-product rejection and reset evidence. | It owns first live feasibility, while new tasks own reusable adapters. Its existing objective/plan are not rewritten here. |
| Requirement change without breaking accepted behavior | BB-071 | Use a two-change request-tracker sequence with old client/data assertions and an unrelated feature that stays current. | It owns selective invalidation/recovery; BB-133 supplies checks, not a new change controller. |
| Decision and blocker handoff to a fresh operator | BB-070, BB-072 | Replay a missing decision, failed setup and resumed run without original conversation; record who can resolve each blocker and human actions. | Existing clarification and operations owners cover this capability. The discovery can expose a later adapter gap without assuming a new UI is needed. |
| Fresh install and supported host/stack profile | BB-073 | Reproduce the declared environment and evaluator dependencies in a clean consumer; expose unsupported hosts/runtime as actionable unresolved outcomes. | Existing supported distribution owns installation/compatibility. No universal stack installer is introduced. |
| Useful reviewer handoff | BB-129 | Include preview/journey/API evidence refs in the exact review manifest when their schemas are delivered; time fresh reviewer reproduction and preserve failures. | Existing portable candidate handoff owns retention/export; no second bundle format. |
| Safe execution of imported repository/document instructions | BB-067 | Feed untrusted lifecycle hooks and embedded instruction text through the selected capability boundary; verify they cannot obtain credentials or production authority. | Existing sandbox/network/tool scope owns enforcement. Environment packaging is not confinement. |
| Value from complete delivery work | BB-074, BB-099 | Predeclare equivalent task/model/config and acceptance; include all failures, prompting, setup, clarification, review, repair and incomplete accounting. | Existing value owners prevent a new benchmark or selected-success score. |

These are owner-specific discovery follow-ups. They do not replace accepted plans, add speculative dependencies, reopen terminal artifacts or claim readiness. Material plan contradictions must return through the existing research/readiness process.

## Optimization eligibility

Before prioritizing an optimization, record all of: a current reproducible failure/waste case, exact task/model/tool/environment baseline, complete observed resource coverage or an explicit limit, a predeclared target, independent accepted-quality/retained-behavior constraints, and a matched or held-out comparison with a KEEP_BASELINE/INCONCLUSIVE exit. A plausible tactic or a synthetic repetition count alone is insufficient.

BB-126's three identical no-edit attempts identify a mechanism, but do not establish that early stopping improves quality-adjusted real delivery. Its policy stays a DRAFT research hypothesis and is deferred behind capability discovery until the target/controls are ratified. BB-075/086 and the existing BB-077..081 studies keep ownership; this update starts no optimization implementation and changes no default policy. Confirmed authority/correctness defects BB-123/124/125/130 remain repairs, with their existing gates.

## Delivery/research order and measurement

1. Research BB-131 and the supported fixture/profile decision first; BB-132/133 discovery can use labelled proposed preview/evaluator contracts while Worker still waits for direct dependencies DONE.
2. Calibrate browser/API checks against independent positive and seeded negative fixtures. Require every mandatory criterion and explicit setup/coverage outcomes; do not turn missing observations into zero failures.
3. Compose the feature-to-preview-to-behavior-to-review milestone through existing BB-104/127/129 and first-slice/lifecycle owners. Use optional bounded live runs only after the evaluator and profile are ratified.
4. Measure accepted quality, setup interventions, clarification/review/repair effort, repeatability and observed cost separately under BB-074/099. Proceed, narrow the profile or stop based on the declared gates.

Priority is a roadmap view, not an execution scheduler. The canonical graph still owns two lanes, direct dependencies and one-task claims. No active runtime claim, provider spending, product source edit or Jev verdict is created by this discovery registration.
