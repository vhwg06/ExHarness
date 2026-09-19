# BB-046 — Blackboard context architecture

Status: **PROPOSED / AWAITING INDEPENDENT REVIEW**

## Executive summary

The repository Blackboard deliberately stays small and operational. That is good for lifecycle clarity, but the current fresh-session rule still leaves one high-risk step to the model:

```text
Blackboard
  -> choose work
  -> "load the smallest relevant current-state docs"
  -> infer source scope / authority / acceptance / next action
```

For simple work this is cheap. For Integration-phase work such as organizational authority, crash recovery and trust transitions, the phrase **smallest relevant** is itself an architectural decision. A fresh model can load the right Board item and still infer the wrong implementation context.

BB-046 therefore proposes a bounded **Blackboard Context Plane** around the existing Board:

```text
                        PROJECT / ORGANIZATION TRUTH

User intent
    |
    v
Blackboard Work Item
  lifecycle / deps / blockers / review
  currentContextRef + contextGeneration
    |
    v
immutable WORK_CONTEXT_SPEC
  exact safe-next-action declaration
    |
    +---- required current-system refs
    +---- required accepted/input refs
    +---- explicit source read/write scope
    +---- authority / invariants / verification
    +---- stale-when conditions
    |
    v
Context Resolver
    |
    v
Resolved Context Pack
  ephemeral worker/model input
    |
    v
work / review / recovery / verification
    |
    +---- source/tests/current worktree truth
    |
    +---- optional WORK_CONTEXT_RECEIPT at durable boundary
```

The Board remains lifecycle authority. Context artifacts do **not** decide correctness, completion, scheduling or acceptance.

## Problem definition

Current living-doc policy correctly says:

- Blackboard is shared operational state, not an actor or correctness authority;
- actual work products stay outside the Board and are referenced;
- fresh sessions recover through Board + referenced artifacts;
- worktree docs contain current source-backed truth only.

The unresolved pressure is **selection of context after work selection**.

Current pipeline text says a worker loads the "smallest relevant worktree current-state docs". That is intentionally lightweight, but it requires the worker to infer:

```text
which current-system docs are mandatory?
which research/decision refs are actually inputs?
which refs are only audit history?
which source files are safe to mutate?
which files are explicitly out of scope?
which authority is active?
what exact decision authorized implementation?
what invariants are hard reject conditions?
what verification proves this particular slice?
what change makes the previously loaded context stale?
```

The risk is not only missing information. Over-loading is also harmful: a model can treat historical research, rejected alternatives, current implementation facts and desired architecture as equally actionable.

## Evidence from current ExHarness

Current source already contains several bounded-context patterns rather than one universal context:

- Backend and QA have different declared context requirements and different Oracle source boundaries.
- PM and SA coordination already uses separate bounded context projections.
- Session handoff exposes lifecycle and refs but does not prescribe one universal worker context.
- BB-028 demonstrated that a bounded orientation surface can reduce context volume, while correctness still requires exact underlying refs.

This proposal generalizes only the **project-work context declaration boundary**, not domain semantics, execution strategy or correctness authority.

## Goals

```text
G1  fresh worker can determine safe next action without chat reinterpretation
G2  required inputs are explicit; audit/history is lazy
G3  source read/write scope is explicit before mutation
G4  authority and acceptance inputs are explicit
G5  context has durable generation/currentness semantics
G6  crash/session reconstruction does not depend on model memory
G7  context is small enough to improve delivery rather than create another bureaucracy
G8  source/worktree/evidence remain truth; context never launders copied summaries into truth
G9  design composes with BB-046 organizational integration without becoming runtime scheduler
```

## Non-goals

This proposal does not introduce:

```text
a second Blackboard
a global context database
a generic role registry
a workflow DSL
a scheduler
a correctness oracle
automatic architecture acceptance
a requirement to persist every resolved prompt/context payload
a requirement to make Oracle own project-work context selection
a requirement to put runtime domain/pipeline fields into generic Board state
```

## Core artifact taxonomy

### 1. Blackboard Work Item

Owns operational lifecycle:

```text
id
status
owner / generation when claimed
dependencies
remaining work
checkpoint/submission/review/blocker state
artifact/evidence refs
origin
currentContextRef
contextGeneration
```

The last two fields are a **logical contract** of this proposal: the Board must directly identify the one current context generation. For the repository Markdown Board they can be explicit fields. A future runtime consumer may implement the same logical binding differently, but it must not require scanning arbitrary refs to guess current context.

### 2. WORK_CONTEXT_SPEC

Immutable, item-scoped declaration of what is safe to do **now**.

Canonical repository representation is JSON. This keeps current context machine-checkable and avoids introducing a permissive Markdown/frontmatter parser as a hidden authority boundary. Human-readable Markdown may explain the architecture but is not canonical context state.

It contains refs and scope, not copied source payloads.

Typical content:

```text
Board subject
safe action kind
authority / allowed mutations
required current-system refs
required decision/input refs
lazy audit refs
source baseline
source read/write/forbidden scope
hard invariants
verification contract
expected outputs
staleness triggers
parent context generation + transition reason
```

### 3. Resolved Context Pack

Ephemeral result of resolving one exact `WORK_CONTEXT_SPEC`.

It may contain:

- loaded current-system docs;
- accepted decision/research artifacts required by the spec;
- selected source/test excerpts;
- exact identities/digests used by the resolver.

It is **not persisted by default** and is not an authority artifact.

### 4. WORK_CONTEXT_RECEIPT

Optional durable provenance emitted only at a meaningful boundary such as:

```text
handoff
review submission
verified implementation checkpoint
recovery checkpoint where exact loaded inputs matter
```

A receipt records the exact context generation and observed input identities used. It does not make those inputs correct and cannot authorize the next action.

### 5. Context generation

`contextGeneration` is item-local and monotonic.

It is distinct from:

```text
claimGeneration
reviewGeneration
ExecutionAttempt generation
source revision
policy generation
```

It means only:

> which immutable context spec defines the current safe next action for this Board item?

## Why generation is necessary

Without generation, a mutable context file recreates the same stale-worker problem the Board already solved with claim/review fencing.

Example:

```text
g1 = REVIEW candidate v7

independent review accepts exact candidate

safe next action changes to implementation

g2 = IMPLEMENT accepted slice only
     exact decision ref
     current source baseline
     exact write set
     exact verification
```

A worker holding g1 may not treat the acceptance event as permission to mutate source. It must reload g2.

The generation idea is similar in spirit to systems that distinguish desired generation from the state a controller actually observed; the point is not to copy Kubernetes API machinery, but to make staleness explicit rather than conversational.

## Context currentness authority

Selected invariant:

```text
artifact existence
!=
current context
```

A `WORK_CONTEXT_SPEC` becomes the current context only when the Blackboard canonically points to its exact ref + generation.

Therefore:

```text
orphan context spec
  -> inert

old context generation
  -> historical input, never current permission

Board pointer changes
  -> prior workers must re-resolve before durable mutation/handoff
```

This mirrors an existing ExHarness principle: orphan artifacts do not become lifecycle truth merely because they exist.

## Context production boundary

A context producer may be:

- a deterministic application adapter;
- a human;
- PM/SA/domain policy where that authority exists;
- an LLM producing a candidate.

But **the producer does not self-authorize currentness**.

Generation flow:

```text
current Board item
+ exact transition reason/evidence/decision
+ current source baseline
        |
        v
candidate WORK_CONTEXT_SPEC
        |
        v
deterministic schema / ref / scope validation
        |
        v
canonical Board context-head update
        |
        v
new current context generation
```

For an implementation handoff derived from an accepted `IntegrationImplementationArtifact`, the generator should copy exact accepted slice/source/verification semantics rather than re-infer them.

## Loading boundary

Normal work should not start by recursively reading every artifact ref.

Default load:

```text
Blackboard item
+ exact current WORK_CONTEXT_SPEC
+ requiredCurrentSystemRefs
+ requiredInputRefs
+ declared source/tests
```

Lazy load only when needed:

```text
auditRefs
rejected alternatives
historical evidence
full research narrative
unrelated worktree branches
```

This is the main delivery optimization.

## Authority matrix

| Surface | Owns | Explicitly does not own |
| --- | --- | --- |
| Blackboard | work lifecycle, dependencies, blockers, current context pointer | correctness, source semantics, model prompt |
| Work Context Spec | exact bounded input/action declaration for one generation | Board lifecycle, acceptance verdict, source truth |
| Context Resolver | deterministic resolution of declared refs/sources | deciding which refs should have been declared |
| Resolved Context Pack | ephemeral worker input | durable truth/currentness |
| Context Receipt | provenance of what was resolved at a durable boundary | correctness or next-action authorization |
| worktree/source/tests | current implemented behavior | open-work lifecycle |
| evidence/decision/review | epistemic/acceptance authority according to existing contracts | work scheduling |
| Organization WorkContract | runtime domain workload semantics | repository-development context selection |
| ExecutionPolicy/Strategy | HOW a released domain workload executes | project-work context authority |

## Relation to BB-046 organizational architecture

Do not collapse these concepts:

```text
Repository Work Context
  = what a developer/reviewer agent needs to safely work on a Board item

ORGANIZATION_WORK_CONTRACT
  = durable runtime meaning of one organizational workload

ExecutionPolicy / ExecutionStrategy
  = HOW a released runtime workload executes
```

The context plane can carry refs to an accepted organizational implementation artifact, but it must not become the organizational scheduler or execution runtime.

## Relation to SessionHandoff

`SessionHandoffSurface` remains valuable because it reconstructs durable project/lifecycle/ref state.

Selected relation:

```text
Session handoff
  = what durable project state exists?

Work Context Spec
  = what exact subset/action is safe for this item now?

Context Resolver
  = resolve those declared inputs
```

The context plane does not replace session handoff.

## Relation to Oracle

Application/project semantics decide **what context is required**.

Oracle may resolve declared external/internal source inputs where the concrete consumer already uses Oracle, but Oracle does not decide project-work scope or generate implementation authority.

```text
Work Context Spec: WHAT must be loaded
Oracle/source adapters: WHERE/HOW declared source is resolved
```

## Source-scope rules

A context spec declares three sets:

```text
read
write
forbiddenWrite
```

Write scope is a guardrail, not an exhaustive prediction of every mechanically touched file. If implementation proves another source path is semantically required, the context must be regenerated or explicitly widened before durable mutation is represented as valid.

This avoids the model silently treating proximity as authority.

The idea is consistent with a broader engineering pattern: hermetic/reproducible actions become easier to reason about when inputs and tool/source identity are explicit, and supply-chain layouts become verifiable when authorized materials/products are declared. ExHarness does not adopt Bazel or in-toto as dependencies; they are calibration examples for explicit-input and authorized-scope design.

## Freshness model

A context becomes stale when a declared subject changes materially.

Minimum triggers:

```text
Board item no longer matches expected lifecycle subject
Board currentContextRef/contextGeneration changed
source baseline invalidates named source seams
required decision/authorization ref changed or was superseded
required current-system fact changed materially
review result changes the safe next action
recovery changes what continuation is safe
verification creates a grounded blocker
```

A stale context is not automatically wrong history. It is simply not current permission/input for new durable work.

## Context change is not global restart

Generation is local to one Board item.

A context update must not imply:

```text
restart whole project
invalidate unrelated Board items
reload all project docs
re-run unaffected domain work
```

This preserves the same local-remediation principle as the organizational architecture.

## Durability / receipt policy

Persisting every resolved model context would be expensive and would create a new retention problem.

Selected default:

```text
WORK_CONTEXT_SPEC      durable
Board current pointer durable
Resolved Context Pack ephemeral by default
WORK_CONTEXT_RECEIPT   durable only at review/handoff/verified checkpoint when useful
```

A receipt should store refs/digests/identities, not copied full payload bodies.

## Failure semantics

Fail closed when:

```text
current context pointer missing
context generation mismatched
context subject does not match Board item
required ref unavailable
required accepted decision missing
source baseline materially drifted
write target outside declared scope
hard invariant would need reinterpretation
context producer tries to grant its own authority
```

The remedy is a new context generation or Board transition, not chat reconstruction.

## Rejected alternatives

### Put all context directly in Blackboard

Rejected:

- Board becomes architecture/prompt document;
- active surface grows with source detail;
- history/context payload pollutes lifecycle;
- context updates become lifecycle noise.

### Keep Board unchanged and let model infer context

Rejected for Integration-phase work because the inference is precisely the risk being addressed.

### One mutable work-context file

Rejected because a stale worker cannot prove which version defined its action. Use immutable generations and an exact current pointer.

### Persist every resolved prompt/context body

Rejected by default because it creates cost, privacy/retention and authority confusion. Persist refs/receipts only when the durable boundary benefits.

### Make Oracle choose project context

Rejected because Oracle resolves declared sources; it does not own application/project work semantics.

### Make Work Context equal WorkContract

Rejected because repository-delivery context and runtime organizational workload semantics have different subjects and authorities.

## Proposed repository shape

```text
docs/living/
  blackboard.md

  work-context/
    README.md
    BB-046/
      g0001-readiness-review.json
      # g0002-implementation.json only after exact acceptance

  knowledge/
    bb046-blackboard-context-architecture.md
    bb046-blackboard-context-contracts.md
    bb046-blackboard-context-pipelines.md
    bb046-blackboard-context-evaluation.md
    bb046-blackboard-context-implementation-readiness.md

    bb046-organizational-integration-implementation-artifact-readiness-v7.md
    bb046-trust-transition-research-v7.md
    bb046-execution-strategy-rebase-research-v6.md
    integration-phase-research-to-implementation-readiness-v7.md
```

The folder is not a second queue. Only the Board identifies which context generation is current.

## Delivery path

This topic should be delivered in two different steps.

### Step 1 — documentation/research acceptance

This MR:

- allocates BB-046;
- adds the architecture/contracts/pipelines/evaluation artifacts;
- adds one concrete machine-readable **review-only** g0001 JSON context example;
- imports the organizational integration v7 evidence;
- changes no runtime/source semantics.

### Step 2 — implementation after acceptance

Only after an adequate independent decision accepts the architecture:

- generate the next exact context generation;
- implement the smallest accepted context-plane slice;
- update current-system worktree docs in the same change;
- benchmark the explicit-context path against the current heuristic-loading baseline.

## External calibration

These are design calibrations, not dependencies:

- Kubernetes generation/observed-generation semantics make controller staleness explicit: https://kubernetes.io/docs/concepts/workloads/pods/
- Kubernetes controllers separate desired state from controller observation: https://kubernetes.io/docs/concepts/architecture/controller/
- Bazel hermeticity emphasizes explicit source/tool identity for reproducibility: https://bazel.build/concepts/hermeticity
- in-toto layouts separate authorized steps/materials/products from the evidence that a step ran: https://in-toto.io/docs/getting-started/


## Immutable review-target binding

Independent review must bind an immutable semantic subject. A pull-request number or phrase such as "exact PR head at review dispatch" is not a subject identity because the PR ref can move after review begins.

The selected repository pattern is a **detached review target**:

```text
semantic candidate commit Cn
  contains architecture/contracts/pipelines/evaluation/readiness candidate

next context-envelope commit
  contains immutable WORK_CONTEXT_SPEC gN
  reviewTarget.candidateHeadSha = Cn
  Board pointer -> gN
```

The context generation does not attempt to contain the hash of its own commit. Instead it binds the preceding immutable semantic candidate commit.

A current review context MUST include:

```text
repository
pullRequest (navigation only)
candidateHeadSha (authority-bearing semantic subject)
allowedPostTargetEnvelopePaths
```

For BB-046 the only allowed post-target envelope changes are the exact Board current-context binding and the new immutable context-generation file. If any architecture, contract, pipeline, evaluation, implementation-readiness, organizational-integration or source file changes after `candidateHeadSha`, the review context is stale and a new REVIEW generation is required.

The independent review decision must bind both:

```text
subjectContextRef
subjectCandidateHeadSha
verdict
```

Transition to implementation is valid only when:

```text
decision.subjectContextRef == current review context
decision.subjectCandidateHeadSha == reviewTarget.candidateHeadSha
decision.verdict == ACCEPT
```

This makes review/currentness obey the same principle as the rest of the architecture:

```text
mutable PR ref != accepted semantic subject
```

## Decision status

The architecture is **not promoted** by this document.

The candidate asks independent review to decide whether ExHarness should introduce this bounded Blackboard Context Plane and, if accepted, which first implementation slice is justified.
