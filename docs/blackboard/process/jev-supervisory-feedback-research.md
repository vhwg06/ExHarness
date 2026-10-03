# BB-153 — JEV supervisory feedback loop research

Status: RESEARCH_SA design closure candidate. Checked: 2026-10-03.
Research baseline: `3bd32d8b4ec9d08a1535b5fa9245c5f6df5d0bae`.

## Problem confirmed on current main

The current Outer Blackboard has an independent semantic judge, but the Worker control loop consumes JEV as a gate rather than as supervision.

```text
candidate/evidence
  -> JEV
  -> REPAIR_REQUIRED
  -> WORKER/REPAIR
  -> IMPLEMENT + source write scope
  -> candidate/evidence
  -> JEV
```

There is no mandatory cognitive transition between the failed judgment and the next source mutation.

Delivered code evidence:

- `scripts/blackboard-delivery.mjs::publishEvaluation` maps any non-`SATISFIED` Worker verdict other than `RESEARCH_REQUIRED` directly to `task.phase = 'REPAIR'`.
- `scripts/blackboard-delivery-context.mjs::deriveDeliveryContext` defines both `EXECUTION` and `REPAIR` as execution, returns `action.kind='IMPLEMENT'`, and grants the plan's source write scope.
- `scripts/blackboard-implementation-bootstrap.mjs` collapses every contracted Worker phase to `IMPLEMENT_EXACT_READY_PLAN`.
- `scripts/blackboard-delivery-contract.mjs` preserves typed outcomes `SATISFIED | IMPLEMENTATION_DEFECT | INSUFFICIENT_EVIDENCE | PLAN_INPUT_CONTRADICTION`, but the Worker verdict reduces all non-contradiction failures to `REPAIR_REQUIRED`.
- `scripts/blackboard-jev.mjs::validateResponse` intentionally persists only trusted question ids and numeric aggregates; it never echoes provider text. A JEV artifact therefore identifies which criterion failed and the typed failure class, but does not contain a natural-language diagnosis.
- Current replay protection rejects unstable verdict replacement for the same cache key, but a trivially changed candidate can obtain a new cache key. There is no finding-linked material-delta requirement before another provider call.

This is why the present behavior can converge toward "change artifacts until JEV passes" rather than "understand the failure, revise the strategy, then act."

## External evidence

Only repositories with at least 1,000 stars at the evidence date are used as repository evidence.

| Source | Stars (2026-10-03) | Useful mechanism | Missing for ExHarness |
|---|---:|---|---|
| Reflexion, `noahshinn/reflexion` @ `218cf0ef1df84b05ce379dd4a8e47f17766733a0` | 3,297 | On a failed prior trial, `run()` calls `reflect()` before reset/next step; the reflection is injected into the next agent prompt. This proves the value of an explicit cognitive transition between failure and another attempt. | Reflection is self-authored memory; there is no exact candidate/evidence binding, authority boundary or material-delta enforcement. |
| DSPy, `stanfordnlp/dspy` @ `ba3f9198efe5d125c7c1a2b40b1f1e6166209bd2` | 38,473 | GEPA sends execution examples + metric feedback to a separate reflection LM, which proposes a changed candidate and re-evaluates it. | It is an optimizer against a metric, not a delivery authority; metric gaming remains possible without an independent product verifier. |
| GEPA, `gepa-ai/gepa` @ `fb1ed589fd83372caef499cffc2c73173d3b096b` | 6,850 | `EvaluationBatch` retains trajectories and `ProposalFn` receives the current candidate plus a reflective dataset. Proposal metadata contains parent iteration identity, giving explicit candidate lineage. | Candidate lineage is optimization lineage, not exact repository/evidence/currentness authority. |
| LangGraph, `langchain-ai/langgraph` | 42,639 | Official evaluator-optimizer workflow models feedback as graph state and conditionally routes the graph back to generation/refinement. | The primitive does not define epistemic sufficiency, exact subject binding, anti-spam material delta or trusted merge/delivery authority. |

Primary papers used as conceptual evidence:

- Reflexion: Shinn et al., *Reflexion: Language Agents with Verbal Reinforcement Learning*, NeurIPS 2023 / arXiv:2303.11366. The framework reflects on task feedback and carries the reflection into later trials.
- Self-Refine: Madaan et al., *Self-Refine: Iterative Refinement with Self-Feedback*, arXiv:2303.17651. It demonstrates iterative feedback/refine value, but intentionally lets the same model generate, critique and refine; that is useful as a comparator, not as ExHarness authority.

Research conclusion: the reusable idea is **failure -> explicit reflection state -> changed attempt**, not "retry until the evaluator accepts." ExHarness must add exact subject/currentness and authority semantics around that idea.

## Chosen lifecycle

Keep the two lanes. Add one Worker phase:

```text
WORKER/EXECUTION
  -> JUDGMENT
  -> SATISFIED --------------------------> MERGE_PENDING
  -> PLAN_INPUT_CONTRADICTION ----------> RESEARCH_SA/RESEARCH
  -> IMPLEMENTATION_DEFECT /
     INSUFFICIENT_EVIDENCE
          |
          v
      WORKER/LOOKBACK     (read-only source)
          |
          | publish bound SUPERVISION_LOOKBACK_V1
          v
      WORKER/REPAIR       (source-write authority)
          |
          v
      JUDGMENT
```

A hidden "lookback-required" flag inside REPAIR was rejected. It would leave the phase name claiming repair authority while conditionally hiding writes, make onboarding depend on a substate invisible in the lane/phase projection, and collide with BB-152's phase-complete delivery envelope. A first-class Worker phase keeps authority explicit without adding a third lane.

## Failure input to LOOKBACK

Do **not** add free-text JEV rationale in v1.

The delivered JEV response contract intentionally says "never echo provider text." That is a useful trust boundary. The supervisor instead builds a deterministic `SUPERVISION_FINDING_SET_V1` projection from trusted data already present:

- exact evaluation ref + hash;
- plan ref + hash;
- failed question ids and typed choices;
- criterion/invariant/negative-case/Living-Docs statements owned by those ids;
- exact prior candidate SHA/tree and evidence ref/hash;
- evidence refs already mapped to the failed claims;
- repeat count and prior finding signature.

The actor receives that finding set plus read access to the exact plan/candidate/evidence and must perform the causal diagnosis itself.

This makes JEV the **critic/judge**, not the repair author.

## SUPERVISION_LOOKBACK_V1

The actor-owned lookback is epistemic state, not correctness evidence.

Required shape:

```text
SUPERVISION_LOOKBACK_V1
  subject
    workId
    plan { ref, hash }
    evaluation { ref, hash }
    candidateSha
    candidateTree
    evidence { ref, hash }
    findingSignature

  diagnosis[]
    questionId
    failureClass
    whatWasExpected
    whatWasObserved
    whyPriorAttemptFailed
    invalidatedAssumptions[]
    evidenceRefs[]

  strategyRevision
    strategyClass
    priorStrategyRef|null
    changes[]
    intentionallyUnchanged[]
    expectedFreshEvidence[]

  mode
    DIAGNOSIS | STRATEGY_RECONSIDERATION
```

Rules:

1. Every failed question is addressed exactly once.
2. The artifact cannot claim `SATISFIED`, correctness, mergeability or delivery.
3. Source writes remain empty while LOOKBACK is active.
4. Publishing an exactly bound, structurally complete lookback is what transitions to REPAIR; the lookback itself does not prove that the strategy is good.
5. Stale evaluation/candidate/evidence bindings fail closed.
6. The next JEV result, not the actor's diagnosis text, determines whether the revised strategy actually resolved the finding.

## Material progress before another JEV call

The anti-spam rule ignores changes to lookback prose and control artifacts.

Persist a compact `SUPERVISION_STATE_V1` on the current task contract:

```text
lastFailedEvaluationRef
failedCandidateSha
failedCandidateTree
failedEvidenceHash
findingSignature
repeatCount
lookbackRef
lookbackHash
mode
```

Before Worker JEV materialization/provider dispatch:

- if any failed answer was `IMPLEMENTATION_DEFECT`, the candidate tree must differ from the failed candidate tree;
- if any failed answer was `INSUFFICIENT_EVIDENCE`, the current implementation-result/evidence hash must differ from the failed evidence hash;
- mixed failures require both corresponding deltas;
- changes only to lookback text, Blackboard projections, evidence metadata that does not alter the bound implementation result, or retry count are not material progress;
- `PLAN_INPUT_CONTRADICTION` still returns upstream and never enters Worker LOOKBACK/REPAIR.

This gate belongs before provider dispatch. Evidence collection may execute locally, but a no-delta repair cannot spend another JEV call.

## Repeated failure

`findingSignature = hash(sorted(questionId + ':' + choice))` over all non-satisfied answers.

On publication of a new failed Worker judgment:

- different signature -> `repeatCount = 0`, LOOKBACK mode `DIAGNOSIS`;
- same signature as the prior failed cycle -> increment `repeatCount`, LOOKBACK mode `STRATEGY_RECONSIDERATION`.

`STRATEGY_RECONSIDERATION` requires the lookback to reference the previous strategy and explicitly state why that strategy failed plus an alternative strategy class. It still does not self-authorize success.

No automatic transition to RESEARCH is introduced solely from repeat count in v1. Repeated implementation failure is evidence that the strategy needs reconsideration, not proof that the plan is contradictory.

## Canonical controller seam

Add a pure trusted module `scripts/blackboard-supervision.mjs` owning:

- finding-set projection;
- finding signature/repeat semantics;
- LOOKBACK -> REPAIR lookback validation;
- material-progress validation before JEV dispatch;
- phase-to-action/source-authority projection for LOOKBACK.

Consumers:

- `blackboard-delivery.mjs`: evaluation publication and lookback publication;
- `blackboard-delivery-context.mjs`: derive LOOKBACK context and source authority;
- `blackboard-implementation-bootstrap.mjs`: expose LOOKBACK intent rather than implementation intent;
- `blackboard-jev.mjs`: assert material progress before Worker provider dispatch;
- `blackboard-jev-ci.mjs`: consume the same supervision validity when evaluating candidate work.

CI workflow YAML does not need new business semantics. It remains an enforcement/projection surface around the trusted scripts.

## Interaction with BB-152

BB-152 owns phase-complete onboarding and is now a Worker dependency for BB-153.

Worker implementation of BB-153 must start from delivered BB-152 and extend its phase table with LOOKBACK. It must not recreate a parallel bootstrap policy. If BB-152's delivered API differs from its current plan, Worker returns `PLAN_INPUT_CONTRADICTION` before product writes.

## Benchmark and evaluation

### Deterministic contract benchmark

Fixtures exercise a complete failure cycle without provider calls:

1. JEV `IMPLEMENTATION_DEFECT` publication yields LOOKBACK, not REPAIR.
2. LOOKBACK context is source-read-only.
3. stale lookback cannot transition.
4. valid lookback transitions to REPAIR.
5. unchanged candidate tree blocks a second JEV dispatch for implementation defect.
6. evidence-only change blocks implementation-defect retry but may satisfy an insufficient-evidence-only delta.
7. prose-only lookback changes never count as material progress.
8. the same finding signature on the next failed cycle selects STRATEGY_RECONSIDERATION.
9. local publication and CI validation call the same supervision module.

### Held-out behavioral ablation

After deterministic correctness, compare gate-only baseline versus supervisory loop on a fixed held-out set of repairable tasks using the same model/provider/task/base/budget.

Measure:

- independent final task acceptance;
- JEV provider calls per accepted task;
- repeated identical finding rate;
- attempts before the first failed finding is resolved;
- fraction of repair cycles with a material candidate/evidence delta;
- input/output tokens, elapsed time and estimated cost where observed;
- regressions introduced while repairing a prior finding.

The supervisory loop is valuable only if independent acceptance is preserved while repeated-finding/provider-call waste falls. A lower JEV-call count alone is not success.

## Rejected alternatives

### A. Stronger JEV prompt only

Rejected. It may produce better criticism but does not change actor authority; the model can still mutate immediately after failure.

### B. Free-text JEV diagnosis persisted as trusted output

Deferred. Current JEV deliberately avoids echoing provider text. Free prose would enlarge the trusted response surface and can become accidental repair instructions. V1 keeps typed outcomes and lets the actor reconstruct diagnosis from bound evidence.

### C. LOOKBACK as a flag inside REPAIR

Rejected. Hidden authority state is harder to route, test and explain than a first-class phase and conflicts with phase-complete onboarding.

### D. JEV evaluates the lookback before repair

Rejected for v1. That creates a recursive evaluator gate and optimizes lookback prose. Structural/binding checks authorize the repair attempt; only fresh outcome evidence and the next independent JEV judgment assess whether the repair worked.

### E. Retry-count cap that automatically declares plan contradiction

Rejected. Repetition may mean poor repair strategy; it does not establish an upstream contradiction.

## Worker handoff

Direct dependencies:

- BB-056 DONE: delivered Outer Blackboard JEV/evidence/publication pipeline.
- BB-059 DONE: delivered evidence-gated JEV/HOW evaluation semantics.
- BB-152 must be DONE before BB-153 Worker: phase-complete delivery onboarding is the surface BB-153 extends.

Expected new implementation surface:

- `scripts/blackboard-supervision.mjs`
- `test/blackboard-jev-supervision.test.mjs`

Expected modified trusted surfaces:

- `scripts/blackboard-work-graph.mjs`
- `scripts/blackboard-delivery.mjs`
- `scripts/blackboard-delivery-context.mjs`
- `scripts/blackboard-implementation-bootstrap.mjs`
- `scripts/blackboard-jev.mjs`
- `scripts/blackboard-jev-cli.mjs`
- `scripts/blackboard-jev-ci.mjs`
- `scripts/blackboard-state-project.mjs`
- `docs/blackboard/jev.md`
- `docs/blackboard/pipelines.md`
- `docs/living/system/state.md`

Worker start rule: bind exact delivered BB-152 surface first. If its phase-envelope contract contradicts this plan, return to RESEARCH_SA; do not adapt architecture ad hoc in Worker.


## Research publication hygiene

The registration PR and the research-closure PR use different branches. A branch that has already been merged must not be reused as evidence that a later research head passed CI/JEV: checks are accepted only when their subject SHA is the exact current PR head. This section records that BB-153 research closure is intentionally published from a fresh branch and must receive a fresh exact-head workflow result before merge.


## JEV R1 lookback — shared local/CI seam

Fresh readiness on exact PR head `99a06d29c29cc772fa15446733ef7af453471cf1` returned only one non-satisfied objective: the local/CI shared-semantics criterion was `INSUFFICIENT_EVIDENCE` (0.49) versus `SATISFIED` (0.48). All other objective and readiness questions were SATISFIED. The response contains no provider prose by design, so the research action is derived from the exact failed criterion and current source evidence rather than guessed repair instructions.

The first design overreached by saying `blackboard-jev-ci.mjs` should directly consume the new supervisor module. Current CI proves that this is the wrong trust seam:

- local `blackboard-jev-cli.mjs` imports `materialize/evaluate` from `blackboard-jev.mjs` and publication from `blackboard-delivery.mjs`;
- CI `blackboard-jev-ci.mjs` also imports `materialize/evaluate/validateEvaluation` from `blackboard-jev.mjs`;
- the CI evaluate branch explicitly states that it only reads candidate data and never imports or executes candidate modules;
- `.github/workflows/test.yml` pins both `trusted_sha` and `controller_sha` to the PR base;
- the reusable workflow executes `controller/scripts/blackboard-jev-ci.mjs`.

Therefore the shared seam is **below the adapters**, not inside the CI adapter:

```text
local CLI --------------------> blackboard-jev.mjs ----                                                        -> blackboard-supervision.mjs
trusted-base CI adapter ------> blackboard-jev.mjs ----/

local publish ----------------> blackboard-delivery.mjs -> blackboard-supervision.mjs
```

`blackboard-jev-ci.mjs` remains thin/data-only and does not need a BB-153 implementation write. During the BB-153 implementation PR, candidate kernel tests execute the new module, while JEV itself remains pinned to the old trusted base. Once merged, later PRs naturally execute the delivered supervision module from their trusted base controller.

This resolves the evidence gap without weakening the CI trust boundary or adding a second policy.


## JEV R2 lookback — bounded objective evidence

R2 on `7d86f03fcff9aa02112b5c1760433b7de48fd084` did not reach the provider. Trusted materialization failed with `objective sourceAnchors exceeds bounded limit`: objective-4 had five exact anchors after the R1 grounding pass, while JEV allows at most four per objective. This is a plan-shape failure, not a semantic finding.

The repair preserves the R1 conclusion and removes only the redundant reusable-workflow anchor. The four retained anchors prove (1) local CLI delegation into `blackboard-jev.mjs`, (2) CI adapter delegation into the same module, (3) the CI data-only/no-candidate-module boundary, and (4) controller pinning to the PR base. The reusable workflow remains listed in sourceRefs/supporting evidence but does not consume a fifth exact anchor slot.


## JEV R3 lookback — research payload budget

R3 on `a6d224a122d9a4fbdf76fa18ff4bb5282eec5ebc` again stopped before a provider call. The exact error was `payload exceeds budget; refine evidence without dropping required coverage`. RESEARCH_SA uses a 98,304-byte default cap; R1 was already 97,771 bytes. The R1 grounding additions therefore exceeded the bounded request even though the plan file itself remained small.

The fix separates **durable research detail** from **JEV readiness projection**: full local/CI reasoning stays in this research record and `evidence/BB-153/research.json`, while the plan keeps only atomic decisions, compact acceptance evidence and four exact anchors. No criterion, negative case, invariant, source boundary or implementation decision is dropped.
