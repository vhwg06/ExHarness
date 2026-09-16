# BB-036 — Task-aware Backend context selection research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

Can ExHarness add an optional task-aware file selector before Backend context resolution that improves required-context coverage without silently widening Oracle authority, weakening explicit source boundaries, or turning retrieval relevance into correctness evidence?

## Current source-backed boundary

The current path is deliberately explicit:

```text
BackendObjective.requiredFiles
  -> makeBackendWorkOrder(...)
  -> BackendWorkOrder.requiredFiles
  -> resolveBackendContext(...)
  -> repositoryReader.readFile(...) for each exact path
  -> BackendContext
  -> BackendWorker exact-match check
```

`BackendObjectiveSchema` requires at least one `requiredFiles` entry. `makeBackendWorkOrder(...)` copies that list unchanged. `resolveBackendContext(...)` iterates exactly that list and does no discovery. `BackendWorker` rejects any context whose resolved path list does not exactly match the WorkOrder.

Therefore a selector cannot be inserted inside Oracle without changing the current authority model. If justified, it belongs before WorkOrder construction in `runBackendObjective(...)` and must produce an application-validated proposal.

Core context selection is a different boundary. `packages/core-harness/src/context.js` selects already-defined prompt blocks/history under explicit limits; it does not authorize repository discovery or file IO and should not be reused as source-selection authority.

## Research constraints

This experiment was predeclared before measuring the candidate:

- fixed repository identity: `repo://bb036-fixture@fixture-v1`;
- six deterministic tasks split 3 train / 3 held-out;
- same task/repository fixture for every mode;
- explicit ground-truth required files used only by the verifier, never by the selector;
- one unavailable declared source must remain fail-closed;
- oversized and misleading candidates are present;
- candidate is interesting only if held-out required-context coverage improves over manual without reducing fixture task pass rate;
- fixture success does not establish production effectiveness.

The runnable probe is:

```text
node docs/living/knowledge/bb036-task-aware-context-selection-probe.mjs
```

Checked output: `artifacts/bb036-task-aware-context-selection-probe.json`.

Evidence class: `DETERMINISTIC_REFERENCE`, `productionEvidence=false`.

## Compared modes

### Manual

Use only the application-declared file set. This represents the current selection baseline, not the whole current runtime: Oracle still resolves those files exactly and may fail if a source is unavailable.

### Lexical

Rank available paths using task/path token overlap only, up to three files.

### Symbol

Rank available paths using task/path plus fixture symbol metadata, up to three files.

### Bounded selector

Preserve every explicitly declared file, then add only high-scoring available candidates while enforcing:

```text
maxFiles = 3
maxContextChars = 8000
minimumCandidateScore = 6
oversized file penalty
optional docs penalty
```

The bounded proposal never removes an explicit declared path merely because the catalog marks it unavailable. The unavailable-path scenario therefore still fails rather than being silently substituted.

## Results

### Training split

| Mode | Fixture passes | Mean required coverage | Unnecessary reads | Context chars |
| --- | ---: | ---: | ---: | ---: |
| Manual | 0 / 3 | 44.44% | 0 | 6,300 |
| Lexical | 1 / 3 | 66.67% | 2 | 22,000 |
| Symbol | 2 / 3 | 100% | 2 | 26,000 |
| Bounded | 3 / 3 | 100% | 0 | 15,100 |

### Held-out split

| Mode | Fixture passes | Mean required coverage | Unnecessary reads | Context chars | Source-failure tasks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Manual | 0 / 3 | 50% | 0 | 5,000 | 1 |
| Lexical | 0 / 3 | 33.33% | 3 | 16,300 | 0 |
| Symbol | 2 / 3 | 83.33% | 4 | 18,400 | 0 |
| Bounded | 2 / 3 | 100% | 0 | 12,000 | 1 |

`fixtureTaskPass` is a deterministic context-precondition check: all verifier-required files must be selected, every required source must be available, and selected context must stay within the fixed context budget. It is not a model execution score or production task-success claim.

The bounded selector does not beat symbol-only on held-out pass count; both are 2/3 because the payment task intentionally contains an unavailable required source. It does improve required coverage from 83.33% to 100%, removes four unnecessary held-out reads, and uses less selected source context. More importantly, it preserves the unavailable explicit source as a visible failure instead of replacing it with apparently relevant alternatives.

The selector itself consumes more metadata than manual declaration. The artifact reports `selectionInputChars` separately from selected source context. This is a deterministic character proxy, not provider token/cost telemetry.

## Interpretation

The evidence supports **NARROW**, not ADOPT.

A task-aware proposal can be useful when the declared set is incomplete, but the useful shape is not unrestricted semantic retrieval. The candidate works because it combines three controls:

1. explicit declared files remain mandatory;
2. candidate expansion is bounded by repository/revision metadata and cost limits;
3. the application validates the proposal before Oracle performs source IO.

The experiment also shows why a naked lexical or symbol ranker is insufficient. Misleading names, docs, cache/metrics files and oversized candidates can increase context cost or exceed budget even when semantic overlap is high.

No evidence here justifies changing Oracle into a discovery engine, changing BackendWorker exact-match semantics, or claiming retrieval relevance is correctness evidence.

## Conditional implementation handoff

Runtime implementation should remain blocked until a representative versioned repository/provider corpus is available through the existing BB-005 production-evaluation track. If that corpus preserves the held-out value signal, the smallest concrete implementation is:

```text
runBackendObjective(...)
  -> application obtains one exact-revision candidate catalog
  -> proposeBackendRequiredFiles({ objective, candidates, policy })
  -> validate proposal
  -> construct BackendWorkOrder with accepted selected files
  -> resolveBackendContext(order, { repositoryReader })
```

### Proposed concrete inputs

```text
BackendContextCandidateCatalog
  repositoryRef
  revision
  candidates[]:
    path
    optional bounded symbols/tags
    estimatedChars
    availability metadata when source-authoritative

BackendContextSelectionPolicy
  maxFiles
  maxContextChars
  score/threshold configuration
```

The selector output should be a proposal, for example:

```text
BackendRequiredFilesProposal
  repositoryRef
  revision
  declaredFiles[]
  proposedFiles[]
  addedFiles[]
  diagnostics[]
  policyRevision
```

### Application validation invariants

- proposal repository/revision exactly match the objective;
- every explicit declared file is retained;
- no duplicate/fabricated path;
- every added path comes from the exact candidate catalog;
- file/context budgets are enforced before Oracle read;
- unavailable explicit files are not silently dropped;
- selector metadata is not correctness evidence or acceptance authority;
- Oracle still reads only the accepted WorkOrder list and does not widen scope itself;
- BackendWorker continues to require exact WorkOrder/context agreement.

### Compatibility

Default behavior should remain the current explicit declared-file path. Selection must be opt-in until representative evaluation establishes value. A disabled or unavailable selector falls back to the unchanged declared set; a malformed proposal is rejected rather than partially applied.

No common Oracle resolver, provider registry, generic retrieval framework, or Core context API change is justified by this experiment.

### Verification before adoption

A real-corpus implementation must compare fixed tasks/revisions across:

- declared baseline;
- selector candidate;
- required-context coverage;
- verified Backend/QA task outcomes;
- unnecessary source reads;
- selected source chars/tokens;
- selector metadata/model cost and latency;
- source-resolution failures;
- false-completion rate.

Hold out tasks and preserve failed/inconclusive runs. The decision rule must be fixed before measurement. Production rollout requires no degradation in verified task success/correctness and a demonstrated coverage or cost benefit.

### Rollback

Rollback is configuration-only: disable selection and construct WorkOrders from the original declared file set. No persisted Blackboard, Core evidence, or Oracle contract should depend on selector-specific state for correctness.

## Relationship to existing Board work

- BB-005 remains the owner of representative production effectiveness and real-provider/repository evaluation.
- BB-009/010 remain the owner of Oracle resolver/diagnostic abstraction pressure; this experiment does not unblock them.
- BB-040 owns model-routing quality/cost research, not source-file selection.
- Core prompt-context selection remains downstream and separate.

No new implementation work item should be created from this fixture alone. If BB-005 supplies representative evidence that preserves this signal, create one bounded implementation follow-up from this handoff rather than generalizing Oracle first.

## Conclusion

The current explicit `requiredFiles -> WorkOrder -> Oracle exact read -> Worker exact match` contract is sound and should remain the default. Deterministic evidence shows that a bounded application-side proposal can recover omitted dependencies more cleanly than unbounded lexical/symbol ranking, while preserving explicit unavailable-source failure. That is enough to justify further real-corpus evaluation of the proposal boundary, but not enough to promote a runtime decision or production default.
