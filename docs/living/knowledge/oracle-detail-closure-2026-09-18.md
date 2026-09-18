# Oracle-detail closure scan — 2026-09-18

Status: **CURRENT PHASE DEBT = 0**

This note records why the Oracle-detail Board stops without creating BB-046. It is a phase-level evidence/reconciliation record, not a new work item and not a claim that Oracle can never evolve.

## Delivered in this phase

The active Oracle-detail Board delivered three source-backed items:

- **BB-043 — optional D014 artifact-manifest adapter**
  - producer-side manifest capture;
  - durable manifest store;
  - fail-closed identity/provenance/content validation;
  - fresh-reader reconstruction;
  - existing QA resolver/request/response shapes preserved.

- **BB-044 — manifest publication/recovery research**
  - executable reproduction that QA_PENDING could previously become durable before manifest publication;
  - crash-point analysis;
  - accepted ordering: producer manifest durability before protected QA_PENDING;
  - Backend/Core remains effect-recovery authority.

- **BB-045 — manifest-protected durable Backend -> QA integration**
  - exact manifest ref persisted before protected QA_PENDING;
  - fresh QA scoped to that exact manifest;
  - publication failure returns through Backend/Core recovery;
  - atomic single-publication slot under concurrent writers;
  - orphan durable publication receipt is reused before producer-byte reads;
  - receipt reuse is bound to stable Backend acceptance semantics: timestamp-only decision regeneration may reuse the original receipt, while policy/evaluator/subject/evidence/claim/verdict/metadata drift fails closed;
  - legacy manifests without the semantic digest require exact acceptance-ref equality for receipt reuse;
  - changed/missing payload after QA_PENDING remains a QA/source failure rather than Backend replay authority.

All three Board items are terminal DONE. The active Board has zero READY, CLAIMED, BLOCKED, PENDING_REVIEW, REVIEWING, PENDING_RECONCILIATION or REOPENED items.

The zero-debt scan was revalidated after BB-045 was reopened twice by post-merge evidence: first for receipt-first recovery during producer-store outage (PR #144), then for acceptance-semantic receipt reuse (PR #148). Both findings were reconciled back into BB-045 rather than manufacturing BB-046.

## Current Oracle boundary after delivery

Current source still has two concrete source-resolution classes:

```text
repository source
 -> repositoryReader
 -> resolveBackendContext(...)

application artifact source
 -> artifactReader
 -> optional manifest validation
 -> resolveQaContext(...)
```

The Agentic Application owns:

- which context is required;
- Backend -> QA lifecycle and checkpoint ordering;
- whether manifest protection is explicitly enabled;
- producer-manifest publication composition;
- acceptance/review/reconciliation authority.

Oracle owns only source resolution/dereference/adaptation. A manifest/hash remains identity/integrity evidence, not semantic correctness or completion authority.

## Why BB-046 is not created

### No common Oracle resolver trigger

The previous BB-009 re-entry condition was:

- a third real source boundary exists; or
- repeated adapter duplication creates measured common-contract pressure.

Neither condition is present in current source. Repository and application-artifact sources still have materially different identity/provenance semantics.

Therefore a generic Resolver/ContextProvider registry would be speculative abstraction.

### No structured Oracle diagnostic trigger

The previous BB-010 re-entry condition was a concrete caller that must branch programmatically across multiple resolution-failure classes while preserving required/optional semantics.

Current Backend/QA callers still treat source-resolution failure at their concrete boundaries; no current caller depends on a stable machine-readable Oracle diagnostic taxonomy.

Therefore no diagnostic hierarchy is created.

### No concrete MCP source trigger

D006 remains an accepted architecture constraint for any future concrete MCP-backed source. Current source contains no MCP client/source, persisted MCP continuation state, MRTR retry state or Tasks handle.

Protocol availability by itself is not a third source and does not authorize making Oracle MCP-first.

A future concrete MCP integration should create new Board work only when an actual application source/consumer requires it.

### No manifest-default promotion trigger

The D014 runtime slice is delivered as an explicit opt-in path. Default adoption remains evidence-gated.

Current evidence is deterministic repository/fixture evidence. The project still lacks one concrete representative production artifact store plus measured:

- lookup latency;
- hashing cost;
- storage overhead;
- outage/availability behavior;
- operational retention behavior.

Without those inputs, promoting manifest protection to a global/default path would exceed the evidence.

### No retention-actuator trigger

Current manifests carry retention policy revision, pin labels and availability metadata, but ExHarness does not own a concrete production artifact-retention actuator in current source.

Stronger Board-derived pin/release automation requires a real artifact-store retention consumer and policy surface. Metadata absence from an actuator is not sufficient reason to invent one.

## Re-entry triggers

Create new Oracle-detail work only when at least one concrete trigger exists:

1. a third real source boundary or repeated adapter duplication creates measurable common-resolver pressure;
2. a caller needs machine-readable branching across source-resolution failure classes;
3. an actual MCP-backed source/consumer must be integrated under D006;
4. a concrete artifact store exists and runtime-default manifest adoption can be evaluated with representative latency/cost/availability/retention evidence;
5. a real retention actuator must consume Board/project lifecycle pins;
6. explicit user intent introduces another concrete Oracle source or correctness problem.

## Phase handoff

The terminal Oracle-detail Board is preserved at `../history/blackboard-oracle-detail-2026-09-18.md`. Its stable current-system results are projected into `docs/worktree/oracle/*`, `docs/worktree/agentic-application/*` and the top-level worktree state/pipeline.

The next coordination phase is `INTEGRATION`. It begins with no fabricated backlog: BB-046 remains unallocated until a concrete component seam, contract failure, recovery gap, end-to-end verification gap or explicit user integration objective creates grounded work. Oracle-specific re-entry still obeys the triggers above, so integration pressure does not by itself authorize a generic resolver/provider framework.

## Coordination state

```text
phase: ORACLE_DETAIL
terminal-items: 3
done: 3
non-terminal: 0
next-work-id: BB-046
new-work-created-by-this-scan: 0
latest-bb045-remediation: PR #148 / merge 4db3457418836ec7a305f388d20626ddeea41abb
```

The Board remains the active coordination surface. BB-046 is reserved, not allocated. Future sessions must not manufacture work from the existence of an unused id.
