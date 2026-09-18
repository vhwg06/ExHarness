# BB-046 — Blackboard context pipelines

Status: **PROPOSED / PIPELINE CANDIDATE**

This file describes how context is created, loaded, changed and handed off. It does not promote a runtime implementation.

## 1. Current problem in the existing pipeline

Current repository guidance is intentionally lightweight:

```text
Blackboard
  -> claim work
  -> load smallest relevant worktree docs
  -> inspect source/tests
```

The ambiguous step is the second one. For complex Integration work, the worker has to decide the minimum context before it has the context needed to make that decision safely.

The candidate pipeline moves that selection into a durable item-scoped artifact.

## 2. New work creation pipeline

```text
grounded user intent / finding / accepted obligation
        |
        v
create Board item
        |
        v
build candidate WORK_CONTEXT_SPEC g1
  from exact root / refs / current source baseline
        |
        v
validate context contract
        |
        v
canonically bind Board -> g1
        |
        v
item becomes eligible according to ordinary Board lifecycle
```

If enough context cannot be declared safely:

```text
Board item exists
-> BLOCKED / context-required
-> no worker guesses missing context
```

## 3. Context generation pipeline

```text
current generation gN
+ transition trigger
+ current Board subject
+ exact accepted evidence/decision
+ current source baseline
        |
        v
Context Producer
        |
        v
candidate gN+1
        |
        v
deterministic validation
        |
        v
write immutable context artifact
        |
        v
canonical Board pointer update
        |
        v
gN+1 current
```

The producer may use an LLM to draft paths or summaries, but those are proposal mechanics. Missing authority or ambiguous scope remains explicit.

## 4. Fresh-session load pipeline

```text
fresh session
  -> read Blackboard
  -> select/receive one eligible item
  -> read exact currentContextRef + contextGeneration
  -> load WORK_CONTEXT_SPEC
  -> validate Board subject + generation
  -> load requiredCurrentSystemRefs
  -> load requiredInputRefs
  -> inspect declared source read/write scope
  -> only then perform the bounded action
```

Do not use prior chat as hidden context recovery.

## 5. Lazy audit pipeline

Normal execution does not load full research history.

```text
required claim disputed?
current source contradicts spec?
review requests rationale?
architecture tripwire fired?
        |
        yes
        v
load relevant auditRefs
```

Audit loading cannot expand action/write authority.

## 6. Review pipeline

```text
Board PENDING_REVIEW / review obligation
        |
        v
review WORK_CONTEXT_SPEC
  write scope = none
  exact candidate/source baseline
  reviewer authority/scope refs
        |
        v
independent evidence/decision
        |
        +--> ACCEPT
        |      -> create implementation context gN+1
        |      -> exact decisionRef becomes required input
        |
        +--> REJECT / INCONCLUSIVE
               -> create narrowed review/research context gN+1
               -> remaining finding explicit
```

The accepted review artifact is not edited into the old context.

## 7. Implementation pipeline

```text
IMPLEMENT context
  -> exact accepted decision
  -> exact source baseline
  -> exact write scope
  -> exact verification contract
        |
        v
worker claims/starts
        |
        v
load required context
        |
        v
implement
        |
        +--> current semantics changed
        |      -> reconcile docs/worktree/* before durable checkpoint
        |
        v
verify
        |
        v
optional WORK_CONTEXT_RECEIPT
        |
        v
submission / handoff / review through ordinary Board lifecycle
```

A context spec does not bypass existing review/completion policy.

## 8. Scope-discovery during implementation

A common case:

```text
implementation discovers source path X is required
X not in write scope
```

Do not silently mutate X.

Pipeline:

```text
record grounded reason
  -> propose context scope extension/new generation
  -> canonical pointer update
  -> resume under new context
```

For trivial generated-file fallout, project tooling policy can exempt non-semantic outputs. Semantic source scope must remain explicit.

## 9. Source-baseline drift

Not every upstream commit requires context regeneration.

Classify drift:

```text
unrelated source change
  -> context remains current

declared read/write seam changed materially
  -> regenerate/revalidate context

accepted decision/candidate changed
  -> old context stale

worktree docs changed because source semantics changed in relevant boundary
  -> regenerate/revalidate
```

This prevents both stale execution and needless churn.

## 10. Context narrowing

A context may become smaller after progress.

Example:

```text
g2 implementation:
  8 source paths
  5 verification checks

checkpoint completes storage layer

g3 implementation:
  remaining authority adapter only
  3 source paths
  2 verification checks
```

Narrow context instead of carrying all historical implementation detail forever.

## 11. Recovery pipeline

```text
process/session interrupted
        |
        v
read Board durable lifecycle/checkpoint
        |
        v
read current context generation
        |
        v
does existing context still describe safe continuation?
  yes -> resume exact generation/action
  no  -> create RECOVER context generation
        |
        v
resolve effect/lifecycle truth through existing authority boundaries
```

A recovery context must never claim external-effect truth merely because the prior worker stopped.

## 12. Handoff pipeline

Durable handoff should be able to answer without chat:

```text
which Board item?
which context generation?
what action was authorized?
which exact inputs were loaded?
what source revision was observed?
what changed?
what verification ran?
what remains?
```

Use a `WORK_CONTEXT_RECEIPT` only when those exact resolved identities matter.

The Board still carries lifecycle/result refs.

## 13. Context archival

Old context generations remain immutable history.

They are not copied into active Blackboard prose.

When the Board item becomes terminal:

- current context remains referenced from terminal history/commit;
- active Board may archive the item according to existing phase rules;
- worktree docs retain only current implemented facts;
- research/decision artifacts retain rationale/evidence.

## 14. Context producer specializations

The architecture should not start with one universal ContextGenerator.

Earn concrete producers from consumers.

Candidate first producers:

```text
Research/Review Context Producer
  Board item + exact research candidate + reviewer requirement

Accepted Implementation Context Producer
  Board item + accepted decision + implementationSlices[sourceChanges, verification]

Recovery Context Producer
  Board checkpoint + current context + recovery/effect truth refs
```

Only generalize after repeated semantics appear.

## 15. Relation to organizational runtime pipeline

The context pipeline ends at safe project work.

It does not replace:

```text
OrganizationWorkMaterializer
OrganizationWorkClaimController
DomainExecutionController
ExecutionPolicy
ExecutionStrategy
```

A future implementation context may instruct developers to implement those components; it is not one of those runtime components.

## 16. Minimal delivery path

Default worker load budget:

```text
1 Blackboard item
1 WORK_CONTEXT_SPEC
required current-system refs
required action refs
declared source/tests
```

No recursive graph walk by default.

## 17. Expected failure behavior

```text
missing spec            -> BLOCK / regenerate
stale generation        -> reload current
missing required ref    -> BLOCK
missing audit ref       -> continue unless explicitly needed
source scope exceeded   -> regenerate before durable mutation
review accepted         -> new generation, never mutate old review context
chat disagrees          -> durable context/Board wins
```
