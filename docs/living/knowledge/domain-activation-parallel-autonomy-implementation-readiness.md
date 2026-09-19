# Integration D — DOMAIN_ACTIVATION + parallel autonomy readiness

Status: **CANDIDATE ARCHITECTURE — NOT IMPLEMENTATION AUTHORITY**

This artifact is the Researcher + SA look-ahead for the first autonomous multi-domain execution slice after Integration C.

It does not authorize source implementation and does not introduce a global organization scheduler.

## 1. Bottleneck

Integration C can prove:

    accepted domain product
      -> typed CrossDomainObligation
      -> target-domain OrganizationWorkContract
      -> exact ownership/currentness
      -> selective dependency invalidation

But without a wake-up mechanism the organization still requires an external/manual caller to say:

    "run FE now"
    "run BE now"

That means the organizational graph is durable, but the organization is not autonomous.

The next high-impact problem is therefore:

> How does exact owning-domain work become runnable automatically without reintroducing one central next-role dispatcher, global workflow, or scheduling brain?

Integration D owns this boundary as DOMAIN_ACTIVATION.

Hard invariant:

    Activation != Scheduling

## 2. Research findings

### 2.1 Level-triggered reconciliation is a better semantic model than event-driven command execution

Kubernetes controller-runtime reconciles from **current state**, not from the historical event payload. Events enqueue a reconcile key; the reconciler reads current state and decides what remains true now. Identical reconcile requests are deduplicated by the workqueue.

This is the useful pattern for ExHarness:

    event / poll / restart scan
        -> activation hint(work key)
        -> read canonical ExHarness state
        -> reconcile exact work

not:

    event payload
        -> authority to execute

The event is an optimization for latency, not correctness authority.

References:
- https://pkg.go.dev/sigs.k8s.io/controller-runtime/pkg/reconcile
- https://pkg.go.dev/sigs.k8s.io/controller-runtime/pkg

### 2.2 Missed/duplicate signals should not require exactly-once messaging

Because activation is level-triggered, duplicate signals can collapse and missed signals can be repaired by a later scan/reconciliation pass.

Therefore Integration D does **not** need exactly-once queue semantics as an organizational invariant.

A transactional outbox/event log may later improve latency or transport durability, but canonical work/obligation state remains the source of truth.

### 2.3 Restate can host activation/runtime mechanics without owning organizational truth

Restate Basic Services, Virtual Objects and Workflows provide durable execution/communication; Virtual Objects serialize writes per key, while independent keys run concurrently. Restate also supports idempotency keys for deduplicating repeated requests.

These are useful implementation mechanics for a DomainActivation adapter, but:

    Restate queue / invocation
      != organization work existence
      != ownership
      != priority
      != claim authority
      != strategy selection

References:
- https://docs.restate.dev/concepts/services/
- https://restate.dev/what-is-durable-execution
- https://restate.dev/blog/announcing-restate-1.3

## 3. SA decision

Integration D should use **domain-local level-triggered activation**.

Each owning domain has a bounded activation controller:

    DomainActivationController(domain)

It receives exact work keys from any combination of:

    canonical-state watch
    event hint
    periodic/resume scan
    explicit test/manual poke

Every path converges on the same reconcile function.

No source is allowed to carry enough authority to bypass canonical-state re-read.

## 4. Activation subject

Activation operates on **one exact organizational work identity**, not on a role/stage name.

Minimal subject:

    DomainActivationKey {
      projectId
      workId
      owningDomain
    }

For work materialized from Integration C cross-domain obligations, the immutable OrganizationWorkContract must retain the exact source obligation/currentness subject needed to revalidate that the work is still semantically authorized:

    sourceObligationRef
    sourceObligationKey
    observedObligationHeadGeneration

These are execution-admission inputs, not activation-event fields.

Optional trigger metadata may carry:

    observedBoardRevision
    observedObligationHead
    reason = EVENT | SCAN | RETRY | RECOVERY | MANUAL_TEST

but these fields are hints/telemetry only.

The reconcile path resolves current authoritative state again.

Do not use:

    "activate BACKEND"
    "run next developer"
    "advance DEVELOPMENT stage"

as correctness semantics.

## 5. Canonical activation predicate

The activation controller may proceed only when current source truth proves all required conditions.

Conceptually:

    isActionable(workId, domain) =
      work exists
      AND owningDomain == domain
      AND lifecycle is currently claimable/recoverable for this path
      AND dependencies/required obligations are current
      AND WorkContract resolves exactly
      AND materialization/claim authority remains valid
      AND no current owner/execution state makes fresh activation invalid

The activation hint never supplies these facts.

If the predicate is false:

    reconcile -> NOOP / WAIT / BLOCKED

No work or obligation is invented.

## 6. Activation does not choose priority

If three FE work items are actionable:

    FE-101
    FE-102
    FE-103

activation may independently surface/reconcile all three exact keys.

It does not rank them.

Any bounded prioritization/capacity decision is a separate policy:

    activation
      = "this exact work is actionable for FE"

    scheduling/selection
      = "of multiple actionable FE items, which gets capacity first?"

Integration D should avoid adding scheduling unless a concrete capacity conflict forces that boundary.

The existing bounded work-selection capability may later be reused or adapted, but it is not part of DOMAIN_ACTIVATION correctness.

## 7. Exact domain ownership

A controller instance is bound to one domain identity:

    DomainActivationController(FRONTEND)
    DomainActivationController(BACKEND)

On reconcile it must reject/no-op:

    key.owningDomain != controller.domain

A signal source cannot relabel work to another domain.

The authenticated execution principal used for claim must be supplied/resolved by trusted runtime configuration and checked through existing A.1 organization claim authority.

Activation itself grants no identity.

## 8. Reconcile flow

Recommended semantic flow:

    activation hint(workId, domain)
      ↓
    resolve current Board/work state
      ↓
    resolve exact OrganizationWorkContract
      ↓
    validate owningDomain
      ↓
    validate obligation/dependency currentness
      ↓
    inspect current claim/release/execution-attempt state
      ↓
    CASE:

      READY / REOPENED and claimable
        -> ordinary trusted principal claim
        -> publish/reuse release capability
        -> revalidate exact source-obligation/currentness subject
        -> if stale: canonical claim invalidation/fencing and STOP
        -> otherwise enter DomainExecutionController

      CLAIMED by same recoverable domain path
        -> recoverClaim / exact existing recovery semantics
        -> reuse released work semantics
        -> enter/recover DomainExecutionController

      CLAIMED by another valid owner
        -> NOOP

      BLOCKED / PENDING_REVIEW / REVIEWING / DONE / SUPERSEDED
        -> NOOP

      stale obligation / invalidated authority
        -> canonical invalidation/reconciliation
        -> NOOP

At no point does activation resolve ExecutionStrategy directly.

### Claim/invalidation race closure

Activation pre-check is not sufficient by itself:

    T1 activation reads obligation ACTIVE
    T2 activation claims work
    T3 upstream invalidation marks obligation STALE
    T4 execution starts

To fail closed, the path must revalidate the exact source-obligation/currentness subject **after claim/release publication and immediately before execution entry**.

If currentness changed:

    organization claim
      -> canonical invalidateOrganizationClaim(...)
      -> release capability fenced
      -> no DomainExecutionController start

If execution already crossed the entry boundary, Integration C/A.1 invalidation must fence the current claim/release and Integration B recovery/effect semantics decide safe reconciliation.

This makes activation and invalidation symmetric; neither assumes its earlier read stays current.

Integration B remains owner of:

    claim/release
      -> ExecutionPolicy
      -> ExecutionStrategy
      -> ExecutionAttemptBinding

## 9. Duplicate activation

Duplicate trigger delivery is expected.

Example:

    watch event FE-101
    periodic scan FE-101
    retry event FE-101

All may race.

Correctness comes from canonical claim/currentness CAS, not trigger dedupe.

Expected result:

    at most one current organizational claim generation executes
    duplicate losers observe current state and NOOP/recover appropriately

An optional adapter queue may deduplicate the same DomainActivationKey for efficiency, as Kubernetes workqueues do, but dedupe is not the only correctness boundary.

## 10. Missed activation

A pure event-triggered model is rejected for D v1 because an event transport outage must not permanently strand persisted actionable work.

Each domain therefore needs a **reconciliation scan** capable of reconstructing activation candidates from canonical state.

Minimal restart behavior:

    domain controller starts/restarts
      -> scan current actionable work for exact domain
      -> enqueue exact DomainActivationKeys
      -> reconcile each key

A watch/event path may reduce latency after the initial scan.

This is the autonomy acceptance criterion:

> Persisted actionable work eventually becomes visible to its owning domain without a manual next-role dispatcher, even if the original notification was missed.

## 11. Activation source is disposable

Watch cursors, queue entries, local activation caches and in-memory backoff state are not product authority.

Deleting them must not lose organizational work.

Canonical truth remains:

    Blackboard lifecycle/current revision
    + immutable WorkContract
    + obligation/currentness refs
    + claim/release authority
    + execution-attempt state

Therefore:

    rebuild activation queue from source truth
      -> same actionable domain work set

subject to current lifecycle changes.

## 12. No transactional outbox required for correctness in D v1

Cross-domain publication/Board mutation may optionally emit an activation event after commit.

If the event is lost:

    reconciliation scan finds the work later

If the event is duplicated:

    reconcile current state + claim CAS converges

If an event arrives before a related projection is visible:

    reconcile sees not-actionable
    -> no effect
    -> later scan/watch retries from current state

This avoids introducing an event log/queue as a second source of truth merely to bridge a publication-notification atomicity gap.

If future latency/SLA requirements make scan fallback insufficient, a durable outbox can be added as a delivery optimization without changing activation semantics.

## 13. Restate adapter option

Restate is a good candidate implementation adapter after the semantic contract is proved.

Possible shape:

    activation source
      -> Restate Basic Service / send
      -> DomainActivationController.reconcile(key)

or keyed:

    DomainActivator Virtual Object keyed by:
      projectId + domain + workId

Benefits:

- durable delivery/execution;
- idempotency keys can collapse repeated external trigger requests;
- keyed single-writer semantics can reduce local duplicate work;
- independent keys remain parallel;
- versioned deployments keep runtime identity observable.

But Restate state cannot replace canonical ExHarness work/claim/currentness stores.

The activation handler still re-reads canonical ExHarness state before claim/execution.

Restate vqueue/flow-control, if used, is infrastructure capacity control. It must not silently become product priority/scheduling semantics.

## 14. FE + BE parallel autonomy slice

After Integration C publishes an ArchitecturePackage:

    ARCH-CATALOG@a2
      -> FE_FEATURE_REQUIRED obligation
      -> BE_FEATURE_REQUIRED obligation

C materializes both exact works.

Then D proves:

    FRONTEND activation controller
      -> discovers FE work
      -> claims FE work
      -> FE ExecutionPolicy
      -> FE strategy
      -> FE attempt

    BACKEND activation controller
      -> discovers BE work
      -> claims BE work
      -> BE ExecutionPolicy
      -> BE strategy
      -> BE attempt

No call path:

    SA -> FE worker
    SA -> BE worker
    PM -> next worker
    central orchestrator -> choose FE vs BE

is needed.

FE and BE may use different strategy kinds/versions and progress independently.

## 15. Parallelism invariant

The architecture should prove **absence of an implicit stage barrier**.

Valid:

    FE-DETAIL blocked on API contract
    BE-LIST progressing
    FE-LIST progressing
    BE-DETAIL progressing independently if its own inputs are current

Invalid:

    "Frontend stage waits for Backend stage"
    "Development stage complete before QA stage"

unless an exact semantic dependency actually requires it.

Domain activation sees exact current work items, not organization stages.

## 16. Invalidation interaction

Integration C selective invalidation and D activation must compose safely.

Case:

    FE-DETAIL becomes actionable
      -> activation hint queued

then upstream requirement changes before reconcile:

    REQ-DETAIL r1 -> r2
      -> FE-DETAIL obligation/work becomes stale

When old activation hint runs:

    reconcile reads current state
      -> stale/non-actionable
      -> NOOP / canonical reconciliation

Old queued triggers never become execution authority.

Case inverse:

    invalidation occurs while FE-DETAIL already CLAIMED/executing

Then C/A.1 invalidation semantics fence organizational execution capability. D does not invent a replacement run; later current replacement/remediation work appears as a new exact actionable key.

## 17. Crash/restart matrix

Integration D must prove:

1. duplicate activation hints for the same work converge through canonical state/claim fencing;
2. missed notification is recovered by restart/periodic canonical scan;
3. wrong-domain activation hint cannot claim or execute work;
4. stale obligation event cannot activate invalidated work;
5. process crash after claim but before execution uses existing claim/release recovery rather than fresh scheduling;
6. process crash after ExecutionAttemptBinding uses Integration B attempt recovery, not a new attempt;
7. event queue/cache loss does not lose canonical actionable work;
8. two domain controllers racing the same exact work cannot create two current claims/executions;
9. FE and BE activation/execution can proceed concurrently on independent work;
10. one domain outage does not prevent another domain from progressing independent work;
11. domain restart does not require prior shared conversation or event history;
12. strategy promotion changes new attempts only and does not alter activation ownership;
13. partial invalidation suppresses only stale affected activation keys while unrelated domain work remains actionable;
14. removing the manual next-role dispatcher does not stop organization progress;
15. obligation supersession racing activation between pre-check and claim/release cannot enter execution after the post-release currentness recheck;
16. obligation supersession after execution entry fences the current claim/release and cannot be bypassed by queued activation hints.

## 18. Observability facts to capture now

D should emit low-cost activation telemetry for later Integration I, without making telemetry authority:

    DomainActivationObservation {
      domain
      workId
      triggerKind
      observedAt
      reconcileOutcome:
        CLAIMED
        RECOVERED
        NOOP_NOT_ACTIONABLE
        NOOP_ALREADY_OWNED
        NOOP_WRONG_DOMAIN
        INVALIDATED
        ERROR
      observedBoardRevision
      latencyFromActionableAt
    }

This is operational observation only.

It can later answer:

    work sat actionable for how long?
    how many duplicate triggers occur?
    which domain has activation lag?
    are scans constantly recovering missed events?

It cannot prove acceptance or lifecycle truth.

## 19. First implementation boundary

Integration D is implementation-ready when exact source seams can be named for:

    DomainActivationKey
    DomainActivationSource
      - canonical domain scan
      - optional event/watch hint source
    DomainActivationController.reconcile(...)
    trusted domain principal binding
    claim/release handoff into DomainExecutionController
    source-obligation/currentness binding on materialized WorkContract
    post-claim/post-release currentness handshake before execution entry
    restart/rescan semantics
    optional Restate activation adapter
    FE concrete domain
    FE/BE independent activation fixture
    missed-event recovery fixture
    duplicate-event fixture
    stale-event fixture
    one-domain-down/other-domain-progress fixture
    partial-invalidation fixture

No global scheduler or role registry is required.

## 20. Exit invariant

Integration D is successful when this holds:

    durable cross-domain obligation
      -> target work exists
      -> exact owning-domain controller eventually discovers it
      -> current state is revalidated
      -> ordinary authorized claim occurs
      -> domain-local execution starts/recoveries correctly
      -> unrelated domains progress independently

while:

    event != authority
    activation != scheduling
    activation != strategy selection
    activation != obligation creation
    queue != source of truth
    manual next-role dispatch is unnecessary

This is the first point where ExHarness can legitimately claim **parallel organizational autonomy**, rather than durable work plus manual invocation.
