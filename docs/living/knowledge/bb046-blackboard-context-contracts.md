# BB-046 — Blackboard context contracts

Status: **PROPOSED / NORMATIVE CANDIDATE**

This file defines the candidate contracts for the Blackboard Context Plane. It is intentionally separate from `docs/living/contracts.md`: nothing here is promoted current-system/documentation policy until independent review accepts the topic.

## 1. Core invariants

```text
Blackboard != Work Context
Work Context != Source Truth
Work Context != Acceptance Authority
Work Context != WorkContract
Work Context != ExecutionPlan
Context Resolver != Context Authority
Context Receipt != Correctness Evidence
Context producer != context-currentness authority
old context generation != current permission
Message / prior chat != missing context fallback
```

## 2. Logical Board binding

Every context-managed active Board item has one logical current-context binding:

```yaml
current-context:
  generation: 1
  ref: docs/living/work-context/BB-046/g0001-readiness-review.json
```

The exact physical representation is repository-specific.

For the Markdown Board, use explicit fields on the item.

A future runtime consumer may use an application-level direct field or an atomic Board-linked context-head artifact, but it must preserve:

```text
one current generation
exact ref
no ref scanning / ranking to infer currentness
Board mutation authority owns the pointer transition
```

## 3. WORK_CONTEXT_SPEC v1

A context generation is immutable.

Candidate shape:

```yaml
kind: WORK_CONTEXT_SPEC
version: 1

contextId: BB-046-context
itemId: BB-046
generation: 1
parentContextRef: null
transitionReasonRef: <root/user/review/finding/recovery ref>

project:
  rootIntentId: INTENT-exharness-agentic-system

boardSubject:
  expectedStatus: PENDING_REVIEW
  expectedOwner: null
  expectedClaimGeneration: null
  expectedReviewGeneration: null

action:
  kind: INDEPENDENT_READINESS_REVIEW
  summary: <bounded next action>
  allowedMutations: []
  forbiddenActions: []

authority:
  acceptanceAuthorityRef: <configured review authority/policy ref>
  implementationDecisionRef: null

sourceBaseline:
  repository: vhwg06/ExHarness
  revision: <exact commit>

requiredCurrentSystemRefs: []
requiredInputRefs: []
auditRefs: []

sourceScope:
  read: []
  write: []
  forbidden: []

hardInvariants: []
verification: []
expectedOutputs: []

staleWhen: []
```

Canonical `WORK_CONTEXT_SPEC` and `WORK_CONTEXT_RECEIPT` serialization is JSON. Markdown/YAML frontmatter may be used only as a derived human explanation, never as the sole current machine state.

## 4. Required vs audit inputs

Three input classes are deliberately separate.

### requiredCurrentSystemRefs

Current source-backed facts needed to understand the implementation that exists now.

Examples:

```text
docs/worktree/agentic-application/contracts.md
packages/agentic-system/src/blackboard-orchestrator.js
```

### requiredInputRefs

Exact decision/research/contract artifacts required for the current action.

Examples:

```text
accepted implementation artifact
current review target
exact trust-transition research artifact
```

### auditRefs

Useful for challenge/rationale/history but not required for normal execution.

A worker may load them when:

- a required claim is disputed;
- independent review explicitly asks for rationale;
- current evidence conflicts;
- an architecture tripwire fires.

`auditRefs` must not be silently promoted to required action semantics by the worker.

## 5. Source-scope contract

```yaml
sourceScope:
  read:
    - <known relevant paths>
  write:
    - <authorized mutation paths>
  forbidden:
    - <explicitly protected boundaries>
```

Rules:

1. `write` is permission boundary for the current context, not a promise that every path will be modified.
2. Missing write scope is not permission.
3. Discovery that another path must change triggers a new context generation or explicit scope extension before durable handoff.
4. Generated/build/cache paths may be handled by project tooling without being semantically authorized source changes.
5. `forbidden` wins over proximity or model convenience.

## 6. Action kinds

Candidate action kinds are descriptive, not a global workflow stage machine:

```text
REVIEW
IMPLEMENT
INVESTIGATE
RECOVER
VERIFY
RESEARCH
```

No fixed ordering is implied.

The field answers:

> what class of action is safe under this generation?

Example:

```text
REVIEW(g1)
  -> accepted
  -> IMPLEMENT(g2)

REVIEW(g1)
  -> rejected finding
  -> REVIEW(g2 narrowed)

IMPLEMENT(g4)
  -> crash with ambiguous effect
  -> RECOVER(g5)

INVESTIGATE(g7)
  -> no implementation justified
  -> Board remains unresolved or becomes terminal by existing lifecycle rules
```

## 7. Generation semantics

`contextGeneration` is:

- monotonic per Board item;
- advanced only when safe-next-action semantics materially change;
- independent from claim/review/execution generations.

A new generation is required for:

```text
review verdict changes allowed action
accepted decision becomes implementation input
scope materially narrows/widens
source baseline invalidates named seams
authority input changes
recovery mode changes
verification creates/removes a blocker
required input set changes materially
```

Not required for:

```text
typo cleanup
formatting
non-semantic description edits
adding an optional audit link
```

## 8. Immutable generation rule

Never mutate g0001 into g0002 semantics.

Use:

```text
work-context/BB-046/g0001-readiness-review.md
work-context/BB-046/g0002-implementation.json
```

The Board current-context pointer moves atomically at the coordination layer.

Git history remains useful audit history, but currentness must not depend on reconstructing Git history.

## 9. Staleness

A worker validates context before action and again before durable handoff/review submission when material work occurred.

Fail stale when any declared subject no longer matches, including:

```text
Board current context generation/ref
expected Board lifecycle subject
required accepted decision
source baseline / source seam
authority policy/ref
required artifact identity
```

Staleness response:

```text
stop current durable mutation path
preserve already-produced local evidence/work as uncommitted candidate
re-read Board
regenerate/reconcile context
continue only under new current generation
```

A stale context does not retroactively delete historical work.

## 10. Context producer authority

A producer can propose content. It cannot make itself current.

Allowed producers may include human or model workflows, but currentness requires canonical Board-context binding.

When the context encodes authority:

- authority refs must come from existing accepted/trusted sources;
- a context producer cannot fabricate `decisionRef`, reviewer scope or publisher authority;
- missing authority causes a blocked/review context, not an inferred permission.

## 11. Context Resolver contract

Input:

```text
exact WORK_CONTEXT_SPEC
```

Output:

```text
ResolvedContextPack {
  specRef
  generation
  resolved current-system refs
  resolved required-input refs
  source identities
  optional diagnostics
}
```

Guarantees:

- resolve only declared required refs by default;
- preserve exact provenance/identity;
- distinguish missing/unavailable/stale;
- never add hidden semantic requirements.

The resolver may support lazy `auditRefs`, but they remain explicitly requested.

## 12. WORK_CONTEXT_RECEIPT v1

Optional durable receipt:

```yaml
kind: WORK_CONTEXT_RECEIPT
version: 1

itemId: BB-046
contextRef: <exact WORK_CONTEXT_SPEC ref>
contextGeneration: 2

observedBoardSubject: <status/generation tuple>
observedSourceRevision: <exact>
resolvedInputs:
  - ref: ...
    identity: ...

producer:
  principalRef: ...

purpose: HANDOFF | REVIEW_SUBMISSION | VERIFIED_CHECKPOINT | RECOVERY
```

Receipt invariants:

```text
receipt existence != context currentness
receipt existence != source correctness
receipt existence != acceptance
receipt existence != authorization for next generation
```

A receipt is correlation/provenance only.

## 13. Context receipt retention

Do not persist a receipt for every prompt/model call.

Persist when exact loaded context matters to later reconstruction:

- review submission;
- handoff after material implementation checkpoint;
- crash recovery boundary;
- disputed verification.

This keeps delivery cost bounded.

## 14. Board / context atomicity

Logical requirement:

```text
Board currentContextRef + contextGeneration
must change as one canonical coordination mutation
```

The new context spec may be written before the Board pointer changes.

Crash model:

```text
context spec persisted
Board pointer not changed
  -> orphan historical candidate, not current

Board pointer changed
  -> exact generation becomes current
```

This is the same write-before-ref safety pattern already used elsewhere in ExHarness.

## 15. Claim interaction

For repository development, the current context should be resolved before a worker claims/starts mutating work.

For a future runtime context-managed Board:

```text
claim / execution generation
!=
context generation
```

A claim should pin the current context ref/generation it observed. If the context head changes before durable mutation, the worker must fail/reconcile rather than continue under a stale semantic subject.

The exact runtime mutation API is **not** authorized by BB-046 documentation research alone.

## 16. Review interaction

Review context must bind:

```text
exact candidate
exact source baseline
exact required refs
exact review scope/authority
zero source-write permission unless review includes remediation
```

A review PASS on g1 does not automatically convert g1 into implementation authority.

Accepted review causes a new context generation with exact decision ref.

## 17. Recovery interaction

Recovery context declares:

```text
what durable state survived?
what generation was active?
which effects/claims require reconciliation?
what action is safe now?
```

It does not use conversation memory to guess whether the prior agent "probably finished".

## 18. Compatibility rule

Before this architecture is implemented, existing Board items remain governed by current living-doc rules.

This proposal does not retroactively make historical items invalid.

If accepted, migration should be bounded to new Integration-phase items first. Generalizing every old Board item is explicitly out of scope.

## 19. Contract acceptance tests

At minimum, a future implementation/probe must show:

```text
missing current-context ref -> fail closed
wrong itemId in context -> fail closed
old generation -> fail closed
review context cannot mutate source
implementation context without accepted decision -> fail closed
write outside declared scope -> fail closed
required ref missing -> fail closed
audit ref missing -> normal path may continue when not required
orphan newer context file -> not current
Board pointer update -> fresh worker loads exact new generation
fresh session reconstructs same action without chat
```
