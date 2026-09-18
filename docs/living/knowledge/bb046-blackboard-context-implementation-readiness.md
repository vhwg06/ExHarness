# BB-046 — Blackboard context implementation readiness

Status: **PROPOSED / IMPLEMENTATION CANDIDATE AFTER ARCHITECTURE ACCEPTANCE**

This artifact translates the Blackboard Context Plane into concrete repository seams. It does not authorize source implementation.

## 1. First consumer

The first consumer is deliberately **repository development coordination**:

```text
docs/living/blackboard.md
+ immutable machine-readable work-context specs
+ validation / evaluation tooling
```

It is not the runtime JSON Blackboard inside `packages/agentic-system`.

Reason:

- the user pressure is fresh agents working from the repository Blackboard;
- D008 already keeps repository Markdown coordination separate from runtime JSON project state;
- forcing both surfaces to converge before proving value would over-generalize.

A later runtime consumer must reuse semantics only after this repository slice earns them.

## 2. Canonical artifact format

Selected:

```text
WORK_CONTEXT_SPEC v1 = JSON
WORK_CONTEXT_RECEIPT v1 = JSON
```

Rejected for canonical machine state:

```text
Markdown frontmatter as the only representation
```

because deterministic validation should not depend on a permissive Markdown/YAML parser. Human-readable Markdown remains architecture/rationale, not current context truth.

Proposed path:

```text
docs/living/work-context/
  README.md
  BB-046/
    g0001-readiness-review.json
```

The Board points directly to the JSON generation.

## 3. Proposed first implementation slice

After independent architecture acceptance, implement only:

```text
A. context schema/validation
B. Board-to-context binding validation
C. deterministic context generation helpers for repository work
D. context resolver/read model
E. optional durable receipt at review/handoff
F. benchmark/probe
G. living-doc router/contract/pipeline promotion
```

Do not modify runtime organization execution in this slice.

## 4. Candidate source seams

### New — `scripts/blackboard-context-contract.mjs`

Owns plain-data validation:

```text
defineWorkContextSpec(...)
defineWorkContextReceipt(...)
validateContextGeneration(...)
validateContextSourceScope(...)
validateContextInputs(...)
```

No Board mutation and no source reads.

### New — `scripts/blackboard-context-board.mjs`

Repository Markdown Board adapter, bounded to the current documented item shape.

Responsibilities:

```text
read active Board
locate exact item
read logical current-context ref/generation
verify one current context pointer
reject missing/duplicate/invalid bindings
```

It does not become a runtime Blackboard parser/authority.

If parsing the repository Board proves too permissive or brittle, the implementation must stop and reopen the storage choice rather than silently inventing fuzzy parsing rules.

### New — `scripts/blackboard-context-resolver.mjs`

Input:

```text
validated WORK_CONTEXT_SPEC
repository root
```

Output:

```text
ResolvedContextPack
```

Responsibilities:

```text
resolve required refs
check file existence / source revision subject
separate required refs from audit refs
return exact identities/diagnostics
```

No scheduling, model call or acceptance logic.

### New — `scripts/blackboard-context-generate.mjs`

Concrete producers only.

First producer:

```text
review context producer
  Board item
  + exact candidate refs
  + current source baseline
  -> gN review spec
```

Second producer only after accepted implementation artifact:

```text
implementation context producer
  Board item
  + exact accepted decision
  + implementationSlices[sourceChanges, verification]
  + current source baseline
  -> gN implementation spec
```

The generator creates a candidate spec file. It does not make the Board pointer current.

### New — `scripts/blackboard-context-verify.mjs`

Verification:

```text
Board item current-context ref exists
spec parses as JSON
itemId/generation agree
parent generation monotonic
required refs exist
implementation action has exact decision ref
review action has empty write scope
write/forbiddenWrite overlap rejected
old/current pointer ambiguity rejected
```

### New — `scripts/blackboard-context-eval.mjs`

Runs the evaluation plan against deterministic repository fixtures and emits:

```text
artifacts/bb046-blackboard-context-eval.json
```

### Change — `package.json`

After implementation acceptance only:

```text
verify:blackboard-context
eval:blackboard-context
```

Integrate the hard verifier into `npm run verify` only after the migrated Board/context fixtures are stable.

### Change — `docs/living/README.md`

Promote the router from:

```text
Blackboard
-> infer smallest relevant docs
```

to:

```text
Blackboard
-> exact current context
-> declared refs/source
```

only after implementation exists.

### Change — `docs/living/contracts.md`

Promote accepted work-context invariants.

### Change — `docs/living/pipelines.md`

Promote accepted loading/generation/recovery flows.

### Change — `docs/living/blackboard.md`

For migrated active items, add logical current context binding:

```text
context-generation: N
context-ref: docs/living/work-context/<id>/gNNNN-*.json
```

This is coordination state; payload remains external.

## 5. Context head mutation

The first repository implementation does not need a generic database.

Mutation protocol:

```text
1. generate immutable next JSON spec
2. validate it
3. update Blackboard exact ref + generation in the same reviewed repository change
4. old spec remains history
```

Git commit is the repository durability boundary.

This is not equivalent to the runtime `ApplicationOrchestrator` transaction and must not be presented as such.

## 6. Source revision semantics

A context may pin:

```json
{
  "sourceBaseline": {
    "repository": "vhwg06/ExHarness",
    "revision": "<commit>"
  }
}
```

The resolver classifies drift:

```text
exact baseline
relevant drift
irrelevant drift
```

The first implementation should be conservative:

- exact baseline always valid if refs exist;
- if HEAD differs, compare declared read/write paths;
- material change to declared seams marks context stale;
- unrelated drift does not force regeneration.

Do not claim full semantic diff detection in v1.

## 7. Board parsing risk

This is an explicit implementation risk.

Current `blackboard.md` is human-readable Markdown, not a formal runtime database.

The first parser must be narrow and fail closed. It must not:

```text
guess malformed item boundaries
repair invalid fields silently
scan prose to infer refs
accept duplicate current-context bindings
be reused as runtime JSON Board authority
```

If robust parsing needs a broader Board format change, that is a separate architecture decision.

## 8. Context resolution and model delivery

The resolver should produce a small generated read model suitable for a worker/model:

```json
{
  "itemId": "BB-046",
  "contextGeneration": 2,
  "action": {...},
  "requiredInputs": [...],
  "sourceScope": {...},
  "hardInvariants": [...],
  "verification": [...]
}
```

Large source/doc payload bodies need not be copied into the read model if the agent/tooling can open exact refs directly.

The read model is disposable.

## 9. Receipt boundary

Do not implement receipts before a consumer needs durable proof of loaded inputs.

The first likely consumer is review/handoff evaluation.

Candidate receipt storage:

```text
artifacts/work-context/<item>/<generation>/<receipt-id>.json
```

A receipt references exact inputs/digests; it does not duplicate source bodies.

## 10. Tests

### Contract tests

```text
valid review spec
valid implementation spec
wrong item id rejected
generation zero/rollback rejected
write/forbiddenWrite overlap rejected
implementation without accepted decision rejected
review with source writes rejected
missing required refs rejected
audit-only missing ref allowed in normal path
```

### Board binding tests

```text
missing context pointer rejected for migrated item
pointer generation != spec generation rejected
pointer item != spec item rejected
orphan gN+1 does not become current
duplicate current binding rejected
```

### Fresh-session tests

```text
new process reads Board
resolves exact current spec
loads same required refs
derives same safe action
uses no chat state
```

### Drift tests

```text
relevant source seam change -> stale
unrelated source change -> usable
accepted decision change -> stale
Board context pointer advance -> old generation stale
```

### Authority tests

```text
review context cannot authorize implementation
generator cannot self-set accepted decision
audit ref cannot widen write scope
context receipt cannot make context current
```

## 11. Migration

Start only with BB-046.

```text
Phase 0
  architecture/research MR only

Phase 1
  implement JSON spec validator + BB-046 current binding
  evaluate fresh-session review/implementation fixtures

Phase 2
  if value proven, migrate new Integration items by default

Phase 3
  consider runtime consumer only after second concrete need
```

Historical Board archives are not migrated.

## 12. Rollback

If explicit context fails the evaluation/value gate:

```text
remove required current-context protocol for new items
preserve research/evaluation history
return repository workflow to current Board + bounded handoff rules
```

No runtime data migration is required because the first slice is repository-local.

## 13. Implementation acceptance

The first implementation slice is accepted only when:

```text
fresh worker reconstructs same safe action without chat
stale generation cannot be used
review cannot mutate source
implementation requires exact accepted decision
required/audit refs remain distinct
context does not become correctness authority
context overhead beats or justifies itself against baseline
current worktree docs are synchronized with delivered behavior
```
