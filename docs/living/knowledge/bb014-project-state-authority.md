# BB-014 — Project-state authority research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

Are the repository Markdown Blackboard and the JSON-backed Agentic Application Blackboard two competing canonical stores for the same project, and what is the smallest state-authority contract that preserves fresh-session handoff without creating dual writers?

## Observed current state

### Repository development project

`docs/living/blackboard.md` is the canonical repository coordination projection used by ExHarness development sessions today. It carries the ExHarness user-intent root, historical/open work, dependencies, review requirements and artifact/evidence refs through Git commits.

Its shape includes repository-planning metadata such as `kind`, `priority`, research/implementation pairings and prose around the work items. It is not parsed or mutated by `ApplicationOrchestrator` in current source.

### Runtime consumer project primitive

`createJsonBlackboardStore({ path })` persists a validated `version: 1` Blackboard snapshot to a caller-selected local filesystem path. Mutation is serialized by a local `.lock` file and temp-file rename.

`createSessionHandoffSurface(...)` reads exactly the Blackboard supplied to its Orchestrator. A handoff-safe snapshot requires exactly one durable `USER_INTENT_ROOT`; work must trace to that root. The handoff surface does not inspect repository Markdown.

Repository usage search shows current in-repository JSON-store instantiations in tests/evaluation with temporary `blackboard.json` paths. The API is caller-configurable, but current repository evidence does not establish an external production consumer. No current repository entrypoint binds `docs/living/blackboard.md` and a JSON store as two writers of the same ExHarness project.

### Missing identity/concurrency semantics

The JSON snapshot contains schema `version` and `items`, but no explicit stable project identifier or mutation revision. The store path is external configuration rather than Board identity.

The local lock protects competing writers that share one filesystem path. It does not establish cross-machine/Git optimistic concurrency and it cannot detect that a caller accidentally opened a Board belonging to a different project.

The repository Markdown Board has Git commit identity, but no runtime linkage to a JSON snapshot revision.

## Concrete observed drift

PR #78 supplied a useful observation without proving JSON/Markdown dual authority: after the evaluation PR merged, the repository Markdown Board still said BB-022 was `PENDING_REVIEW` and required a separate reconciliation step.

That is **repository projection/lifecycle lag**, not evidence that a JSON Board disagreed with the Markdown Board. No same-project JSON Board was involved in that workflow.

The distinction matters:

```text
manual repository projection lag
!=
two canonical writers for one project
```

## Options

### A. Explicit separate project boundaries now

Treat each Blackboard store as canonical only for one explicitly identified project instance.

```text
ExHarness repository-development project
  -> canonical coordination state: docs/living/blackboard.md

runtime consumer project X
  -> canonical lifecycle state: its configured JSON Blackboard store
```

No synchronization is attempted between unrelated projects. A session must know/verify the expected project identity before accepting a handoff.

Benefits:
- matches current implementation and usage;
- no migration or invented projection engine;
- prevents ambiguous language from turning different projects into accidental mirrors;
- creates the minimum prerequisite for later self-hosting.

Cost:
- ExHarness repository development is not yet dogfooding the runtime JSON Board as its own canonical lifecycle store;
- Markdown lifecycle reconciliation remains manual until a separate accepted improvement addresses it.

### B. JSON canonical state + generated Markdown projection for the same project

For a future self-hosted project, one machine-readable Board becomes canonical and Markdown is generated/read-only.

Required before this is safe:
- stable project identity;
- mutation revision/digest or equivalent CAS semantics;
- deterministic projection with source revision embedded;
- one-time migration preserving IDs, intent provenance, dependencies, checkpoints, submissions, reviews and refs;
- stale projection detection;
- no manual writes to the generated projection.

This is a plausible future convergence model but is not current source-backed behavior.

### C. Markdown canonical state + parse it as runtime Board

This would avoid an additional stored representation, but the current Markdown surface contains planning metadata, prose and historical shorthand that do not match the runtime snapshot schema or transaction model.

Making the runtime depend on a permissive Markdown parser would add parsing/migration ambiguity and still would not provide transactional project identity/concurrency semantics. Current evidence does not justify it.

### D. Dual writable Markdown + JSON synchronization

Reject. Bidirectional synchronization creates conflict/ordering authority questions and makes projection disagreement a normal state. It violates the one-canonical-state objective.

## Judgment

The current system does **not** establish two competing canonical Boards for one project. It establishes two Blackboard mechanisms currently used for different project boundaries, but that distinction is not explicit enough in executable handoff identity.

The smallest justified next step is therefore **explicit project identity and fail-closed project matching**, not immediate Markdown↔JSON migration.

For the current ExHarness repository-development project:

```text
canonical repository coordination state
= docs/living/blackboard.md
```

For each runtime consumer project:

```text
canonical executable lifecycle state
= one explicitly identified Blackboard store
```

A runtime handoff must include/verify the project identity so opening the wrong Board cannot silently look like a valid continuation.

## Implementation pressure for BB-015

The next implementation slice should stay concrete:

1. add stable project identity to handoff-safe JSON Blackboard state;
2. require `createSessionHandoffSurface(...).initialize(...)` to establish that identity;
3. require fresh-session reads to expose and, when an expected identity is supplied, verify it fail-closed;
4. preserve existing user-intent/work/checkpoint/review/artifact semantics;
5. keep legacy low-level Boards possible only when explicitly outside the handoff-safe path;
6. update current docs/tests in the same change under D007.

Do **not** implement Markdown↔JSON synchronization or a generic project-state registry in this slice.

## Reopen pressure for convergence

Reconsider JSON-canonical + generated Markdown only when ExHarness repository development itself is concretely moved behind `ApplicationOrchestrator`, or another real project needs both machine execution and a repository-readable projection of the same canonical Board.

At that point the design must add stale-write/projection revision handling before two sessions can publish the same project state safely.
