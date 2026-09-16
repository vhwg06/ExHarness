# BB-037 — Grounded experience reuse research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

Can ExHarness reuse verified semantic-memory experience before a recurring Backend remediation run to reduce repeated repair work without transferring stale, unrelated or contradictory experience and without turning memory relevance into correctness or acceptance authority?

## Source-backed boundary

The existing Core memory stack already has the primitives needed for the experiment:

```text
SemanticMemoryPort
  -> immutable origin + revisioned lifecycle
  -> tags / temporal metadata / source refs / provenance

SemanticMemoryRetrievalPort
  -> external retriever ranking
  -> materialize authoritative active memory records
  -> archived/tag/kind filtering
  -> kernel-owned result budgets
  -> semantics = RELEVANCE_ONLY

SemanticMemoryIntelligencePort
  -> provider relevance
  + importance
  + confidence
  + recency
  + optional graph signal
  -> bounded reranking
  -> semantics remains RELEVANCE_ONLY
```

Core deliberately does not claim that a high-ranked memory is true, applicable to the current project/revision or sufficient acceptance evidence. `semantic-memory-retrieval.js` returns `RELEVANCE_ONLY`; retrieved views cannot become correctness evidence. `semantic-memory-intelligence.js` fuses ranking signals but does not own project/revision transfer policy. Archived memories are already filtered by the Core retrieval boundary.

Therefore BB-037 does **not** justify changing Core ranking or memory truth semantics. The concrete candidate is an Agentic Application remediation-context adapter that applies task/project applicability rules to existing retrieval results before any experience is offered to a Backend remediation run.

## Experiment contract

Runnable gate:

```text
npm run eval:memory-reuse
```

Source:

```text
scripts/semantic-memory-reuse-eval.mjs
```

Checked result:

```text
artifacts/bb037-grounded-experience-reuse-eval.json
```

The root `npm run verify` pipeline executes this evaluation on Node 20/22/24.

Evidence class:

```text
DETERMINISTIC_REFERENCE
productionEvidence = false
```

The experiment uses the actual Core in-memory semantic-memory provider, retrieval port and intelligence port. Only the remediation outcome model is deterministic fixture logic.

### Fixed corpus

Nine training experience records cover:

- a transferable alpha checkout timeout repair;
- an alpha revision-specific checkout fact from an older revision;
- a beta revision-specific checkout repair;
- an unrelated gamma checkout timeout technique;
- alpha auth experience under another evaluation policy;
- temporally stale alpha auth experience;
- two contradictory alpha quota repairs;
- one archived alpha quota repair.

Four held-out recurring-failure tasks cover:

- same-project cross-revision transferable technique;
- exact revision-specific experience;
- stale / policy-mismatched experience where reuse must abstain;
- contradictory applicable repairs where reuse must abstain.

The fixed remediation budget is three attempts. The baseline needs two attempts for each fixture task. A matching applicable repair uses one attempt; an inapplicable selected repair consumes three attempts and is counted as negative transfer.

This `repairAttempts` metric is a deterministic experimental outcome, not a measured production developer/model attempt count.

## Compared modes

### No memory

No experience is supplied. This is the control.

### Lexical

Use the first result from the existing retrieval port with the deterministic lexical fixture retriever. There is no application applicability check after retrieval.

### Associative

Use the first result from existing `SemanticMemoryIntelligencePort` weighted fusion. There is no application applicability check after reranking.

### Application-bounded

Use existing Core intelligence only as relevance input, then require:

```text
exact project
exact repository
exact task family
exact evaluation-policy revision
persisted verification/evaluation source link
temporal validity
revision-scoped fact => exact repository revision
technique-scoped experience => may transfer across revisions only inside the same project/repository/family/policy
```

If multiple admitted memories recommend different repairs, the adapter abstains and exposes a contradiction diagnostic. If none are applicable, it falls back to no-memory behavior. Archived memory remains excluded by the Core retrieval boundary.

Every result retains:

```text
semantics = RELEVANCE_ONLY
acceptanceAuthority = false
```

## Predeclared decision rule

Before locking the measured artifact, the candidate rule was fixed as:

> NARROW or ADOPT only if bounded reuse reduces held-out repeat failures or repair attempts versus no-memory without worse final correctness, cross-project recall, stale/wrong-scope reuse, or acceptance-authority violations. Fixture evidence cannot authorize a production default.

The temporal-staleness metric itself was corrected before the baseline artifact was locked: the first probe exposed that a raw lexical selection could choose a `validTo`-expired memory while the metric counted only scope tags. Temporal validity was added to the applicability/negative-transfer measurement, then the artifact was regenerated. This correction changes measurement fidelity, not the candidate policy after observing a desired score.

## Results

| Mode | Repair attempts | Repeat failures | Final correct | Negative transfers | Cross-project recalls | Stale/wrong-scope recalls | Retrieval chars |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| No memory | 8 | 4 | 4 / 4 | 0 | 0 | 0 | 0 |
| Lexical | 6 | 2 | 4 / 4 | 1 | 0 | 1 | 13,573 |
| Associative | 10 | 6 | 4 / 4 | 3 | 2 | 3 | 16,977 |
| Application-bounded | 6 | 2 | 4 / 4 | 0 | 0 | 0 | 7,618 |

The bounded candidate reduces fixture repair attempts from 8 to 6 and repeat failures from 4 to 2 while keeping the same 4/4 final-correct result. It records no negative transfer, cross-project recall, stale/wrong-scope reuse or acceptance-authority violation.

Raw lexical ranking happens to match three fixture repairs but selects one expired auth memory, creating one negative transfer. Raw associative ranking is worse than the no-memory control in this corpus: 10 attempts, six repeat failures and three negative transfers, including two cross-project selections. This is evidence against treating richer relevance ranking as transfer applicability.

The bounded path also explicitly abstains on two important cases:

- alpha auth under `eval-v2`: stale/policy-incompatible prior experience yields `NO_APPLICABLE_EXPERIENCE`;
- alpha quota: two applicable active memories recommend different repairs, yielding `CONTRADICTORY_REPAIRS:compensate-after-write|reserve-first` rather than selecting a winner from ranking score.

Core archive filtering is exercised independently: the archived quota record is dropped and never appears in the retrieval result.

`retrievalChars` is serialized-result character count used as a deterministic overhead proxy. It is not provider token usage, latency or monetary cost.

## Interpretation

The result supports **NARROW**, not ADOPT.

The evidence supports one bounded architectural statement:

```text
relevance ranking != transfer applicability
```

Existing semantic memory can be useful to a remediation consumer, but the value in this experiment comes from application-owned applicability and abstention rules layered over the existing Core retrieval semantics. The experiment does not demonstrate a need for a new memory engine, a changed intelligence ranking formula or a new correctness authority.

The associative negative-transfer cases are especially important: more ranking signals do not make an unrelated high-score memory safe to apply. Project/repository/family/policy/revision/freshness remain semantic application constraints, not ranking weights to infer away.

## Conditional implementation handoff

Runtime implementation should remain blocked until representative recurring-failure tasks establish the same benefit under the BB-005 production-evaluation track. If that evidence preserves the signal, the smallest integration is an opt-in Agentic Application adapter immediately before Backend remediation context/execution.

Candidate boundary:

```text
Backend remediation obligation
  -> BackendExperienceReuseAdapter.propose(...)
       -> existing SemanticMemoryIntelligencePort.search(...)
       -> application applicability validation
       -> bounded experience proposal or ABSTAIN
  -> existing Backend remediation execution
```

No Core schema/ranking/evolution change is required by BB-037.

### Proposed input

```text
BackendExperienceReuseRequest
  projectId
  repositoryRef
  revision
  taskFamily
  evaluationPolicyRevision
  query
  maxItems
  maxSerializedChars
```

### Proposed output

```text
BackendExperienceReuseProposal
  semantics: RELEVANCE_ONLY
  selectedExperienceRefs[]
  contextSummaries[]
  diagnostics[]
  policyRevision
  acceptanceAuthority: false
```

The proposal should carry stable memory/source refs rather than copy semantic memory into Blackboard state.

### Required invariants

- project, repository, task family and evaluation-policy identity are explicit application inputs;
- revision-scoped facts apply only to the exact revision;
- cross-revision transfer is allowed only for explicitly technique-scoped experience within the same project/repository/family/policy;
- temporally stale or archived experience is not applied;
- every selected experience retains inspectable persisted verification/evaluation source refs;
- contradictory admitted repairs cause abstention/escalation rather than ranking-based winner selection;
- no applicable memory falls back to the unchanged no-memory remediation path;
- memory visibility remains explicit and bounded by item/serialized-context budgets;
- retrieval/intelligence output remains `RELEVANCE_ONLY`;
- experience cannot satisfy Backend completion evidence, QA verification, trusted review or Blackboard DONE authority;
- selector/model confidence is not correctness evidence;
- rollout is opt-in and rollback is configuration-only.

### Verification before adoption

Representative evaluation should fix task/repository/policy revisions before measurement and compare:

- no-memory baseline;
- bounded reuse candidate;
- verified Backend/QA final outcome;
- repair/remediation attempts;
- repeat-failure rate;
- inappropriate cross-project/revision/policy reuse;
- contradiction/abstention rate;
- retrieval/context tokens, latency and provider cost when available;
- stale-evidence rejection;
- false-completion / acceptance-authority violations.

Negative and inconclusive runs must remain in the corpus. Production adoption requires no correctness degradation and a demonstrated remediation-effort or cost benefit under representative tasks.

## Limitations

This experiment does not establish production effectiveness:

- training experiences and held-out tasks are synthetic and were designed in the same research slice;
- the held-out split prevents direct task reuse but does not eliminate fixture/design bias;
- remediation attempts are deterministic fixture outcomes, not model/provider executions;
- all modes end final-correct within the fixed three-attempt budget, so the measured value is repair-effort reduction and negative-transfer avoidance, not production success-rate improvement;
- retrieval character counts are not token, latency or monetary measurements;
- no real repository, external model/provider or human review workload is measured;
- the fixture does not establish ideal applicability taxonomy or thresholds for arbitrary projects.

These limitations are why the result is `NARROW` and why no runtime default is authorized.

## Relationship to existing Board work

- BB-005 owns representative production effectiveness and is the gate for any runtime adoption from this result.
- BB-026 owns durable research continuation, not remediation-memory applicability.
- BB-034 owns self-upgrade experiments; memory reuse here does not authorize autonomous policy change.
- Core semantic-memory evolution remains separate: evolution can archive/reconcile/reinforce memory, but BB-037 does not change its authority or proposal semantics.

No new implementation work item should be created from this deterministic fixture alone. If BB-005 later demonstrates representative value, create one bounded application implementation follow-up from this handoff rather than generalizing Core memory first.

## Conclusion

Existing Core semantic-memory retrieval is sufficient as a relevance substrate, but raw relevance and associative reranking are not safe transfer policies. Deterministic evidence supports an application-side applicability fence that can reuse source-linked, scoped, fresh experience and abstain on stale, unrelated or contradictory memory. That is enough to justify representative evaluation of a future opt-in adapter, not enough to deliver or enable one today.
