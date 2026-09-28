# BB-083 — Reuse-first feedback research

Status: SOURCE REVIEW + DETERMINISTIC UPSTREAM SEAM PROBE COMPLETE; implementation plan remains DRAFT, no Jev readiness or delivery claim.
Checked: 2026-09-28. ExHarness baseline: `c5356b4d6ae81df64bcfcdb8cd8fd196f1f4e7f5`.
User rule: all previously researched tasks/objectives/plans remain unchanged. This is additive BB-083 work on PR #322; the task registration is not yet merged.

## Decision

Prefer the standalone **GEPA Python engine behind an ExHarness adapter** for offline candidate search. Do not implement another reflection/Pareto/population/checkpoint engine and do not make the JS application a DSPy program merely to obtain GEPA.

Keep existing ExHarness evidence stores, reconciliation, independent HOW evaluation and promotion authorities. Normalize provider events, expose an evidence/context projection to GEPA, and treat its selected candidate as a proposal. This is a source/probe-supported selection for the next integration experiment, not proof of production effectiveness.

The user's shortlist is the primary evidence base. Initial claims that GEPA lacks durable lineage or LangMem is merely prose memory were too broad: the inspected versions already provide substantially more mechanics.

## Verified eligibility and pins

| Repository | Stars checked | Source commit | License metadata |
|---|---:|---|---|
| stanfordnlp/dspy | 38391 | `9c900c7de0a3cc3114c23fe8202ebe48e2206ce1` | MIT |
| gepa-ai/gepa | 6776 | `d771eb21b5dd3228bc3f567293d2ccfc423fc900` | MIT |
| noahshinn/reflexion | 3286 | `218cf0ef1df84b05ce379dd4a8e47f17766733a0` | MIT |
| langchain-ai/langgraph | 42396 | `07b33185eab893be2ed031eedae52f09314bf77c` | MIT |
| langchain-ai/langmem | 1686 | `9d033b47d9ce53e37e92c92241b0496c0278932e` | MIT |
| OpenHands/OpenHands | 89348 | `fd9145958e9e93bfbad3252fce7a69493e61215a` | MIT |
| OpenHands/software-agent-sdk | 1178 | `3311ba9eec5044f40ab5d0b3d7eddc9f7e1e2d14` | MIT |

All meet >=1,000 stars at this check. Stars establish eligibility only. The SDK MIT text was also inspected. Adoption must retain notices and inspect the exact dependency closure; metadata is not a license audit of every transitive package. OpenHands application and SDK are distinct repositories and must not share evidence by implication.

## Mechanism-by-mechanism result

| Mechanism | Source finding | Reuse decision / trade-off |
|---|---|---|
| DSPy / GEPA | DSPy wraps the independent GEPA package. Its metric supports score and feedback; results retain candidate parents and per-instance/per-objective scores. | Use GEPA directly for current JS ExHarness. Use DSPy wrapper only when optimizing an actual DSPy program. Avoid a program-model rewrite. |
| Standalone GEPA | `GEPAAdapter.evaluate`, `make_reflective_dataset`, optional proposer/state methods; Pareto strategies, acceptance policies, callbacks, budget stoppers and checkpoint/resume already exist. | Reuse engine through Python process adapter. ExHarness supplies controlled execution/evidence and final review. No optimizer fork. |
| Reflexion | Programming runner evaluates visible/generated tests, reflects on concrete test feedback, and separately calls held-out evaluation. Reflections and implementations are logged. | Borrow bounded local-reflection pattern. Do not import the benchmark runner as a production library: executor uses in-process exec; task-specific assumptions and lack of ExHarness authority binding require isolation/adaptation. Do not claim it has no external feedback or independent test split. |
| LangGraph | Checkpoint contains channel versions/pending-write state; BaseStore provides cross-thread namespaced data. | Keep as alternative for an application already using LangGraph. For ExHarness, existing durable continuation/artifact store is the default; a second workflow engine needs measured benefit. This is deployment-cost reasoning, not a demonstrated performance disadvantage. |
| LangMem | Schema-based extraction, insert/update/delete controls, model-assisted consolidation, local/remote reflection execution, and multiple prompt optimizers exist. | Optional extraction/consolidation adapter producing proposals only. Defer mandatory dependency until it beats a bounded GEPA/native evidence projection on a labeled cohort. Do not rebuild a competing generic memory manager first. Its dependency list includes LangChain, LangGraph, trustcall and provider integrations. |
| OpenHands SDK | ObservationEvent carries action_id/tool_call_id; persistent EventLog indexes IDs, supports parent relationships and locking, with duplicate-ID tests. | Reuse/normalize events when OpenHands is the selected runtime. No new event bus or copy of EventLog for this feature. Provider IDs alone are insufficient: bind ExHarness attempt/candidate/provenance. |

Primary source anchors: [GEPA adapter](https://github.com/gepa-ai/gepa/blob/d771eb21b5dd3228bc3f567293d2ccfc423fc900/src/gepa/core/adapter.py), [GEPA engine](https://github.com/gepa-ai/gepa/blob/d771eb21b5dd3228bc3f567293d2ccfc423fc900/src/gepa/core/engine.py), [DSPy wrapper](https://github.com/stanfordnlp/dspy/blob/9c900c7de0a3cc3114c23fe8202ebe48e2206ce1/dspy/teleprompt/gepa/gepa.py), [Reflexion runner](https://github.com/noahshinn/reflexion/blob/218cf0ef1df84b05ce379dd4a8e47f17766733a0/programming_runs/reflexion.py), [LangGraph checkpoint](https://github.com/langchain-ai/langgraph/blob/07b33185eab893be2ed031eedae52f09314bf77c/libs/checkpoint/langgraph/checkpoint/base/__init__.py), [LangMem extraction](https://github.com/langchain-ai/langmem/blob/9d033b47d9ce53e37e92c92241b0496c0278932e/src/langmem/knowledge/extraction.py), [SDK event](https://github.com/OpenHands/software-agent-sdk/blob/3311ba9eec5044f40ab5d0b3d7eddc9f7e1e2d14/openhands-sdk/openhands/sdk/event/llm_convertible/observation.py).

The full pinned source/test ledger is in `docs/blackboard/evidence/BB-083/source-ledger.json`. Upstream tests were inspected, not run; the probe below is separately executed evidence. No exhaustive claim that no repository implements the whole architecture is made.

## Executed GEPA seam experiment

Executed 111 Python source files fetched at the pinned GEPA SHA in scratch, using Python 3 without installing DSPy, LangGraph, LangMem or optional GEPA extras. GEPA base declares no mandatory dependencies in its pyproject; optional adapters/features may need extras.

The reproducible script is `docs/blackboard/evidence/BB-083/gepa-probe.py`. Put the pinned GEPA checkout's `src` on PYTHONPATH and execute the script; it writes `gepa-probe-result.json` beside itself. The fixture uses two train and two validation records with opaque evidence/context and a deterministic proposer/scorer. It is not an agent benchmark.

| Probe | Observed result | Interpretation |
|---|---|---|
| Adapter projection | Evidence refs and context reached reflective dataset | No GEPA modification needed to carry structured evidence. |
| Candidate search | Two candidates; contextual fixture candidate selected; 8 metric calls | Engine seam works. The synthetic score does not measure reasoning quality. |
| Train/validation projection | Reflection dataset contained only train refs | This adapter preserves separation in this fixture; final independent holdout must remain outside optimizer inputs. |
| Resume | New adapter restored state; total calls stayed 8 | Basic completed-run resume works. Not a process-crash/external-effect replay proof. |
| Default acceptance | [1.0, 0.0] -> [0.4, 0.9] accepted | Aggregate improvement can hide a per-case regression. Search acceptance is not ExHarness promotion. |
| Metric budget | max_metric_calls=7 produced 8 calls | Stopper is not a hard per-dispatch budget in this batch scenario. Enforce ledger reservation in the adapter before work. |

Two integration mistakes were caught and corrected in the probe: declare `propose_new_texts = None` when using a custom proposer; tolerate an empty `set_adapter_state({})` on initialization. Source was not patched to make the probe pass.

The run used zero model calls and provides no live effectiveness/cost-reduction claim. GEPA's checkpoint uses pickle; only locally controlled trusted checkpoints may be loaded, and it must not become the canonical ExHarness acceptance record.

## Smallest ExHarness addition

The existing delivered self-upgrade pilot already pins producer/evaluator identities, baseline/candidate, scenario sets and immutable evidence; it deliberately has no adoption authority. BB-059's accepted plan defines HOW finding/protocol/review/promotion; BB-075 freezes task cohorts and separates KEEP_BASELINE from INCONCLUSIVE/NO_ELIGIBLE_CANDIDATE. Reuse those contracts as planned dependencies without editing their scope.

Proposed composition:

1. Existing attempt/event evidence -> read-only normalized observation.
2. Oracle/current input refs -> bounded context projection; no new retriever.
3. Application-owned finding and response -> existing durable artifact/continuation store.
4. Eligible development episodes -> GEPA reflective dataset; reserve benchmark attempts before dispatch.
5. GEPA selected candidate -> immutable proposal envelope.
6. Existing independent HOW evaluation/promotion -> fresh outcome -> response resolution.

GEPA may search multiple candidates internally. Export only a frozen selected candidate to a separate independent experiment. Never reinterpret GEPA validation as an unopened holdout. The delivered pilot's one-candidate bound remains intact.

Only the linking and authority contracts are new: episode/response identity, provenance/currentness validation, typed resolution, and evidence-backed aggregation criteria. Pattern aggregation is initially a deterministic query/projection of episode refs; optional LLM synthesis is an untrusted proposal. A generic memory platform, new durable engine and new optimizer are out of scope.

### Proposed additive interfaces

These are BB-083 design candidates, not existing exports:

- `Observation`: subject/attempt/candidate ref+digest, provider event identity, evidenceRefs, observedAt, measured values.
- `ContextBinding`: resolutionRef+digest, required subject/policy refs, completeness and currentness; unresolved is explicit.
- `FeedbackEpisode`: observationRefs, context binding, finding, measured/hypothesized impact, scope and contraryEvidenceRefs.
- `FeedbackResponse`: application principal, expected current revision, disposition, ACTED/REJECTED/DEFERRED/SUPERSEDED, rationaleRef, work/experiment/successor refs and revisit condition.
- `FeedbackOutcome`: exact response/experiment refs, fresh evidence, IMPROVED/NO_CHANGE/REGRESSED/UNKNOWN. A rejected response may be acknowledged without a measured outcome.
- `ImprovementProposal`: GEPA source pin/config, allowed text-component diff, candidate digest, development evidence/ledger refs; no accepted/promoted flag.

A proposed candidate can change only the declared HOW text component. It cannot alter evaluator, sealed data, work semantics, budget, acceptance or policy head. No provider/parser field can supply a trusted application principal.

### Proposed physical implementation seams

| Proposed path | Purpose |
|---|---|
| packages/agentic-system/src/feedback-contracts.js | Additive typed episode/response/outcome validation and exact bindings. |
| packages/agentic-system/src/feedback-controller.js | Compose existing artifact/continuation and application authority; no standalone database. |
| packages/agentic-system/src/feedback-projection.js | Read-only instance/cohort/pattern projection, provenance and duplicate filtering. |
| packages/agentic-system/src/feedback-gepa-adapter.js | Bounded JSON request/response bridge and immutable proposal normalization. |
| scripts/feedback/gepa_adapter.py | Implement GEPAAdapter against benchmark execution port; reserve budget per unit before evaluation. |
| scripts/feedback/requirements.lock | Exact GEPA revision/dependency lock after packaging validation. |
| packages/agentic-system/test/feedback-*.test.js | Context, authority, currentness, response/replay and aggregation counterexamples. |
| test/feedback-gepa-bridge.test.mjs | Timeout, malformed payload, drift, budget admission and independent-holdout exclusion. |

Finalize exact existing exported functions after mapping delivered dependency surfaces. These paths are proposed; no product source was created. No old task gets new acceptance requirements.

## Evaluation protocol to finalize before READY

Contract corpus: same observation/different context; missing/stale context; duplicate/retried events; rejected/deferred/superseded responses; positive reinforcement; counterexamples; forged authority; unknown/no-change/regressed outcomes. All safety/currentness negative cases must reject; unresolved context must never silently become grounded causal truth.

Comparative experiment: same episode cohort, model snapshot, budget, allowed HOW axis and independent evaluator. Compare existing bounded proposal baseline, standalone GEPA adapter, and optional LangMem-assisted projection only if extraction quality is the measured bottleneck. Control total cost across proposal + search + final independent evaluation; record failed/censored attempts, not just successful candidates.

Freeze development/search-validation/final-holdout partitions before execution. Final holdout, acceptance policy and release reserve are not exposed to proposer prompts, memory or optimizer. Predeclare minimum useful effect and quality non-inferiority with sample-size/power rationale for the chosen cohort; do not invent a universal percentage from this toy probe.

Measure context/finding support precision on labeled episodes, false-pattern rate, outcome coverage, stale-binding rejection, evidence reconstruction, model calls/tokens/cost, latency and held-out quality. A systematic claim requires mechanism evidence beyond repeated observations.

## Remaining research gaps

1. Bind the proposed JS/Python bridge to exact planned/delivered benchmark and HOW/Oracle exports, including accounting of reflection and dispatch reservation, cancellation and uncertain provider outcomes.
2. Run real bridge crash/replay and hard-budget probes; current test covers direct Python adapter only.
3. Complete a discriminating labeled-cohort comparison for optional memory extraction; otherwise omit LangMem from v1 dependency closure and explicitly document that choice.
4. Freeze the final held-out experiment size/effect thresholds and package/dependency lock; live model effectiveness has not been tested.
5. Obtain independent Jev readiness once the new task/objective is in trusted routing. This environment has no TYPESAFE_API_KEY, so no local Jev call or SATISFIED claim was made.

The source/probe phase materially narrows the design: reuse GEPA; preserve current ExHarness authorities; avoid mandatory DSPy/LangGraph/LangMem rewrites. It does not close BB-083 or claim research readiness prematurely.
