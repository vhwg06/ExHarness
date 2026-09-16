# BB-016 — Interrupted work and review recovery research

Status: **EVIDENCE / JUDGMENT CANDIDATE**

## Question

How should the concrete Agentic Application recover when a process/session dies while a Blackboard item is `CLAIMED` or `REVIEWING`, without guessing that elapsed time means the old executor stopped and without redispatching an external effect whose outcome is unknown?

## Current source-backed boundaries

### Application claim lifecycle

`ApplicationOrchestrator.claim(...)` accepts only `READY`/`REOPENED`, then stores:

```text
status = CLAIMED
owner = <string identity>
```

`checkpoint(...)`, `submit(...)` and `block(...)` require the same owner string. There is no recovery/takeover transition from `CLAIMED`.

Therefore a process death after claim but before checkpoint/submit can strand the item indefinitely.

The owner string is also not a fencing token. If a future takeover reused the same owner identity, current owner equality would not distinguish an old executor from the replacement attempt.

### Review lifecycle

`beginReview(...)` freezes one active review and moves:

```text
PENDING_REVIEW -> REVIEWING
```

The active review stores review key, reviewer identity and exact submission subject. `recordAssessment(...)` safely re-checks that this active review did not change while asynchronous trust verification ran.

There is no transition that abandons/reschedules an interrupted active review. A process/reviewer death can therefore strand `REVIEWING`.

If recovery merely cleared and recreated the same `{key, reviewer, subject}`, an old assessment produced by the previous dispatch could become indistinguishable from the new dispatch. Review recovery therefore needs attempt fencing in addition to reviewer identity and submission subject.

### Durable Backend -> QA application workflow

`createDurableBackendQaWorkflow(...)` persists stage checkpoints before/after completed stages and can resume from committed boundaries such as:

```text
BACKEND_PENDING
QA_PENDING
BACKEND_REMEDIATION_PENDING
```

A fresh session is already safe after a completed checkpoint, for example after accepted Backend work has persisted `QA_PENDING`.

But `advance(...)` claims the item **before** executing Backend or QA. If the process dies inside that execution, the Board contains the last checkpoint plus `CLAIMED`; current workflow code cannot recover it.

### Core effect/recovery capability

BB-006/BB-007 already established the Core invariant:

```text
candidate / variation state != proof of external effect completion
```

The recovery reference consumer composes:

```text
restore runtime authority
-> inspect/reconcile pending effects
-> apply confirmed effect truth or safely retry only when policy permits
-> preserve evidence
-> close interrupted variation
-> explicit resume
```

A `NON_RECONCILABLE`/unknown effect outcome escalates and remains unresolved. Confirmed effects are consumed without redispatch. Idempotent retry reuses the same action key.

This is the correct effect-truth boundary for a mutating stage.

### Missing concrete composition

Current `BackendWorker` creates a Core harness internally for each execution. The public `createHarness` is effect-aware, but its default session store is in-memory when the caller does not provide one.

The concrete Backend Worker currently provides neither a durable Core session store nor restored runtime authority across a process restart.

Therefore the Agentic Application **cannot currently use Blackboard state alone** to decide that an interrupted Backend stage is safe to execute again. A repository/workspace mutation could have happened after claim even if the application checkpoint was never advanced.

`QaWorker` is materially different: its environment action always throws and its contract forbids lineage mutation. Retrying interrupted QA against the same accepted revision does not have the Backend external-mutation ambiguity, although generation fencing is still required so an old QA attempt cannot commit application state after takeover.

## Failure matrix

| Crash boundary | Durable application state | Effect ambiguity | Current recovery | Required behavior |
| --- | --- | --- | --- | --- |
| before claim | READY/REOPENED | none from this attempt | claim normally | no special recovery |
| after claim, before Worker starts | CLAIMED + prior checkpoint | Board alone cannot prove Worker never started | stranded | explicit takeover with new generation; concrete stage recovery decides retryability |
| during Backend before/around action | CLAIMED + prior checkpoint | possible external mutation | stranded; concrete Backend Core state not durable today | restore/reconcile Core effect authority before any redispatch |
| Backend external action completed, app/Core persistence crashes | CLAIMED + prior checkpoint | high; external state may have changed | Core primitives exist only when effect/session state survives | consume confirmed effect result, safe retry by policy, or block/escalate |
| Backend result completed, before application checkpoint | CLAIMED + prior checkpoint | repository mutation may already exist | stranded | recovery must reconcile execution/effect result before rerunning stage |
| after Backend checkpoint (`QA_PENDING`) | REOPENED + durable accepted handoff | no ambiguity for completed Backend stage | fresh-session resume exists | keep current behavior |
| during QA | CLAIMED + `QA_PENDING` checkpoint | application target is non-mutating; repeated provider cost possible | stranded | explicit takeover + generation fencing; retry same accepted target is allowed once prior attempt is invalidated |
| QA completed, before submit/checkpoint | CLAIMED + `QA_PENDING` | no application mutation, but result not committed | stranded | retry/reverify under new generation; old result must be fenced out |
| after QA submission | PENDING_REVIEW | completed application stage | fresh-session review path exists | keep current behavior |
| after `beginReview`, before reviewer result | REVIEWING + active review | no work mutation, but review dispatch may still finish later | stranded | explicitly abandon/reschedule review attempt with new generation/subject |
| during trust verification in `recordAssessment` | REVIEWING | stale result race | current exact active-review recheck protects only while target unchanged | takeover must change generation/subject so old assessment fails recheck |
| after assessment transaction | derived review state | committed | durable | no special recovery |

## Options

### A. Time-based lease expiry alone

Example:

```text
claimedAt + ttl < now
-> assume dead
-> reclaim/retry
```

Reject as correctness authority. Time can indicate liveness suspicion, but elapsed time does not prove the prior process stopped, nor does it prove whether an external effect completed.

A paused/partitioned executor could wake after lease expiry and still submit. A mutating Backend action could have completed before the process disappeared.

### B. Explicit takeover with owner string only

Better than silent timeout but insufficient. Replacing `owner` blocks an old executor only if identities differ. Reused logical owner names and review identities remain ambiguous, and effect truth is still unresolved.

### C. Generation-fenced explicit recovery + concrete effect reconciliation

Recommended.

Separate two questions:

```text
Who is allowed to commit this attempt?
    -> monotonic generation / attempt fencing

Is the interrupted stage safe to continue or redispatch?
    -> concrete recovery policy + Core effect reconciliation where mutating
```

No elapsed-time transition changes correctness state automatically.

## Recommended application boundary

### Execution generation

Every claimed execution attempt receives a monotonically increasing generation independent of owner identity.

Conceptually:

```text
claim
  -> { owner, generation }

checkpoint / submit / block
  require exact { owner, generation }
```

An explicit recovery/takeover increments the generation before replacement work is allowed. Any old executor holding the previous generation becomes stale even if it uses the same owner string.

The generation is lifecycle fencing, not correctness evidence and not a Core variation id.

### Explicit recovery, not automatic lease takeover

A stranded `CLAIMED` item requires an explicit recovery action. Time/heartbeat information may later help an operator/PM decide that recovery should be attempted, but it must not itself authorize retry.

For the concrete Backend -> QA workflow, recovery evaluates the persisted workflow checkpoint and the interrupted stage:

```text
Backend stage
  -> restore durable Core execution/effect authority
  -> reconcile effects
     -> CONFIRMED: consume/apply confirmed result without blind redispatch
     -> safe IDEMPOTENT retry: retry under same action key/policy
     -> UNKNOWN/NON_RECONCILABLE: BLOCK/ESCALATE
  -> only then issue replacement execution generation / continuation

QA stage
  -> invalidate old execution generation
  -> retry against exact persisted accepted revision/artifact handoff
```

A generic caller-provided string such as `safeToRetry=true` is not sufficient authority for Backend recovery.

### Review generation

Each dispatched review attempt receives a monotonic review generation. That generation must be part of the active review identity and the review evidence subject.

Conceptually:

```text
review subject =
  item id
  + requirement key
  + exact submission
  + review generation
```

When an interrupted review is explicitly rescheduled, the generation changes. Evidence/decision artifacts produced for the abandoned generation no longer match the current review target, even if the same reviewer is selected again.

This preserves the existing trust rule that assessment evidence must bind the exact active review subject.

### Recovery visibility

A fresh session must be able to distinguish ordinary blocked work from interrupted work requiring recovery. The implementation may add a concrete recovery marker/status/metadata, but it must preserve these semantics:

```text
interrupted != safe to retry
recovery requested != recovery reconciled
recovery reconciled != project accepted
```

The exact storage shape should be chosen in BB-017 from the concrete Backend/QA implementation pressure; a generic lease/recovery framework is not justified here.

## Core composition and D005

BB-016 does not reopen D005’s “no generic Core lifecycle facade yet” decision.

The existing Core APIs already expose the required effect/recovery primitives. BB-017 should first build the concrete Backend recovery adapter/composition over those APIs. A second real repeated consumer may later justify extraction, but this research alone does not authorize a generic Core recovery facade.

## Required BB-017 scenarios

The implementation must make these executable:

1. process dies after application claim but before a non-mutating QA stage commits; explicit takeover fences the old generation and QA resumes against the same accepted revision;
2. stale old execution tries to checkpoint/submit after takeover and is rejected even when owner identity is reused;
3. process dies during mutating Backend execution after an external effect is confirmed but before normal persistence; recovery consumes confirmed effect truth without redispatch;
4. ambiguous/non-reconcilable Backend effect blocks/escalates and does not reopen the stage for blind retry;
5. safe idempotent Backend effect retry preserves the Core action key/policy;
6. interrupted `REVIEWING` is explicitly rescheduled with a new review generation;
7. an assessment/evidence bundle from the abandoned review generation is rejected as stale;
8. committed stage checkpoints and already accepted reviews retain their current restart behavior.

## Judgment

The application recovery gap is not “we need a timeout”. It is two coupled missing contracts:

```text
lifecycle fencing
+ effect-aware continuation authority
```

Generation fencing solves stale executor/reviewer commits. Core effect reconciliation solves whether a mutating Backend stage may continue. Neither substitutes for the other.
