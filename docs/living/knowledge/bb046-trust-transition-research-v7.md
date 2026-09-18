# BB-046 — Trust Transition Research Loop v7

Status: **RESEARCH RESULT / CANDIDATE DESIGN EVIDENCE**

Scope: close the trust-transition questions between a Board claim and domain execution without changing the accepted ExecutionPolicy / ExecutionStrategy architecture.

This record does **not** authorize A.1 implementation by itself.

---

## 1. Research question

After v5, the architecture had a clean post-claim execution model:

```text
released authorized claim
  -> DomainExecutionController
  -> ExecutionPolicy
  -> ExecutionStrategy
  -> ExecutionAttemptBinding
```

Fresh reviews progressively exposed three A.1 trust-transition mechanisms and one B-level ownership question:

```text
A.1:
1. how is CURRENT ExecutionAuthorityPolicy represented durably?
2. what exactly is a durable releasedClaimReceipt?
3. when authority becomes invalid, what canonical Blackboard lifecycle transition releases/blocks the claim?

B:
4. who owns semantic executionAttemptId creation across crash/recovery?
```

The v7 loop focuses on item 3. It re-inspects current ExHarness lifecycle primitives rather than treating `fence`, `block` and `recover` as interchangeable words, then challenges the selected transition with crash/race schedules.

---

## 2. Source-backed constraints from current ExHarness

### S1 — generation fencing is already a core application pattern

Current Blackboard lifecycle uses monotonic `claimGeneration`; review lifecycle uses monotonic `reviewGeneration`. Stale generations cannot commit after takeover/reschedule.

Implication:

> authorization currentness should use the same explicit generation/head style instead of ambient mutable config.

### S2 — Board `CLAIMED` is lifecycle ownership, not external-effect truth

Current interrupted-work semantics explicitly separate Board generation fencing from Core/effect recovery. `recoverClaim(...)` may advance claim generation while the application still has to reconcile prior external effect/session truth.

Implication:

```text
claimGeneration != semantic executionAttemptId
```

and

```text
Board CLAIMED != executable capability
```

### S3 — canonical ref + established durable effect is already used as a commit-receipt pattern

Current coordination/publication semantics reject orphan/spoofed refs; a ref is continuation-relevant only when canonical durable state establishes the effect it represents.

Implication:

> a claim-release artifact by itself is not enough; a durable release head must establish that this exact claim generation crossed the trust boundary.

### S4 — current review trust already verifies authority outside artifact prose

`reviewTrust.verifyEvaluatorAuthority(...)`, evidence authority checks and trust-policy evaluation demonstrate the correct architectural shape: identity/authority is verified by an injected trust boundary before canonical mutation.

Implication:

```text
issuedByAuthorityRef != authority proof
```

The new authorization artifacts must not trust a caller merely because it writes an authority-looking ref into the payload.

### S5 — current lifecycle primitives prove `recover`, `block`, and revocation are different transitions

Current source semantics:

```text
recoverClaim(...)
  requires CLAIMED
  increments claimGeneration
  keeps status CLAIMED
  assigns owner for takeover/recovery

block(...)
  requires exact CLAIMED owner + generation
  clears owner
  moves status to BLOCKED

claim(...)
  accepts READY/REOPENED
  increments claimGeneration
```

Therefore none of the existing words can be used loosely for authority revocation:

```text
recover != revoke
block != always-correct revoke
ClaimReleaseHead fence != Board lifecycle transition
```

A new narrow transition is justified by a concrete consumer and does not generalize Blackboard into an IAM engine.

---

## 3. External cross-check

OpenFGA authorization models are immutable/versioned and its production guidance recommends pinning an exact authorization model ID rather than accidentally evaluating against an unspecified/latest model. This supports separating immutable policy identity from application currentness.

Google Zanzibar likewise treats authorization consistency under concurrent relationship/object changes as a first-class problem.

These are evidence for the **version/currentness distinction**, not dependencies selected for ExHarness. V6 keeps a narrow application-local head rather than introducing a generic IAM service.

References:

- https://openfga.dev/docs/getting-started/immutable-models
- https://openfga.dev/docs/interacting/consistency
- https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/

---

## 4. Decision A — durable ExecutionAuthorityPolicy currentness

### Selected

Immutable policy payload plus a CAS-fenced durable head:

```text
EXECUTION_AUTHORITY_POLICY
  policyId
  generation
  projectId
  bindings(principal -> authorizedDomains)
  status
  verified publisher provenance

ExecutionAuthorityPolicyHeadStore
  policyId -> { generation, status, policyRef }
```

Mutation:

```text
resolve current head N
  -> trusted authority publishes immutable policy N+1
  -> compareAndSetHead(policyId, expected=N, next=N+1)
```

Claim/release binds exact:

```text
policyId
policyRef
generation
```

Old policy refs remain history but are not current authority after head advance.

### Rejected

```text
"current policy" = process config object
```

Reason: fresh-process reconstruction, membership revocation and claim-vs-policy races become undefined.

### Rejected

```text
caller submits authorityPolicyRevision / issuedByAuthorityRef
store trusts the fields
```

Reason: this recreates the original self-asserted `requestedDomain` vulnerability one layer higher.

---

## 5. Decision B — durable claim-release capability

### Selected

A claim has two states at different boundaries:

```text
Board CLAIMED
  = lifecycle ownership only

Board CLAIMED
+ current ClaimReleaseHead for exact claimGeneration
+ fresh authority-head revalidation
  = eligible to enter domain execution
```

Immutable receipt:

```text
CLAIM_RELEASE_RECEIPT
  project/root
  itemId
  claimGeneration
  trusted principalRef
  derived Board owner
  exact workContractRef
  materializationAuthorization ref+generation
  ExecutionAuthorityPolicy ref+generation
```

Durable release currentness:

```text
claimReleaseSubjectKey = H(projectId, itemId, claimGeneration)

ClaimReleaseHead(subject)
  -> { RELEASED | FENCED, receiptRef }
```

The receipt payload can be persisted before the release head. Until the head commits, it is an orphan artifact and grants no execution capability.

### Claim handshake

```text
trusted principal
  -> read CURRENT execution-authority policy head
  -> read CURRENT materialization-authorization head
  -> authorize exact work contract
  -> Board claim => provisional claimGeneration N
  -> recheck Board + authority heads
  -> construct immutable receipt for N
  -> CAS release head ABSENT -> RELEASED(receiptRef)
  -> final recheck Board + authority heads
  -> return receipt only if still fresh
```

Execution entry repeats freshness checks; release is not a bearer token that remains valid after revocation.

### Recovery / invalidation rule

`ClaimReleaseHead.FENCED` is **not** a Blackboard lifecycle transition. It only removes execution capability for one exact claim subject.

Current source shows why generic `recoverClaim(...)` is not the right revocation primitive: it requires the item to remain `CLAIMED`, advances `claimGeneration`, and assigns an owner for takeover/recovery. That is useful for interrupted-work continuation, but authority revocation means the current ownership itself is no longer valid.

Therefore A.1 requires one separate canonical transition:

```text
invalidateOrganizationClaim({
  itemId,
  expectedOwner,
  expectedClaimGeneration,
  invalidationRef,
  invalidationKind
})
```

Deterministic mapping:

```text
EXECUTION_AUTHORITY_INVALIDATED
ABANDONED_PROVISIONAL_CLAIM
  -> Board CLAIMED(N) -> REOPENED
  -> owner = null
  -> invalidationRef linked atomically

WORK_AUTHORIZATION_INVALIDATED
  -> Board CLAIMED(N) -> BLOCKED
  -> owner = null
  -> exact authorization blocker + invalidationRef linked atomically
```

`claimGeneration` remains `N` in the invalidation commit. A later ordinary claim from `REOPENED` advances it to `N+1`, preserving the current meaning that an actual claim/takeover advances the generation rather than inventing an extra claim generation merely to release ownership.

Canonical ordering:

```text
1. Blackboard invalidation transaction commits first.
2. ClaimReleaseHead(N) is fenced second, idempotently.
```

This order is critical. Once Board status is no longer `CLAIMED`, the old release receipt fails execution-entry validation even if its release head has not yet been fenced. A crash between the two durable surfaces is therefore safe and recoverable.

---

## 6. Decision C — canonical authority revocation has one Blackboard lifecycle consequence

### Source observation

Current Blackboard primitives have different meanings:

```text
recoverClaim(...)
  -> CLAIMED stays CLAIMED
  -> claimGeneration advances
  -> owner is assigned for takeover/recovery

block(...)
  -> requires exact current owner + generation
  -> clears owner
  -> moves to BLOCKED

ordinary claim(...)
  -> only READY/REOPENED work is claimable
  -> increments claimGeneration
```

None of these is a correct generic alias for organization-claim revocation.

### Selected transition

Add a narrow application mutation:

```text
invalidateOrganizationClaim(
  exact current claim tuple,
  immutable CLAIM_AUTHORITY_INVALIDATION ref,
  typed invalidation cause
)
```

The immutable invalidation artifact binds:

```text
project/root
itemId
expectedOwner
expectedClaimGeneration
cause
observed materialization-authorization head
observed execution-authority-policy head
optional releasedClaimReceiptRef
authority/evidence refs
```

The Orchestrator transaction does only lifecycle work:

```text
assert exact CLAIMED owner/generation
attach invalidationRef
clear owner
derive next lifecycle state from the typed cause
commit atomically
```

It does not decide who claims next.

### Why `REOPENED` vs `BLOCKED`

```text
execution-principal/policy authority lost
  -> work semantics are still valid
  -> REOPENED
  -> another currently authorized principal may claim later

materialization/work authorization lost
  -> the work itself no longer has current execution authorization
  -> BLOCKED
  -> replacement authorization/materialization is a separate explicit action
```

This distinction prevents executor revocation from unnecessarily killing valid work while also preventing revoked work authorization from being re-claimed by another principal.

Invalidation is deliberately monotonic for safety. If policy generation `p8` revokes a principal, invalidation begins, and `p9` later re-authorizes it before cleanup completes, the old claim is still not resurrected. A new ordinary claim/release against `p9` is required. This trades a bounded extra re-claim for simpler fail-closed cross-store semantics.

### Idempotency and races

Same `invalidationRef` replay is idempotent. A different invalidation against a stale `{owner, claimGeneration}` fails closed.

Concurrent schedules:

```text
invalidation wins first
  -> item leaves CLAIMED
  -> recover/takeover loses because status/tuple changed

recover/takeover wins first
  -> claimGeneration/current owner changes
  -> old invalidation loses exact-tuple check
  -> controller re-resolves current authority
  -> if new current claim is invalid, issue/reuse invalidation for that exact subject

new claimant
  -> cannot claim until Board is REOPENED
  -> after REOPENED, ordinary claim creates later generation
  -> old release receipt cannot match current Board tuple
```

No release-head operation is allowed to substitute for this Board transition.


---

## 7. Decision D — authority publisher verification

Both materialization grants and execution-authority policies require a trusted publisher boundary.

Selected shape:

```text
organizationAuthority.verifyMaterializationAuthorizationIssuer(...)
organizationAuthority.verifyExecutionAuthorityPolicyPublisher(...)
  -> derive canonical authority principal/ref
  -> persist immutable artifact
  -> CAS current head
```

This deliberately mirrors the existing review-trust pattern.

Worker/domain execution principals do not gain publisher authority merely because they can name an `issuedByAuthorityRef`.

---

## 8. Decision E — semantic execution-attempt ownership belongs above strategy adapters

This is a **B precondition**, not an A.1 requirement.

Selected contract:

```text
ExecutionAttemptHead(workId)
  -> { attemptOrdinal, executionAttemptId, status, bindingRef, transitionRef }
```

Transitions:

```text
ABSENT + released claim
  -> CAS create attempt 1

ACTIVE / RECOVERY_REQUIRED
  -> process restart / owner takeover / recoverClaim
  -> SAME executionAttemptId + SAME ExecutionAttemptBinding

TERMINAL_REMEDIATION_REQUIRED
+ exact remediation/lifecycle decision
  -> CAS advance attempt head
  -> NEW executionAttemptId
  -> resolve current ExecutionPolicy again
```

`claimGeneration` fences Board writers; it does not define a new semantic attempt.

Strategy adapters receive `executionAttemptId`. They cannot mint one.

---

## 9. Adversarial schedules

### A — stale policy replay

```text
p7: BA principal allowed
policy head -> p8: BA principal removed
caller presents cached p7
=> reject; p7 is historical, not current authority
```

### B — policy publisher spoof

```text
BA worker submits policy payload:
  issuedByAuthorityRef: root-authority
=> reject before persistence/head CAS because publisher authority is not verified
```

### C — crash before claim release

```text
Board claim commits generation 4
process dies before ClaimReleaseHead commit
=> fresh process sees CLAIMED but non-executable work
```

### D — crash before release, authority still valid

```text
Board claim generation 4 owner=principal://ba-01
process dies before ClaimReleaseHead

fresh process:
  durable Board owner resolves to canonical principal
  current work/materialization/policy authority still valid
  reconcileOrganizationClaimAuthority completes release for SAME generation 4
  no new claim/takeover is invented
```

### E — crash after release commit

```text
ClaimReleaseHead generation-4 -> receipt R4
process dies before controller returns
=> fresh process reconstructs R4 and revalidates current heads
```

### F — policy/grant changes after release

```text
R4 released under auth generation 2 / policy generation 7
authority head advances
=> execution-entry rejects R4
=> create CLAIM_AUTHORITY_INVALIDATION for exact Board claim
=> Board lifecycle invalidation commits first
=> old ClaimReleaseHead is fenced second
=> no strategy invocation
```

### G — crash after Board invalidation but before release-head fence

```text
Board CLAIMED generation 4
R4 RELEASED
policy revokes principal
Board transaction -> REOPENED + owner cleared + invalidationRef
process crashes before ClaimReleaseHead fence

fresh process:
  Board is already non-executable
  old R4 cannot pass exact Board CLAIMED tuple check
  fence old release head idempotently
  another authorized principal may claim -> generation 5
```

### H — crash before Board invalidation

```text
policy/grant drift detected
process dies before invalidation transaction

fresh process:
  Board may still be CLAIMED
  execution entry rechecks authority and refuses to start
  reconciliation recreates/reuses exact invalidation artifact
  retries invalidateOrganizationClaim on exact current tuple
```

### I — recover/takeover races with invalidation

```text
both observe CLAIMED generation 4

if invalidation commits first:
  Board -> REOPENED/BLOCKED
  recoverClaim no longer has valid CLAIMED precondition

if takeover commits first:
  Board stays CLAIMED generation 5 under replacement owner
  invalidation for generation 4 fails stale
  authority is re-evaluated for generation 5
```

### J — duplicate invalidation

```text
same invalidationRef replay
=> same committed Board consequence / no duplicate mutation

different stale invalidationRef for old tuple
=> fail closed
```

### K — takeover is not a new attempt

```text
attempt A1 ACTIVE
Board writer generation 4 crashes
recoverClaim -> writer generation 5
=> A1 remains the semantic attempt
=> controller recovers exact binding/effect truth
=> no policy re-resolution merely because process restarted
```

### L — remediation creates a new attempt

```text
A1 terminal remediation-required
exact remediation decision commits
ExecutionAttemptHead CAS advances
=> A2 created
=> current policy may be resolved for A2
```

---

## 10. Result of this research loop

Execution-strategy rebase remains accepted as architecture direction.

The A.1 trust-transition holes are closed at contract level by:

```text
1. durable ExecutionAuthorityPolicyHead governance
2. durable CLAIM_RELEASE_RECEIPT + ClaimReleaseHead
3. canonical authority-revocation -> Blackboard lifecycle invalidation
4. trusted publisher verification for grant/policy authority
```

The key correction from v6 is explicit:

```text
ClaimReleaseHead.FENCED != lifecycle release

Board invalidation first
release-head fence second
```

Integration B gains one strengthened precondition:

```text
4. durable semantic ExecutionAttemptHead ownership
```

No new organization-level scheduler, role registry, generic IAM platform, or Restate-specific architecture primitive is introduced.

Producer assessment after the adversarial schedules above: the v6 lifecycle-stuck hole is closed at contract level and no additional A.1 trust-transition hole was found in this loop. This is **not** an acceptance verdict; BB-046 remains subject to independent readiness review on the exact v7 artifact.