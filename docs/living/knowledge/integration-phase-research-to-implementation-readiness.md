# Integration phase research-to-implementation readiness

Status: **CURRENT ROADMAP**

This is the single current roadmap. Update this file in place; Git history carries revisions. Fresh sessions do not load previous roadmap revisions.

Ừ. Sau khi research + đối chiếu với source ExHarness hiện tại, tao nghĩ **integration phase nên dùng một workload objective đủ lớn để bắt hệ thống phải hành xử như một software organization thật**.

## Executive review summary

```text
Current candidate status:
  PROPOSED / AWAITING INDEPENDENT REVIEW

Independent acceptance may authorize:
  delivery of the Integration A.1 SOURCE IMPLEMENTATION SLICE only
  through the existing ExHarness project-delivery/Blackboard path

It does NOT authorize:
  runtime organizational work by itself
  every future obligation present in the artifact
  Integration B→J as implementation-ready

After A.1 code exists, its acceptance fixture separately requires:
  exact MATERIALIZATION_AUTHORIZATION for one runtime fixture obligation

Hard boundaries:
  no global organization scheduler
  no PM dispatch
  no execution-policy/strategy resolution in materialization
  no organization-level workflow/pipeline as a scheduling primitive
  no mutable authoritative Claim assertions
  no activation layer choosing next domain/order/execution strategy
  no mutable ProductStateProjection as truth
  no authority-revocation path that fences capability without a canonical Board lifecycle consequence

Open mechanisms:
  tracked in the explicit twelve-gap matrix with hard blocking slices
```

The current roadmap preserves the established trust/authority architecture. It does **not** rebase B→J, introduce a workflow-generation engine, or move organizational authority into Restate. It makes explicit an already-compatible delivery assumption: lifecycle/workload workflows may be predefined and versioned, while the project artifact set may begin incomplete and evolve with the end user across those known phases.

Objective benchmark nên là kiểu:

```text
Build and deploy a small public website.

Users can:
- browse a catalog
- open a detail page

Product must:
- obtain data from a backend service
- be deployable in a reproducible environment
- expose runtime health
- have automated acceptance evidence
```

Không cần auth/payment/database phức tạp ở phase đầu. Nhưng objective này đã bắt buộc **PM + BA + SA + FE + BE + DevOps + QA** phải phối hợp.


### Glossary cho independent reviewer

Tài liệu chỉ có **một glossary canonical** ở Section 2. Executive summary không duplicate định nghĩa để tránh hai nguồn terminology drift. Reviewer đọc nhanh có thể nhảy thẳng tới `Working glossary for independent review` trước khi review authority contracts.

# 0. Explicit lifecycle + evolving artifact bundle

The integration target does not require ExHarness to invent a project workflow from arbitrary artifacts at runtime.

The delivery lifecycle may be an explicit, versioned contract selected before execution:

```text
ProjectSeed
  goal
  lifecycleRef
  initialArtifactRefs[]   # may be incomplete
        |
        v
explicit/versioned product lifecycle
        |
        +-> product / PM responsibility
        +-> BA responsibility
        +-> SA responsibility
        +-> FE / BE responsibility
        +-> DevOps responsibility
        +-> QA responsibility
        +-> closure
```

The lifecycle defines expected responsibility, accepted input/output artifact kinds, completion semantics and bounded human-interaction points. It does **not** require an LLM planner to invent role ordering, workflow topology or a new orchestration graph for every project.

The artifact bundle is allowed to evolve through the lifecycle:

```text
initial artifacts v0
  idea.md
  requirement-notes.md
  design.fig
        |
        v
bounded phase/workload
  consume what exists
  identify missing/ambiguous inputs for that responsibility
  ask the end user only when authoritative clarification is required
  publish/supersede canonical artifacts
        |
        v
artifact bundle v1
        |
        v
next actionable domain workloads
        |
       ...
        |
        v
complete delivery evidence + ProductOutcomeClaim
```

Hard distinctions:

```text
explicit lifecycle/workflow definition
!= runtime workflow-generation engine

artifact exists
!= artifact is accepted/current product truth

phase/workload can request HUMAN_DECISION_REQUIRED
!= agent fabricates missing Product Owner authority

Restate workflow/handler
= one durable execution mechanism for a bounded ExecutionStrategy
!= organization-wide authority to choose arbitrary work/domain/product truth
```

A project may therefore start with only a partial artifact set. Each bounded domain workload decides whether its declared inputs are sufficient for its own responsibility. Missing or conflicting semantics become typed obligations, bounded clarification or downstream work; they do not require a generic "understand the whole project and invent a workflow" engine.

This keeps the cost model bounded: lifecycle design can evolve deliberately between versions, while individual project runs reuse the selected lifecycle and evolve only project artifacts/evidence.

---

# 1. Research cho thấy mình nên đi hướng nào

Có vài pattern bên ngoài rất đáng lấy, nhưng **không copy nguyên architecture**.

| Source | Cái đáng lấy | Cái không nên lấy |
| --- | --- | --- |
| MetaGPT | Software-company roles, artifact hóa requirement/design/API/code | Nó vẫn chủ yếu là một SOP được orchestrate khá chặt: `Code = SOP(Team)`. Role dễ trở thành stage của một mega-workflow. ([GitHub](https://github.com/FoundationAgents/MetaGPT)) |
| Microsoft Agent Framework | Typed workflow, checkpoint/resume, parallelism, observability, explicit workflow state | Dùng **bên trong từng role workload**, không dùng một graph khổng lồ cho cả organization. ([Microsoft Learn](https://learn.microsoft.com/vi-vn/agent-framework/workflows/)) |
| A2A | `Task` là durable unit of action; **Artifact là output**, Message là communication và không phải reliable carrier cho critical output | Không cần implement A2A protocol ngay. Lấy semantic separation trước. ([A2A Protocol](https://a2a-protocol.org/dev/specification/)) |
| Temporal | Long-running workflow phải survive crash và resume từ durable state | Có thể học execution model mà không cần đưa Temporal vào dependency. ([Temporal](https://docs.temporal.io/)) |
| Fowler Blackboard | Autonomous agents coordinate qua shared state/progress/integration points thay vì tuần tự handoff | Không dùng Git repo làm Blackboard; communication surface nên độc lập với source control. ([Martin Fowler](https://www.martinfowler.com/articles/exploring-gen-ai/an-accidental-blackboard.html)) |
| NVIDIA NOOA | Typed I/O, pass-by-reference, explicit object state, programmable loop/harness API | Đây là substrate-level idea, không phải organizational model. Nó hợp với Core hiện tại. ([NVIDIA Developer](https://developer.nvidia.com/blog/six-agent-harness-capabilities-for-higher-model-performance/)) |
| Microsoft observability | Workflow/agent execution cần trace, logs, metrics thay vì chỉ final output | Telemetry không được biến thành acceptance authority. ([Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/workflows/observability)) |

Điểm quan trọng nhất từ research là **không có lý do để model whole software organization thành một workflow graph**.

MetaGPT chứng minh:

```text
software roles have value
```

nhưng Fowler Blackboard chứng minh thêm một thứ gần cái mình cần hơn:

```text
autonomous workers
+
shared coordination space
+
explicit integration points
```

Và A2A reinforce đúng chỗ artifact semantics:

```text
communication != output
message != durable result
artifact = output
```

Đây chính xác là hướng ExHarness đang đi.

---

# 2. Target architecture của Integration Phase

Tao sẽ đặt architecture như này:

```text
                        USER / PRODUCT OWNER
                               │
                               │ ProductObjective
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    PRODUCT STATE SPACE                       │
│                                                             │
│ Objective / obligations / dependencies / claims / blockers  │
│                     BLACKBOARD                              │
└─────────┬───────────┬───────────┬───────────┬───────────────┘
          │           │           │           │
          ▼           ▼           ▼           ▼
     PM DOMAIN     BA DOMAIN    SA DOMAIN   QA DOMAIN
     own state     own state    own state   own state
     workloads     workloads    workloads   workloads
     exec policy   exec policy  exec policy exec policy
          │                         │           ▲
          │                         │           │
          │                    ┌────┴────┐      │
          │                    ▼         ▼      │
          │                FE DOMAIN  BE DOMAIN │
          │                workloads  workloads │
          │                    │         │      │
          │                    └────┬────┘      │
          │                         ▼           │
          │                    DEVOPS DOMAIN ───┘
          │
          └────────────── observe product state


────────────────── SHARED SUBSTRATE ──────────────────

          Oracle
     context resolution

          Core Harness
 execution / cognition / evidence / recovery

       Artifact / Trust Store

       Blackboard / Event history

       Observability / Metrics

──────────────────────────────────────────────────────
```

**Không có box "Organization Orchestrator → select next agent".**

Đây là difference quan trọng nhất.

Blackboard biết:

```text
facts
claims
dependencies
obligations
blockers
artifacts
```

Nhưng Blackboard không nói:

```text
bây giờ chạy BA
sau đó chạy SA
sau đó chạy BE
```

Role domain tự nhìn shared state và xác định:

```text
có workload nào thuộc authority của tao đang actionable?
```

---

## Working glossary for independent review

Các thuật ngữ dưới đây là glossary canonical duy nhất của document:

```text
Board item == Blackboard item
  durable work-lifecycle/dependency/provenance record trên Blackboard.

Artifact
  immutable/versioned work product hoặc contract được referenced từ durable state;
  message/chat không thay thế artifact authority.

Claim (noun)
  immutable authoritative assertion payload bound vào exact subject/ref/revision/evidence.
  Change = supersede/revoke/new Claim; assertion payload không rewrite in place.

claim work (verb)
  acquire lifecycle ownership của một eligible Board item.

Obligation
  typed unresolved product/work requirement có issuer + target domain + derivation refs;
  không đồng nghĩa scheduler command.

Materialization
  deterministic conversion từ một explicitly authorized obligation thành
  one immutable work contract + one canonical Board work identity.
  Materialization không chọn next domain/work hay execution strategy.

ExecutionPrincipal
  trusted application/infrastructure-derived executor identity used for authorization.
  Domain authority is derived from this principal + the CURRENT durable ExecutionAuthorityPolicyHead;
  caller-provided domain strings are non-authoritative hints only.

ExecutionAuthorityPolicyHead
  durable CAS-fenced current policy subject: policyId -> generation/status/policyRef.
  Old immutable policy refs remain history but cannot be replayed as current authority.

ClaimReleaseReceipt
  immutable capability receipt bound to exact Board claim generation + trusted principal +
  materialization authorization head + execution-authority policy head. Board CLAIMED alone is provisional;
  executable entry requires a current durable release head + fresh authority revalidation.

MaterializationAuthorization
  immutable grant/revocation lineage that binds exact accepted decision + candidate
  + slice/obligation scope + issuing authority/policy generation.
  Authorization is revalidated at materialization and claim/execution entry.

Activation
  surfaces persisted actionable work to its exact owning domain;
  it does not choose next domain/order/priority/execution strategy.

Domain execution control
  after an authorized/released claim, owning-domain controller resolves the claimed workload
  through a pinned domain-local ExecutionPolicy to one immutable ExecutionStrategyRef.
  Current ApplicationOrchestrator lifecycle authority does not imply organization-level
  execution-strategy selection authority.

ExecutionPolicy
  immutable/versioned domain-local policy for HOW one already-claimed workload executes.
  It may resolve strategy/config refs; it may not choose work, domain, priority or acceptance semantics.

ExecutionStrategy
  replaceable implementation of domain-local execution, e.g. Restate durable handler/workflow,
  an application/Core loop, or a human-assisted strategy. A strategy is not product/write authority.

ExecutionAttemptBinding
  immutable pre-execution binding of released claim + workContractRef + executionPolicyRef
  + strategyRef + runtime/config refs. Recovery of the same semantic attempt reuses this binding.

ExecutionAttemptHead
  durable domain-local owner of semantic attempt identity. Process restart/takeover reuses an ACTIVE/
  RECOVERY_REQUIRED attempt; only an explicit remediation/lifecycle decision may advance to a new attempt.

Fencing / CAS
  optimistic concurrency guard: mutation commits only when observed generation/revision/head
  is still current; stale writers fail closed.

Authority provenance
  fields such as `issuedByAuthorityRef` record who an already trusted boundary derived/verified;
  the string itself is never authority proof.

Claim authority
  whether an authenticated/authorized ExecutionPrincipal may acquire a Board item.

Write authority
  after a valid claim, which artifact/Claim/Obligation kinds a domain may publish/issue.

ProductHistoryHead
  canonical durable history generation/digest from which current Claims, Obligations,
  lineage and projection inputs are derived. A caller cannot choose an arbitrary subset.

ProductStateProjection
  pure/rebuildable derived view from a complete pinned product-history subject + policy/root refs;
  not source of truth and not completion authority.
```

---

# 3. Product state phải là vector, không phải global stage

Tao nghĩ đây là một quyết định architecture cực quan trọng.

Đừng model website bằng:

```text
PLANNING
↓
ANALYSIS
↓
DEVELOPMENT
↓
TESTING
↓
DEPLOYMENT
↓
DONE
```

Nếu làm vậy thì quay lại super-agent pipeline ngay.

Model nó như một **state vector**:

```yaml
objective: website-001

product_state:
  intent:
    status: ACTIVE
    ref: objective-v2

  requirements:
    status: ACCEPTED
    ref: requirements-v4

  architecture:
    status: ACCEPTED
    ref: architecture-v2

  frontend:
    status: ACCEPTED
    revision: fe-r8

  backend:
    status: ACCEPTED
    revision: be-r5

  deployment:
    status: HEALTHY
    revision: deploy-r3

  quality:
    status: ACCEPTED
    tested:
      frontend: fe-r8
      backend: be-r5
      deployment: deploy-r3

  blockers: []

  objective_closure:
    status: ELIGIBLE
```

FE và BE có thể chạy song song.

QA test planning có thể bắt đầu khi BA vừa xong.

DevOps có thể dựng deployment skeleton ngay sau architecture.

SA có thể re-enter khi FE phát hiện contract issue.

BA có thể clarify một requirement trong khi BE vẫn làm một phần không bị ảnh hưởng.

PM luôn quan sát delivery.

Một counterexample vận hành bắt buộc để phân biệt state-vector với stage machine:

```text
req-v4
  ├─ catalog-list semantics
  └─ product-detail delivery-copy semantics

BE-list-r2 depends only on catalog-list semantics
FE-detail-r3 depends on product-detail delivery-copy semantics

BA publishes req-v5:
  only product-detail delivery-copy semantics changed

EXPECTED once DEPENDENCY_INVALIDATION is implemented:
  FE-detail-r3 -> stale / remediation obligation
  affected downstream detail claims -> stale
  BE-list-r2 -> remains current and continues

FORBIDDEN:
  reset all DEVELOPMENT work
  reopen unrelated FE/BE work
  wait for a global ANALYSIS barrier
```

Đây hiện là **required behavior**, không phải claim rằng current source đã có invalidation primitive. Nếu implementation chỉ có thể xử lý requirement change bằng cách reset toàn development stage, state-vector architecture đã thất bại về mặt vận hành.

Đó mới giống organization.

---

# 4. Workload semantics không đồng nghĩa execution mechanics

Research loop này rebase hierarchy thành:

```text
Role Domain
    │
    ├── capability
    ├── authority
    ├── context boundary
    │
    └── Workload Type
            │
            ▼
       Execution Policy
            │
            ▼
      Execution Strategy
       /       |        \
 Restate    App/Core    Human
 durable     loop       assisted
 handler/
 workflow
```

`Pipeline` không còn là organizational primitive bắt buộc. Nó chỉ có thể là **một implementation shape bên trong một ExecutionStrategy**.

Backend chẳng hạn:

```text
Backend Domain

feature-delivery
  -> ExecutionPolicy backend.feature-delivery@p17
       -> Strategy backend-feature@v4

bug-fix
  -> ExecutionPolicy backend.bug-fix@p9
       -> Strategy backend-bugfix@v3

technical-research
  -> ExecutionPolicy backend.research@p4
       -> Strategy research-loop@v2
```

Điểm tách quan trọng:

```text
ORGANIZATION / TRUST
  RootIntent
  Obligation
  ORGANIZATION_WORK_CONTRACT
  released authorized claim
        │
════════╪══════════════════════════════════════
        │   DOMAIN-LOCAL EXECUTION
        ▼
DomainExecutionController
  -> ExecutionPolicy
  -> ExecutionStrategyRef
  -> ExecutionAttemptBinding
  -> execute
  -> ExecutionAttemptOutcome
        │
════════╪══════════════════════════════════════
        │   PRODUCT / AUTHORITY
        ▼
domain completion / verifier / Claim publication gate
```

Strategy không được tự biến Worker result thành authoritative product Claim. Existing ExHarness principle vẫn giữ:

```text
execution result
  != role acceptance
  != product acceptance
```

Hard constraints mới:

```text
Organization != Workflow
Workload != Workflow
ExecutionPolicy != Work Scheduler
ExecutionStrategy != Product / Write Authority
ExecutionStrategy != Cross-Domain Dispatcher
Execution strategy may evolve
Work semantics may not silently evolve with it
```

Một strategy revision đổi từ:

```text
restate-workflow backend-feature@v4
```

sang:

```text
application/core-loop backend-feature@v8
```

không tự thay đổi:

```text
BACKEND_DELIVERY_REQUIRED
ORGANIZATION_WORK_CONTRACT
BackendDelivery semantics
acceptance criteria
RootIntent
```

## 4.1 Minimal `ExecutionPolicy` / `ExecutionStrategy` contract

Để abstraction không biến thành một hidden scheduler, policy resolution chỉ nhận **một released claim đã xác định work**. Nó không được scan/rank toàn Board để chọn next work.

```yaml
kind: EXECUTION_POLICY
policyId: backend.feature-delivery
revision: p17
domain: BACKEND
workloadType: feature-delivery
compatibleWorkContractVersions: [v1]
resolution:
  strategyRef: strategy://backend-feature/v4
```

`ExecutionStrategyRef` trỏ tới một immutable descriptor, không phải một mutable alias kiểu "latest":

```yaml
kind: EXECUTION_STRATEGY_DESCRIPTOR
strategyId: backend-feature
strategyVersion: v4
strategyKind: restate-handler | restate-workflow | application-core-loop | human-assisted
compatibleWorkloadTypes: [feature-delivery]
compatibleWorkContractVersions: [v1]
adapterRef: <exact adapter/config ref>
runtimeBindingMode: VERSION_ADDRESSABLE | IMMUTABLE_LOCAL | HUMAN_SESSION
```

Hard boundary:

```text
ExecutionPolicy input
  = releasedClaimReceipt + exact WorkContract + domain-local policy head

ExecutionPolicy output
  = one ExecutionStrategyRef for THE SAME claimed work

ExecutionPolicy may NOT:
  choose another work item
  choose another owning domain
  rewrite WorkContract inputs/outputs/acceptance
  waive review/write/obligation authority
```

Strategy compatibility failure is a policy/configuration failure. Controller must block/escalate; it must not mutate work semantics to make the strategy fit.

## 4.2 `ExecutionAttemptBinding` — pin HOW trước khi chạy

Chỉ ghi provenance sau execution là chưa đủ. Policy/strategy/config có thể đổi trong lúc work đang chạy.

Vì vậy mỗi semantic execution attempt cần một immutable binding **trước execution**:

```yaml
kind: EXECUTION_ATTEMPT_BINDING
executionAttemptId: <stable per semantic attempt>

objectiveId: objective-001
workId: BB-...
domain: BACKEND
workloadType: feature-delivery

workContractRef: <exact>
releasedClaimReceiptRef: <exact claim generation/authority subject>

executionPolicyRef: backend-policy@p17
executionStrategyRef: strategy://backend-feature/v4
strategyKind: restate-handler
strategyId: backend-feature
strategyVersion: v4

runtimeBindingRef: <exact runtime-addressable binding>
runtimeCodeIdentity: <deployment id / image digest / immutable endpoint / local code digest>
contextPolicyRef: context/backend@v7
toolsetRef: toolset/backend@v12
modelProfileRef: model-profile/backend@v5
harnessRef: core-harness@vX
```

Semantics:

```text
same execution attempt recovery
  -> SAME ExecutionAttemptBinding

new remediation attempt
  -> NEW executionAttemptId
  -> resolve current accepted ExecutionPolicy again
  -> NEW binding
```

Binding publication itself is fenced against the observed domain execution-policy head. Separately, the organization authorization model uses its own durable `ExecutionAuthorityPolicyHead`; execution HOW-policy and execution WHO-authority policy are distinct subjects and must not be conflated:

```text
ExecutionAuthorityPolicyHead -> WHO may execute domain work
Domain ExecutionPolicyHead   -> HOW an already released workload executes
```



```text
observe policy head p17
 -> resolve policy/strategy/runtime target
 -> persist binding only if policy head is still p17
 -> binding committed
 -> later promotion to p18 does NOT rewrite this attempt
```

Điều này giữ evolution ở ranh giới attempt thay vì mutate logic giữa một recovery.

## 4.2.1 Semantic execution-attempt ownership — restart không được mint attempt mới

`executionAttemptId` không thể do strategy adapter hoặc process startup tự sinh. Nếu không, một crash có thể vô tình đổi policy/runtime và lặp side effect. Vì current ExHarness đã dùng `claimGeneration` để fence writer takeover nhưng Backend/Core recovery có thể vẫn cần reconcile cùng effect/session, semantic attempt identity phải tách khỏi Board writer generation.

Contract trước Integration B:

```text
ExecutionAttemptHead(workId)
  -> { attemptOrdinal, executionAttemptId, status, bindingRef, transitionRef }

ABSENT + released claim
  -> CAS create first attempt

ACTIVE / RECOVERY_REQUIRED
  -> process restart / recoverClaim / owner takeover
  -> SAME executionAttemptId + SAME binding

TERMINAL_REMEDIATION_REQUIRED + exact remediation decision
  -> CAS advance attemptOrdinal
  -> NEW executionAttemptId
  -> resolve current policy again
```

`claimGeneration` vẫn fence Board writes. Nó không tự authorize semantic attempt mới. Strategy/runtime receives `executionAttemptId`; it does not decide when to mint one.

## 4.3 Restate fit ở đâu — và không fit ở đâu

Restate phù hợp làm **một ExecutionStrategy runtime**, không phải architecture của organization.

Official Restate model có Basic Service, Virtual Object và Workflow; durable execution không bị giới hạn vào Workflow. Workflow `run` executes once per workflow ID, còn immutable deployments giữ retry/in-flight invocation trên cùng code deployment. Vì vậy nếu dùng Restate:

```text
workId != Restate workflowId

executionAttemptId
  -> candidate workflow/invocation identity
```

Một work có thể remediation nhiều lần; dùng stable `workId` làm once-per-ID workflow key sẽ khóa sai semantic attempt. Với Restate Workflow, `executionAttemptId` là candidate workflow ID; với Basic Service/independent callers, cùng attempt identity có thể làm stable idempotency key để deduplicate invocation.

Restate versioning cũng có một constraint quan trọng:

```text
existing invocation
  -> stays on original immutable deployment

new invocation
  -> normally routes to latest registered deployment
```

Do đó `strategyVersion=v4` **không được chỉ là một label ghi sau khi chạy**. Restate adapter phải chứng minh exact strategy runtime is addressable/pinned before start, ví dụ qua version-addressable service identity/endpoint/environment or another verified binding. Nếu adapter chỉ gọi một mutable service name rồi hy vọng "latest == v4", exact strategy replay/baseline-vs-candidate evaluation không đủ grounded.

`strategyVersion` và `runtimeCodeIdentity` là hai identity khác nhau: descriptor `backend-feature@v4` mô tả HOW đã accept; runtime binding chứng minh invocation thật sự chạy code/deployment nào. Một mutable "latest" endpoint không đủ cho controlled replay/evaluation nếu không có một atomic/addressable way chứng minh target trước invocation.

Restate strategy có thể gọi Core Harness bên trong durable steps. Hai abstraction không nhất thiết mutually exclusive:

```text
ExecutionStrategy = application-level HOW
Restate            = durable control/runtime option
Core Harness       = cognition/execution/evidence substrate used by the strategy
```

Restate's own durable multi-agent routing pattern cũng **không được kéo lên organization layer**. LLM routing giữa specialists có thể tồn tại bên trong một bounded domain strategy, nhưng không được trở thành cơ chế chọn next organizational domain.

`human-assisted` cũng không phải authority escape hatch: human session có thể giúp thực thi HOW, nhưng output vẫn phải quay qua cùng domain completion/write/acceptance gates; strategy kind không tự cấp product authority.

## 4.4 Không build generic strategy registry sớm

Integration B chỉ cần prove boundary bằng **một concrete domain policy + một concrete strategy adapter**.

Không cần trước B:

```text
universal StrategyRegistry
generic plugin marketplace
dynamic model-selected strategy
```

Cái cần chứng minh là:

```text
released claim
  -> domain-owned deterministic policy resolution
  -> exact immutable ExecutionAttemptBinding
  -> one concrete strategy
  -> grounded output
  -> unchanged domain/product acceptance semantics
```

Sau khi có evidence từ B–I mới generalize registry nếu có pressure thật.

---

# 5. E2E objective: “Build website”

Tao sẽ dùng concrete benchmark:

```text
Objective O-001

Build and deploy a small public catalog website.

User outcomes:
- visitor can see products
- visitor can open a product detail

Constraints:
- UI obtains catalog data from backend
- backend exposes health
- deployment is reproducible
- critical journey has automated acceptance evidence

No required implementation technology is specified.
```

Nó đủ mở để organization phải **interpret objective**, nhưng đủ concrete để cuối cùng verify được.

## RootIntent vs PM ProductObjective

`Objective O-001` ở benchmark phải trace về durable `RootIntent` do user/product owner establish. PM không sở hữu quyền rewrite root intent chỉ vì PM sở hữu product framing/scope coordination.

```text
RootIntent
  = externally authorized user/product-owner objective + non-negotiable constraints

ROOT_OUTCOME_SET
  = independently accepted, machine-addressable mandatory outcome ids
  + mandatory acceptance-obligation ids
  + exact RootIntent revision

PM ProductObjective / ScopeDecision
  = refinement/decomposition bound to exact RootIntent + ROOT_OUTCOME_SET
  + preservedOutcomeIds / preservedAcceptanceObligationIds

PM MAY:
  clarify scope
  decompose outcomes
  sequence/prioritize work
  narrow implementation choices when root obligations remain satisfied

PM MAY NOT:
  weaken/remove root user outcomes
  replace root acceptance obligations
  silently supersede RootIntent
  close against a different/older objective revision
```

`ROOT_INTENT_SCOPE_AUTHORITY` phải enforce bằng deterministic coverage: mọi mandatory id trong accepted `ROOT_OUTCOME_SET` phải còn được preserve trong `ScopeDecision`. **Integration B v1 không có policy-exception escape hatch cho mandatory root outcomes.** Vì vậy "PM không weaken root outcome" không phải self-report semantic check của chính PM.

Một legitimate mandatory-root-outcome change chỉ đi qua **new RootIntent / ROOT_OUTCOME_SET revision accepted by root/Product Owner authority**. Later waiver/policy-exception semantics ở Integration G có thể alter acceptance-policy treatment, nhưng **Policy waiver != RootIntent amendment** và không được erase mandatory root outcomes.

Các cụm root objective còn semantic như `reproducible`, `healthy`, `critical journey` phải được BA đóng băng thành machine-addressable `RequirementAcceptanceCriterion` ids + verifier/evidence expectations (hoặc `HUMAN_DECISION_REQUIRED` nếu không resolve được) trước khi QA dùng chúng. Objective closure bind exact current RootIntent + RootOutcomeSet + accepted ProductObjective/ScopeDecision revisions.

## Role-owned workloads

| Domain | Owns | Workload cho O-001 | Execution policy/strategy (replaceable) | Authoritative artifact |
| --- | --- | --- | --- | --- |
| PM | product framing, bounded scope decisions, priority, product outcome (under RootIntent) | product framing / coordination | understand objective → define outcomes/scope → monitor → replan/closure | `ProductObjective`, `ScopeDecision`, `ProductOutcomeClaim` |
| BA | business semantics | requirement analysis | discover → actors/use-cases → rules → acceptance semantics → reconcile | `RequirementSet` |
| SA | technical architecture | solution design | inspect requirements → research/tradeoff → architecture → interface constraints → architecture review | `ArchitecturePackage`, ADR/API contracts |
| FE | browser/product UI | feature delivery | resolve UI context → implement → unit/build → interaction/visual verification → claim | `FrontendDelivery` |
| BE | backend behavior | feature delivery | resolve repo/contracts → design → implement → test/runtime verification → claim | `BackendDelivery` |
| DevOps | runtime/deployment | environment/deployment | deployment requirements → infra/build → deploy → health/smoke → claim | `DeploymentRelease` |
| QA | product quality | acceptance | requirement-derived test model → gather exact delivery refs → E2E/regression → findings/acceptance | `QualityAcceptance` |

PM execution strategy có thể hoàn toàn khác Dev execution strategy.

BA execution strategy không cần code mutation.

QA không phải "dev nhưng prompt khác".

DevOps có runtime/effect/recovery semantics khác FE.

**Đây mới là bounded context thật.**

---

# 6. Runtime flow sẽ không phải pipeline, mà là causal artifact graph

Một successful run có thể trông như:

```text
                         ProductObjective
                              PM
                               │
                               ▼
                        RequirementSet
                              BA
                         ┌─────┴───────┐
                         │             │
                         ▼             ▼
                ArchitecturePackage   QA Test Model
                       SA                  QA
                 ┌─────┼──────┐
                 │     │      │
                 ▼     ▼      ▼
                FE     BE   DevOps env prep
                 │     │      │
                 │     │      │
                 ▼     ▼      │
              FE-r8  BE-r5    │
                 └─────┬──────┘
                       ▼
                DeploymentRelease
                    deploy-r3
                       │
                       ▼
                 QA execution
                against exact:
                  FE-r8
                  BE-r5
                deploy-r3
                       │
                       ▼
               QualityAcceptance
                       │
                       ▼
              ProductStateProjection
                       │
                       ▼
                  PM closure
```

Nhìn giống graph, nhưng **graph này là reconstructed causal graph**, không phải một global workflow script.

Ví dụ:

```text
ArchitecturePackage published
```

làm cho nhiều work trở nên actionable:

```text
FE feature workload
BE feature workload
DevOps environment workload
```

Ba domain tự claim work của mình.

Không có:

```js
await runSA()
await runBackend()
await runFrontend()
await runDevOps()
await runQA()
```

Đoạn code đó là anti-goal của phase.

---

# 7. Cross-domain interface: Artifact + Claim + Obligation

Tao nghĩ integration contract nên xoay quanh đúng ba loại concept này.

```text
Artifact
= thứ một domain đã tạo ra

Claim
= điều authority đó khẳng định về artifact/product state

Obligation
= thứ product state còn yêu cầu một authority nào đó giải quyết
```

Ví dụ:

```text
BA publishes

Artifact:
  RequirementSet:req-v3

Claim:
  REQUIREMENTS_READY
  subject: objective-001
  artifact: req-v3

Obligation:
  ARCHITECTURE_REQUIRED
```

SA:

```text
Artifact:
  ArchitecturePackage:arch-v2

Claim:
  ARCHITECTURE_ACCEPTED

Obligations:
  FRONTEND_DELIVERY_REQUIRED
  BACKEND_DELIVERY_REQUIRED
  DEPLOYMENT_REQUIRED
```

QA fail:

```text
Claim:
  QUALITY_REJECTED

Finding:
  product detail API response violates req-v3

Obligation:
  targetDomain: BACKEND
  subject: be-r5
```

BE sửa.

**Không reset toàn organization về "development stage".**

Chỉ Backend domain nhận remediation workload.

Sau đó downstream claims nào phụ thuộc `be-r5` trở thành stale:

```text
BE-r5 -> superseded by BE-r6

Deployment deploy-r3
  targeted BE-r5
  => stale

QA qa-r4
  tested BE-r5
  => stale
```

DevOps và QA tự xuất hiện workload mới từ dependency invalidation.

Cái này rất mạnh.

---

# 8. “Consensus” và PRODUCT DONE

Không có một agent:

```text
LLM: "Looks good. DONE."
```

Product state được **derive từ authoritative claims**.

Ví dụ acceptance policy của objective:

```yaml
required_authorities:
  requirements: BA
  architecture: SA
  frontend_delivery: FE
  backend_delivery: BE
  runtime: DEVOPS
  acceptance: QA

closure_authority:
  role: PM
```

Projection:

```text
requirements accepted
AND
architecture accepted
AND
frontend accepted
AND
backend accepted
AND
deployment healthy
AND
QA accepted exact deployed revisions
AND
no unresolved blocking obligations
------------------------------------
OBJECTIVE ELIGIBLE FOR CLOSURE
```

Sau đó PM có thể close objective theo product authority **chỉ khi closure subject bind vào exact current `RootIntent` revision + exact accepted `ProductObjective` revision**. PM closure không có authority để silently weaken root intent hoặc substitute một objective khác.

Nhưng PM **không được overwrite**:

```text
QA = REJECTED
```

thành:

```text
DONE
```

Chính xác hơn:

```text
specialist claims establish facts
policy composes readiness
PM exercises product closure authority
```

Đây là organizational consensus.

---

# 9. Oracle nằm ở đâu trong từng domain

Current Oracle semantics của ExHarness thực ra rất hợp architecture mới:

```text
Application/domain:
WHAT context is required

Oracle:
WHERE/HOW to resolve it
```

Giữ nguyên.

Ví dụ BA:

```text
BaWorkOrder
   ↓
BaContextRequirement
   ↓
Oracle
   ├─ objective ref
   ├─ previous product decisions
   └─ research/source refs
```

FE:

```text
FrontendWorkOrder
   ↓
Oracle
   ├─ RequirementSet
   ├─ design refs
   ├─ ArchitecturePackage
   ├─ API contract
   └─ frontend repository
```

QA:

```text
QaAcceptanceWork
   ↓
Oracle
   ├─ RequirementSet
   ├─ FE exact artifact
   ├─ BE exact artifact
   ├─ deployment endpoint/ref
   └─ acceptance policy
```

Oracle không biết:

```text
QA nên chạy chưa?
sau QA nên chạy PM không?
website done chưa?
```

Đó không phải Oracle concern.

A2A cũng reinforce design này: communication không nên trở thành source of truth; critical task output phải nằm ở artifact. ([A2A Protocol](https://a2a-protocol.org/dev/specification/?utm_source=chatgpt.com "Overview - A2A Protocol"))

---

# 10. Core Harness cũng tương tự

Core nằm **inside role execution**, không ở organization control plane.

```text
Frontend Domain
  Frontend feature execution strategy
        │
        └── Core Harness
              cognition
              tools
              evidence
              recovery
              typed judgments

Backend Domain
  Backend feature execution strategy
        │
        └── same Core Harness

BA Domain
  requirement-analysis execution strategy
        │
        └── Core Harness
```

NOOA research support khá mạnh cho abstraction này: harness nên provide typed I/O, pass-by-reference, explicit state và programmable loops; tức harness là substrate để mỗi workload xây loop phù hợp, chứ không ép mọi agent vào một loop duy nhất. ([NVIDIA Developer](https://developer.nvidia.com/blog/six-agent-harness-capabilities-for-higher-model-performance/?utm_source=chatgpt.com "Six Agent Harness Capabilities for Higher Model Performance | NVIDIA Technical Blog"))

Repo ExHarness hiện tại đã có phần lớn primitive này rồi.

Vì vậy **integration phase không nên bắt đầu bằng Core refactor**.

---

# 11. Current ExHarness có một seam phải xử lý

Current living boundary ở `docs/worktree/agentic-application/boundaries.md` vẫn assign:

```text
Work decomposition          -> Orchestrator (PM/Advisor may propose)
Which Worker executes       -> Orchestrator
Application workflow state  -> Orchestrator
```

Và `packages/agentic-system/src/durable-backend-qa.js` là một concrete cross-domain composition: nó giữ `BACKEND_PENDING`, `QA_PENDING`, `BACKEND_REMEDIATION_PENDING` và tự chọn stage Backend→QA→remediation. Đây là behavior hợp lệ của vertical hiện tại, nhưng **không thể lift nguyên khối thành một Backend-domain ExecutionStrategy** trong organization model mới.

Nếu chỉ bọc `createDurableBackendQaWorkflow(...)` bằng Restate rồi gọi nó là Backend strategy, cross-domain dispatcher vẫn tồn tại; nó chỉ bị giấu xuống execution layer. Rebase đúng là:

```text
REUSE:
  Backend objective/context preparation
  BackendWorker / Core effect recovery
  Backend completion/evidence semantics
  QA verifier/completion primitives where appropriate inside QA domain

DO NOT REUSE AS ONE DOMAIN STRATEGY:
  Backend->QA stage dispatcher
  cross-domain remediation routing
  combined vertical workflow as organizational control
```

Organization integration phải cắt boundary tại authoritative domain output/Claim + obligation. Backend strategy kết thúc ở Backend-owned output/evidence; QA organizational work chỉ xuất hiện qua authorized obligation/materialization/claim path. Internal Backend sub-agents/verifiers vẫn được phép nếu chúng không masquerade thành another organizational domain authority.

Nếu nâng nguyên current orchestration model thành toàn organization thì lập tức thành:

```text
Super Orchestrator
    ├─ PM
    ├─ BA
    ├─ SA
    ├─ FE
    ├─ BE
    ├─ DevOps
    └─ QA
```

=> quay lại super-agent architecture.

Integration phase phải **pressure-test và thu hẹp global Orchestrator authority**:

```text
ApplicationOrchestrator

KEEP:
- canonical Blackboard mutation
- fencing / CAS
- dependency integrity
- review state
- durable lifecycle transitions

DO NOT EXPAND INTO:
- choosing domain execution policy/strategy
- controlling role-local lifecycle
- deciding every next worker
- building one global workflow graph
```

Tương tự, **PM != Organization Scheduler**. PM có thể own product decisions/coordination, nhưng không được trở thành central dispatcher bằng cách chọn next domain/work dưới tên "materialization".

Role-domain controller + pinned ExecutionPolicy/ExecutionStrategy own local execution.

Blackboard owns shared organizational truth.

Đây theo tao là **architecture decision chính của BB integration phase**.

---

# 12. Observe plane — instrumentation bắt đầu từ B, Integration I chỉ aggregate

Nếu tới Integration I mới bắt đầu ghi execution identity thì J không có history để học.

Từ **Integration B trở đi**, mọi domain execution attempt phải emit durable/correlatable provenance đủ để tách:

```text
WHAT work semantics?
HOW executed?
WITH WHICH policy/config?
WHAT outcome?
```

Causal chain:

```text
objective
 ↓
organizational work
 ↓
released claim
 ↓
ExecutionAttemptBinding
 ↓
ExecutionPolicy
 ↓
ExecutionStrategy
 ↓
runtime invocation
 ↓
artifact / verification
 ↓
Claim
 ↓
dependent work
 ↓
product outcome
```

Minimum provenance nên chia layer:

```text
Organizational identity
───────────────────────
objectiveId
workId
domain
workloadType
workContractRef
claimReceiptRef
upstreamRefs

Execution decision
──────────────────
executionAttemptId
executionPolicyRef / revision
strategyKind
strategyId
strategyVersion
runtimeBindingRef
runtimeInvocationId
runtimeDeploymentId?   # when the adapter exposes one

Execution configuration
───────────────────────
contextPolicyRef
toolsetRef
modelProfileRef
harnessRef / harnessVersion
domainControllerVersion

Outcome
───────
artifactRefs
verificationRefs
acceptanceDecisionRefs
duration
cost
retryCount
remediationRound
terminal execution status
traceId
```

Runtime-specific telemetry không thay organizational provenance. Ví dụ Restate có invocation IDs/journal/logging/traces; ExHarness vẫn phải correlate chúng về `executionAttemptId + workId + strategyRef`.

Metrics có value hơn kiểu “agent success rate”:

```text
objective cycle time
role waiting time
blocked duration
handoff latency
requirement churn
architecture churn
first-pass acceptance
QA reopen rate
artifact staleness
context-resolution failure
remediation loops
strategy retry/recovery count
strategy cost
verification cost
```

Ví dụ:

```text
FE execution = 8 min
FE waiting architecture clarification = 47 min
```

Organization bottleneck là 47 phút, không phải model FE chậm.

**Integration I không phải "add observability".** I phải consume history B–H để reconstruct/aggregate causal graph, validate completeness và expose organization-level metrics. Nếu B–H không emit đủ execution provenance thì I phải fail chứ không invent missing history.

---

# 13. Self-improve loop — evolve HOW, không đổi goalpost

Current BB-034 boundary vẫn là nền đúng: candidate không được thay evaluator, acceptance gate, user intent hay rollout authority của chính nó.

Rebase mới làm target của improvement rõ hơn:

```text
delivery loop
ProductObjective
 → organizational work semantics
 → ExecutionAttemptBinding
 → ExecutionStrategy
 → artifact / evidence
 → product outcome

improvement loop
Execution history + organization telemetry
 → Observation
 → Finding
 → exact target layer
 → Candidate
 → replay / benchmark / independent eval
 → propose promotion or keep baseline
```

Ví dụ:

```text
Observation:
60% Backend feature-delivery remediation originated from API-contract mismatch.

WHAT failed?
  Backend.feature-delivery

HOW executed?
  strategy backend-feature@v3

WHY?
  contextPolicy@v7 did not resolve accepted API contract before implementation.
```

Candidate có thể target đúng layer:

```text
ContextPolicyCandidate contextPolicy@v8
```

hoặc:

```text
ExecutionStrategyCandidate backend-feature@v4
```

nhưng candidate **không được đổi**:

```text
BACKEND_DELIVERY_REQUIRED
BackendDelivery semantics
work acceptance contract
RootIntent
review/evaluator authority
```

Evaluation:

```text
baseline:
  same workload contract
  same acceptance semantics
  strategy/context baseline refs

candidate:
  same workload contract
  same acceptance semantics
  candidate HOW refs

replay historical workloads
+ website benchmark
+ regression corpus
+ fixed budget
+ independent evaluator

=> PROPOSE_PROMOTION | KEEP_BASELINE
```

Một strategy không mutate in-place khi promote. Promotion tạo immutable strategy descriptor mới + **ExecutionPolicy revision/head mới** reference descriptor đó. Chỉ **new ExecutionAttemptBindings** resolve policy head mới; in-flight attempt recovery giữ exact binding cũ. Existing accepted product artifacts/Claims không tự stale chỉ vì execution strategy baseline đổi; strategy là HOW, không phải product truth.

Integration J vì thế không phải feature cuối "add self improvement". B–I phải design-for-observation; J chỉ **khép evolutionary loop** bằng một failure thật từ accumulated execution history.

```text
B–H
  emit attempt bindings/outcomes/provenance
      ↓
I
  reconstruct + aggregate
      ↓
J
  select one grounded finding
  -> candidate HOW change
  -> fixed replay/eval
  -> independent promotion proposal
```

Reuse existing self-upgrade proposal boundary. Không build một autonomous rollout authority mới.

---

# 14. Research workload phải terminate bằng implementation artifact — nhưng researcher không tự authorize implementation

Integration phase hiện tại đang ở **research phase**. Terminal output của workload này không được chỉ là architecture note hay decision dump. Nó phải là một implementation artifact đủ concrete để một implementation consumer hiểu scope, seam, invariants, evidence, trade-off và verification contract.

Nhưng có một boundary quan trọng hơn:

```text
research producer
  != acceptance authority
```

Current ExHarness research continuation đã có semantics đúng:

```text
research result
  -> decisionStatus = PROPOSED
  -> Blackboard = PENDING_REVIEW
  -> independent research-workflow review
```

Research producer không được tự ghi `IMPLEMENTATION_READY` rồi coi đó là authority. Output đúng của research loop là **candidate implementation artifact**; implementation chỉ được authorize sau independent review/decision trên exact artifact ref.

```text
ResearchWorkload
      │
      ▼
research / inspect / compare / prototype
      │
      ├───────────────┐
      │ evidence gap  │
      ▼               │
more research ◄───────┘
      │
      ▼
Candidate ImplementationArtifact
      │
      ▼
PROPOSED + PENDING_REVIEW
      │
      ▼
Independent readiness review / decision
      │
      ├── REJECT / INCONCLUSIVE -> research reopens
      │
      └── ACCEPT -> implementation may be materialized
```

Loop phía trên là research execution loop nội bộ. Nó không phải global organization workflow.

## 14.1 Candidate ImplementationArtifact contract

Một artifact đủ để bước vào readiness review phải mang ít nhất:

```yaml
kind: IntegrationImplementationArtifact
version: v1
projectId: <stable project>
rootIntentId: <durable intent>
researchItemId: <research work item>
sourceRevision: <inspected source revision>
policyRevision: <research/acceptance policy revision>

evidenceRefs:
  - <source evidence>
  - <external evidence>

decisions:
  - key: <decision>
    selected: <selected alternative>
    rejected: [<rejected alternatives>]
    rationaleRef: <evidence/tradeoff ref>

invariants:
  - Role != Pipeline
  - Organization != Workflow
  - Workload != Workflow
  - WorkContract != ExecutionPlan
  - ExecutionPolicy != Work Scheduler
  - ExecutionStrategy != Product / Write Authority
  - Execution strategy may evolve; work semantics may not silently evolve with it
  - Blackboard != Scheduler
  - Oracle != Coordinator
  - Core != Product Authority
  - Message != Authoritative Output
  - Research producer != acceptance authority
  - PM != Organization Scheduler
  - Artifact acceptance != blanket obligation authorization
  - Caller asserted domain != execution authority
  - ClaimReleaseHead.FENCED != Blackboard lifecycle transition
  - Authority invalidation must have one canonical durable Board consequence
  - Authorization grant != permanent claimability
  - Materialization replay != duplicate organizational work
  - OrganizationWorkMaterializer != Execution Resolver
  - Activation != Scheduling
  - ApplicationOrchestrator != Domain Execution Controller
  - Claim assertion payload is immutable
  - Policy waiver != RootIntent amendment
  - Historical ProductOutcomeClaim != current DONE
  - ProductStateProjection != Product Authority

acceptance_model:
  - exact revision lineage is explicit and verifiable
  - dependency supersession deterministically marks affected downstream claims stale
  - crash/restart reconstructs the same project/work state from durable state + refs
  - no shared conversation is required for continuation or correctness
  - rejected work produces local bounded remediation rather than whole-organization restart
  - objective readiness is derived deterministically from authoritative current claims
  - ProductStateProjection can be deleted/rebuilt from complete pinned inputs without deleting or changing organizational truth
  - phase benchmark declares bounded time/cost/execution budgets; no remediation or verification loop is unbounded

implementationSlices:
  - key: implement-integration-a1
    sourceChanges: [<exact package/file seams>]
    verification: [<executable contracts>]
    dependsOn: []

runtimeFixtureObligations:
  - key: fixture-ba-requirement-analysis
    fixtureId: <bridge acceptance fixture>
    owningDomain: BA
    workloadType: requirement-analysis
    issuerDomain: <root/application fixture authority>
    obligationKind: REQUIREMENT_ANALYSIS_REQUIRED
    targetDomain: BA
    derivationRefs: [<fixture root/evidence/policy refs>]
    summary: <bounded runtime work used only after A.1 exists>
    dependsOn: []
    expectedArtifactKind: RequirementSet
    acceptanceRefs: []

unresolved:
  - key: <open mechanism>
    blocksBefore: <integration slice>
    nonBlockingForFirstSliceBecause: <explicit reason or null>
```

Nó là bridge contract, không phải backlog dump.

Điểm khác với bản trước là `unresolved` không được phép là câu mơ hồ kiểu:

```text
only questions proven non-blocking
```

Mỗi gap phải nói rõ **nó block trước slice nào** và **vì sao chưa block slice hiện tại**.

`invariants` là phần **đã chốt và không được downstream implementation tự diễn giải lại**. Independent reviewer phải dùng chúng như hard review checks, không phải prose định hướng. Một candidate hoặc implementation obligation vi phạm invariant thì phải bị reject/reopen thay vì “trade-off” lại ngầm trong implementation.

`acceptance_model` là **positive proof contract**: nó không nói kiến trúc phải được implement bằng cơ chế nào, nhưng nói các implementation slice cuối cùng phải chứng minh được hành vi nào. Vì vậy một candidate có thể giữ đủ invariants mà vẫn chưa đủ để accept nếu nó không bảo toàn exact lineage, stale propagation, durable reconstruction, conversation independence, local remediation và deterministic readiness.

## 14.2 Ai có quyền authorize implementation?

Không phải research worker.

Research worker chỉ được:

```text
produce candidate artifact
submit resultRef
carry evidence refs
request/receive required independent review
```

Current ExHarness đã có `research-workflow` review requirement và trusted review lifecycle. Vì vậy BB-046 nên reuse đúng path đó:

```text
candidate artifact
  -> submitProposal(... decisionStatus=PROPOSED ...)
  -> PENDING_REVIEW
  -> beginReview(... reviewer = configured independent authority)
  -> trusted assessment
  -> existing project decision/promotion boundary
```

PM có thể **require/transport** review obligation; PM requirement không tự biến thành verdict. Orchestrator vẫn là lifecycle authority; reviewer/evaluator/trust rules vẫn phải đi qua boundary hiện tại.

Accepted/promotion decision phải bind **exact artifact ref/digest/revision** và explicit **implementation-slice scope**. Đây là authority để existing ExHarness delivery path implement source slice A.1; nó **không** dùng `OrganizationWorkMaterializer` (component đó chưa tồn tại trước A.1) và không tự authorize runtime organizational work.

Sau khi A.1 code tồn tại, bridge acceptance fixture dùng một **separate runtime materialization authorization**. Runtime executable scope dùng immutable authorization lineage, không phải một scope blob sống mãi:

```yaml
MATERIALIZATION_AUTHORIZATION_GRANT v1:
  authorizationId: <stable authorization subject>
  generation: <monotonic positive integer>
  projectId: <project>
  rootIntentId: <intent>
  acceptedDecisionRef: <exact trusted acceptance/promotion decision>
  implementationArtifactRef: <exact candidate ref/digest/revision>
  authorizedSliceIds: [integration-a1-runtime-fixture]
  authorizedObligationKeys: [<exact keys>]
  issuedByAuthorityRef: <authority ref>
  authorityPolicyRevision: <pinned policy/model revision>
```

Revocation/supersession là immutable event/artifact riêng trên cùng `authorizationId` + next generation. Không có wildcard/implicit-all. Empty scope authorize zero work.

Materialization **và claim/execution entry** đều phải resolve current authorization head/generation với consistency phù hợp cho revoke-sensitive check. Revoked/superseded authorization làm linked non-terminal work non-claimable; claim-vs-revoke race phải được fenced ở canonical Board generation. Authorization grant vì thế không đồng nghĩa permanent claimability.

Nhưng reuse lifecycle **không đồng nghĩa reuse một review scope bất kỳ là đủ**. Current inspected source chứng minh `research-workflow` lifecycle có independent review fencing, nhưng **không chứng minh reviewer scope hiện tại đủ cho một candidate định nghĩa organization authority model + contract boundary ở quy mô phase-level**. Vì vậy readiness review này phải chứng minh reviewer/evaluator scope thực sự cover được ít nhất:

```text
organizational authority model
Blackboard/application boundary
contract and provenance model
first-slice source seams
known unresolved blocking matrix
hard invariants
```

Nếu configured reviewer chỉ có scope cho một research finding hẹp, một `PASS` từ path đó không đủ trọng lượng để authorize BB-046. Khi đó phải require thêm architecture/application authority review hoặc reopen review configuration. **Existing lifecycle is reused; review adequacy is itself a condition, not an assumption.**

`review adequacy` không phải checklist để chính reviewer tự tick. Với BB-046 nó có hai lớp:

```text
machine-checkable before dispatch:
  exact candidate ref/digest/revision
  expected reviewer/evaluator identity
  required review-scope keys declared by the BB-046 review requirement
  policy/review generation freshness

project-authority configuration:
  selected reviewer/evaluator is actually authorized for those scope keys
  (organizational authority, application boundary, contract/provenance, source seams)
```

Nếu current review configuration không có scope-bearing reviewer profile/authority metadata đủ để machine-check coverage, BB-046 phải add an explicit architecture/application review requirement; reviewer không được tự attest "tôi đủ scope" để satisfy gate.

## 14.3 Blackboard generic vs external role/work contract — bounded decision, không phải dogma

Decision candidate cho first bridge slice là:

```text
Blackboard
  = lifecycle + dependencies + continuation + reviews + provenance + refs

ORGANIZATION_WORK_CONTRACT
  = owningDomain + workloadType + exact input/output/acceptance semantics
```

Không thêm ngay:

```text
role
domain
workloadType
pipelineId
```

vào generic Blackboard item.

### Lý do chọn external contract ở first slice

```text
+ giữ nguyên delivered Blackboard contract
+ không canonicalize organization model từ đúng một consumer
+ role/workload contract có version/content identity riêng
+ rollback local ở application layer
```

Nhưng trade-off phải ghi thẳng:

```text
- query domain cần dereference/index
- Blackboard tự nó không enforce domain authority
- ProductStateProjection không thể query native role column
- invalidation phải dựa vào typed artifact/claim lineage
```

Do đó `owningDomain` trong ref **không được biến thành honor system**. First bridge slice phải có application authorization gate:

```text
OrganizationWorkClaimController
  -> obtain trusted ExecutionPrincipal from application/infrastructure boundary
  -> resolve CURRENT durable ExecutionAuthorityPolicyHead(policyId)
       { generation, status, policyRef }
  -> derive authorizedDomains(principal) from exact current immutable policyRef
  -> resolve exact ORGANIZATION_WORK_CONTRACT
  -> validate project/root/item binding
  -> require owningDomain ∈ authorizedDomains(principal)
  -> precheck current MATERIALIZATION_AUTHORIZATION head/generation
  -> re-read current Board eligibility
  -> derive Board owner/execution identity from trusted principal
  -> delegate ApplicationOrchestrator.claim(...) => provisional claimGeneration N
  -> recheck Board claim + both authority heads
  -> persist immutable CLAIM_RELEASE_RECEIPT bound to N + exact auth/policy generations
  -> CAS publish ClaimReleaseHead(itemId,N) -> receiptRef
  -> final recheck heads before returning usable receipt

Caller-provided `requestedDomain` may be logged as a hint but is never authorization input. A non-BA principal that sends `requestedDomain=BA` must still fail closed. `CLAIMED` without a current release-head receipt is non-executable.
```

`ApplicationOrchestrator` vẫn sở hữu mutation; organizational layer sở hữu domain authorization trước mutation.

Decision này chỉ scoped cho first bridge slice. Integration G phải dùng evidence thật từ product projection/invalidation để đánh giá có cần native index/schema change hay không.

## 14.4 Governance của `ORGANIZATION_WORK_CONTRACT`

Nó không phải static config nằm ngoài governance model.

### Authorization lifecycle

Artifact acceptance và executable work authorization là hai authority khác nhau. Authorization dùng immutable generation lineage:

```yaml
MATERIALIZATION_AUTHORIZATION_GRANT v1:
  authorizationId: auth-bb046-a1
  generation: 1
  projectId: <project>
  rootIntentId: <root>
  acceptedDecisionRef: <exact trusted decision>
  implementationArtifactRef: <exact artifact ref/digest/revision>
  authorizedSliceIds: [integration-a1-runtime-fixture]
  authorizedObligationKeys: [<exact obligation key>]
  issuedByAuthorityRef: <authority>
  authorityPolicyRevision: <exact revision/model id>

MATERIALIZATION_AUTHORIZATION_REVOCATION v1:
  authorizationId: auth-bb046-a1
  generation: 2
  revokesGrantRef: <generation-1 grant ref>
  issuedByAuthorityRef: <authority>
  authorityPolicyRevision: <exact revision/model id>
  reasonRef: <durable reason>
```

Grant/revocation payloads immutable. Grant/revocation issuer identity must be derived/verified through the trusted `organizationAuthority` adapter (same trust-boundary pattern as existing review authority checks); `issuedByAuthorityRef` is provenance, not a bearer capability. Current authorization status được derive từ một **durable CAS-fenced authorization head** (`authorizationId -> generation/status/ref`), không từ mutable boolean trong artifact payload. A.1 cần một narrow `OrganizationAuthorizationStore`/equivalent head index survive restart; content-addressed artifacts alone không prove which generation is current.

```text
artifact accepted
!= obligation authorized
!= authorization still active now
```

### Deterministic work identity / exactly-once logical materialization

Content-addressed work contract chỉ chống duplicate **payload**; nó không tự chống duplicate Board work. Vì vậy v1 cần hai identity:

```text
obligationSubjectKey
  = H(projectId, rootIntentId, implementationArtifactRef, obligationKey)

materializationKey
  = H(obligationSubjectKey, acceptedDecisionRef, authorizationGrantRef)
```

Rules:

```text
same materializationKey concurrent/retry -> same Board item + same commit receipt
one live Board item max per obligationSubjectKey
same subject + conflicting contract/decision/grant -> fail closed
replacement after supersession/revocation -> new authorized materialization with preserved provenance
caller cannot choose arbitrary Board item id to bypass uniqueness
```

### Publication and revoke race

```text
1. resolve exact current authorization grant/head under pinned authority policy
2. derive immutable ORGANIZATION_WORK_CONTRACT + identity keys
3. persist content-addressed contract
4. ApplicationOrchestrator.materializeAcceptedWork(...) transaction:
   - accept the exact prechecked authorization-head generation as an expected fence
   - enforce unique obligationSubjectKey/materializationKey
   - derive/validate canonical Board item identity
   - create READY item + exact contract/auth refs atomically
   - return provisional durable Board receipt
5. post-commit re-read authorization head:
   - if same ACTIVE generation -> release materialization receipt
   - if drift/revoked -> immediately fence/supersede the just-materialized item and fail closed
```

Crash after contract put but before Board commit leaves orphan payload only; orphan has no authority. Retry uses same materializationKey and converges to same Board work.

Authorization revoke after materialization but before claim must fence/supersede linked non-terminal work. Because authorization head and Board are separate durable surfaces, a **single pre-check is not enough**. Claim uses a bounded optimistic handshake:

```text
precheck auth head + execution-authority policy head
 -> Board claim transaction (provisional claim generation)
 -> post-commit recheck both heads
      unchanged -> release usable claim receipt to domain
      drift/revoked -> fence the just-claimed generation + fail closed
```

A domain execution controller may start only from a released claim receipt and must revalidate authority again at execution entry. Thus a revoke/policy change that races between stores cannot silently release stale execution capability.

`OrganizationWorkMaterializer` tuyệt đối không chọn next work/domain/execution strategy. It copies exact `owningDomain`, `workloadType`, dependencies, expected artifact kind và acceptance refs từ authorized obligation. `ExecutionPolicyRef`, `ExecutionStrategyRef` và runtime binding không tồn tại trong work contract.

Nếu work contract phải đổi: no in-place edit; supersede unfinished work under lifecycle authority, require a fresh valid authorization as needed, materialize replacement, preserve history.

### Trusted domain identity

`owningDomain` trong work contract là authorization target, không phải proof về caller. Claim gate bắt buộc trusted `ExecutionPrincipal -> authorizedDomains` mapping ở pinned authority policy/model revision. Domain string do caller tự gửi không cấp capability.

### Durable execution-authority policy currentness

A.1 phải có narrow durable head giống materialization authorization currentness:

```text
EXECUTION_AUTHORITY_POLICY artifact = immutable mapping/model
trusted organizationAuthority adapter verifies/derives policy publisher identity
ExecutionAuthorityPolicyHeadStore:
  policyId -> { generation, status, policyRef }
  compareAndSetHead(policyId, expectedGeneration, nextPolicyRef/status)
  resolveCurrent(policyId) survives fresh process
```

Claim/release provenance pin exact `policyId + generation + policyRef`. `issuedByAuthorityRef` is derived only after `organizationAuthority.verifyExecutionAuthorityPolicyPublisher(...)`; a worker cannot mint policy authority by filling that field. Khi head advance để revoke membership, old policy ref còn là history nhưng không còn là current authority. External authorization systems cũng version immutable models and recommend pinning exact model identity for consistent checks; v6 applies that principle locally without introducing a generic IAM service.

### Durable claim-release capability

Release subject:

```text
claimReleaseSubjectKey = H(projectId, itemId, claimGeneration)
ClaimReleaseHead(subject) -> { RELEASED | FENCED, receiptRef }
```

Receipt pins exact principal/work/auth-policy generations. Crash before head commit leaves only provisional `CLAIMED`; crash after head commit is reconstructable. Execution entry always revalidates Board claim generation + materialization head + execution-authority policy head; release is not a bearer token that survives revocation.

`ClaimReleaseHead.FENCED` is capability currentness only. Nó **không** release Blackboard ownership. Authority invalidation therefore has one explicit canonical lifecycle transition:

```text
invalidateOrganizationClaim(
  exact itemId + owner + claimGeneration,
  immutable invalidationRef,
  invalidationKind
)
```

State semantics:

```text
executor/principal authority lost
or provisional claim abandoned
  CLAIMED(N) -> REOPENED
  owner cleared
  invalidationRef atomically linked

work/materialization authorization lost
  CLAIMED(N) -> BLOCKED
  owner cleared
  exact authorization blocker/invalidationRef atomically linked
```

Canonical ordering:

```text
Board lifecycle invalidation commits FIRST
  -> exact CLAIMED tuple is no longer executable

ClaimReleaseHead fence SECOND
  -> idempotent cleanup/currentness for historical claim subject N
```

This ordering is deliberate: a crash after Board invalidation but before release-head fencing cannot revive execution because execution entry first requires the exact Board `CLAIMED` tuple. A fresh process can fence the stale release head later. Generic `recoverClaim(...)` is not revocation semantics; it means claimed-work takeover and keeps work `CLAIMED`.

Invalidation is monotonic for safety: if a later policy revision re-authorizes the principal, the old claim is not resurrected. The domain must obtain a new ordinary claim/release against the newer current heads.

## 14.5 Event-driven/blackboard vs BSP phase barrier

BSP có một ý rất cụ thể: computation đi theo superstep và barrier synchronization là non-local synchronization primitive. Pattern này hữu ích nếu mình **muốn** toàn bộ participants sync theo phase.

Nhưng global organization barrier kiểu:

```text
all analysis done
  -> BARRIER
all development done
  -> BARRIER
all testing done
```

sẽ đưa architecture quay lại global-stage semantics và bắt domain độc lập chờ slowest participant.

Vì vậy candidate direction là:

```text
shared-state / obligation-driven autonomy
+ explicit dependencies
+ bounded local synchronization barriers khi một integration boundary thật sự cần coherent snapshot
```

Không dùng global BSP làm organization control plane.

Điều này không có nghĩa "không barrier bao giờ". QA exact-revision acceptance có thể cần một **local acceptance snapshot/barrier** để pin FE/BE/deployment refs trong một lần đánh giá mà không freeze toàn organization. Exact mechanism vẫn là open research trước Product QA.

## 14.6 Mười hai mechanism gap còn mở — explicit blocking matrix

| Gap | First bridge | Vì sao chưa block bridge | Block trước | Output cần có |
| --- | --- | --- | --- | --- |
| Domain wake-up trigger | OPEN | A.1 explicit/pull invocation only. | **Integration D autonomy gate** | `DOMAIN_ACTIVATION`; `Activation != Scheduling`; duplicate/idempotency/restart. |
| Domain execution-control ownership | OPEN | A.1 stops immediately after authorized claim. Current source still says Orchestrator selects which Worker executes. | **Integration B** | `DOMAIN_EXECUTION_CONTROL`: Orchestrator lifecycle only; owning-domain controller owns durable `ExecutionAttemptHead`, resolves exact claimed workload through immutable `ExecutionPolicy -> ExecutionStrategyRef -> ExecutionAttemptBinding`; strategy adapter proves exact runtime binding and emits provenance. Restart/takeover reuses current semantic attempt; only explicit remediation/lifecycle authority advances attempt identity. |
| Domain write-scope authority | OPEN | A.1 performs no role work. | **Integration B exit; reusable before C** | enforced PM/BA writer gates + later `DOMAIN_WRITE_AUTHORITY`. |
| Cross-domain obligation issuance authority | OPEN | A.1 consumes one pre-authorized obligation only. | **Integration C** | allowed obligation kinds/target domains/derivation refs + receiving gate. |
| Root intent / scope authority | OPEN | A.1 does not exercise PM product scope. | **Integration B** | `ROOT_INTENT_SCOPE_AUTHORITY`; B v1 has no policy-exception bypass for mandatory roots. |
| Dependency/Claim lineage + transitive invalidation | OPEN | A.1 has no downstream product-Claim graph. | **Integration C** | `DEPENDENCY_INVALIDATION`: immutable refs, supersession/revocation, affected-scope propagation, CAS/recovery. |
| Product-history completeness / projection subject | OPEN | No product projection in A.1. | **Integration G** | canonical append-only product history/head or equivalent completeness proof; projection derives current sets, caller cannot choose `current*Refs`. |
| Remediation timeout/escalation + external human decision | OPEN | No remediation loop in A.1. | **Integration F exit / H preflight** | bounded attempt/time/cost + terminal BLOCKED + `HUMAN_DECISION_REQUIRED`. |
| QA exact-revision freeze | OPEN | No QA/deployment in A.1. | **Integration F preflight** | `AcceptanceSnapshot` + observed runtime identity evidence. |
| PM waiver vs prohibited override | OPEN | No product closure in A.1. | **Integration G closure gate** | waiver artifact/policy authority; waiver cannot amend RootIntent. |
| Post-closure invalidation/currentness | OPEN | A.1 cannot close product. Current Board source does not provide a general terminal-DONE supersession primitive. | **Integration G/H** | immutable snapshot-relative `ProductOutcomeClaim`; new history head makes old closure non-current; bounded revalidation/remediation work or separately reviewed terminal-reopen primitive. |
| Execution-strategy/policy drift during self-improvement | OPEN | No post-claim execution or candidate promotion in A.1. | **Integration J/self-improvement** | immutable strategy descriptors + workload-contract compatibility + fixed-work-semantics replay/eval; promotion changes HOW for new attempts only. |

Tức candidate hiện tại không tự claim các gap trên đã solved. A.1 review chỉ được accept nếu sáu bridge-specific authority mechanisms **không còn là gap** trong implementation contract: trusted principal mapping, durable execution-authority-policy currentness, authorization generation/revocation revalidation, deterministic materialization identity, durable claim-release capability/reconstruction, và canonical authority-revocation -> Blackboard lifecycle invalidation.

## 14.7 Bootstrap boundary: implementing A.1 != running A.1

Không self-host bridge trước khi bridge tồn tại.

```text
BB-046 accepted for implementation slice `implement-integration-a1`
  -> EXISTING ExHarness project-delivery / Blackboard lifecycle
  -> developers/implementation worker deliver A.1 source changes
  -> A.1 code exists
  -> only now create bridge acceptance fixture:
       RootIntent fixture + fixture obligation
       + ACTIVE MATERIALIZATION_AUTHORIZATION_GRANT
  -> OrganizationWorkMaterializer
  -> BA-owned ORGANIZATION_WORK_CONTRACT
  -> trusted BA-principal claim
```

`MATERIALIZATION_AUTHORIZATION` là **runtime bridge authority**, không phải mechanism để create the coding task that implements the materializer itself.

A.1 verification dừng sau authorized BA claim; BA chưa chạy requirement analysis.

Integration B sau đó mới dùng real product objective:

```text
RootIntent + ROOT_OUTCOME_SET
  -> PM ProductObjective / ScopeDecision
  -> BA requirement-analysis work
  -> BA domain execution
  -> RequirementSet
```

Điều này giữ đúng yêu cầu research output là implementation artifact: `implementationSlices[]` cho implementation consumer exact source seams/tests, còn `runtimeFixtureObligations[]` chỉ test system-under-construction sau khi A.1 tồn tại.

## 14.8 Current output of this research loop

Artifact hiện đã được sửa thành:

```text
bb046-organizational-integration-implementation-artifact.md
status: PROPOSED — AWAITING INDEPENDENT REVIEW
producer assessment: candidate for first research-to-role-work bridge only
full integration readiness: NOT CLAIMED
```

Artifact có:

```text
source evidence ledger
external evidence refs
selected + rejected alternatives
Blackboard-generic-vs-external-contract tradeoff
global-BSP rejection + local-barrier boundary
ORGANIZATION_WORK_CONTRACT governance
domain claim authorization seam
ten unresolved mechanism gaps + blocking slice
first-bridge verification contract
```

Tức research loop đã produce được **candidate implementation artifact**. Nó chưa có authority để tự nói `IMPLEMENTATION_READY`.

# 15. Plan triển khai integration phase

Các wave dưới đây là **thứ tự phát triển ExHarness**, không phải runtime lifecycle của organization.

### Integration A — BB-046 research + independent readiness decision

Đây là **BB-046**. Research không fabricate toàn bộ integration backlog và không self-authorize implementation.

Research producer phải publish:

```text
IntegrationImplementationArtifact:v1
status = PROPOSED
+ evidence trail
+ selected/rejected alternatives
+ tradeoffs
+ hard invariants
+ explicit unresolved blocking matrix
+ first-bridge verification contract
```

Sau đó artifact đi qua existing independent `research-workflow` review/decision boundary.

Exit condition của BB-046:

```text
candidate implementation artifact exists
AND exact artifact is evidence-backed
AND reviewer can derive the first bridge work without chat reinterpretation
AND independent review/decision accepts the exact artifact
AND accepted decision explicitly scopes SOURCE IMPLEMENTATION to `implement-integration-a1` only
AND no runtime organizational obligation is considered authorized merely because the research artifact was accepted
```

Không có producer-issued `IMPLEMENTATION_READY` claim.

### Integration A.1 — Research-to-role-work bridge implementation

**Bootstrap rule:** A.1 source code is delivered through the **existing/human-authorized** ExHarness project-delivery process. The current source does not establish a generic post-acceptance research→implementation auto-materialization primitive, so this document does **not** claim one. The not-yet-built `OrganizationWorkMaterializer` never creates its own implementation task.

Delivery plane:

```text
accepted BB-046 decision scoped to implementationSlices[implement-integration-a1]
 -> explicit existing/human-authorized implementation handoff
 -> implement authorization store/gate + materializer + claim gate + tests
 -> A.1 code exists
```

System-under-test plane (only after code exists):

```text
bridge fixture RootIntent
 + exact runtime fixture obligation
 + ACTIVE Integration-A.1-runtime-fixture authorization grant/generation
 -> OrganizationWorkMaterializer
 -> immutable ORGANIZATION_WORK_CONTRACT
 -> exactly one canonical Board work identity
 -> domain-local discovery
 -> trusted ExecutionPrincipal authorization
 -> ApplicationOrchestrator.claim(...)
```

Slice dừng sau claim; không chạy BA requirement analysis.

A.1 exit phải prove:

```text
bootstrap separation
- no A.1 component is required to create the work item that implements itself
- accepted research implementation scope != runtime materialization authority
- runtime fixture grant exists only for post-build bridge verification

principal authority
- caller-supplied requestedDomain is never authoritative
- trusted principal -> authorizedDomains(currentExecutionAuthorityPolicyHead) controls claim
- current execution-authority policy revision is recorded in claim provenance
- organization-managed Board owner is canonical durable principal identity (or reversible durable mapping), not caller alias
- principal/domain membership revocation before claim takes effect; old policy revision cannot be replayed
- non-BA principal cannot claim BA work even if request says BA

authorization lifecycle
- runtime grant binds exact decisionRef + fixture artifact/root + slice/key + authorityPolicyRevision + generation
- revoked/superseded grant cannot materialize new fixture work
- revoke after materialization before claim makes work non-claimable
- claim/materialize use precheck -> Board mutation -> post-commit authority-head recheck

claim invalidation lifecycle
- ClaimReleaseHead.FENCED alone is never treated as Board lifecycle release
- execution-principal/policy revocation on exact CLAIMED tuple -> REOPENED + owner cleared + invalidationRef linked
- work/materialization authorization invalidation -> BLOCKED + owner cleared + exact blocker/invalidationRef linked
- Board invalidation commits before release-head fencing
- crash after Board invalidation before release-head fence remains non-executable and reconstructable
- crash after Board claim before release publication is reconciled from durable Board owner + current heads: same generation is released if still authorized, otherwise canonically invalidated
- crash before invalidation is reconciled by a fresh `reconcileOrganizationClaimAuthority(...)` path, not chat/context reconstruction
- concurrent recover/takeover vs invalidation is fenced by exact owner/generation; stale loser re-resolves current authority/state
- another authorized principal can claim only after REOPENED commit, receiving a later claimGeneration

materialization identity
- obligationSubjectKey and materializationKey are deterministic
- concurrent identical fixture materializations return same Board item/commit receipt
- no two live Board items can represent one obligationSubjectKey

execution boundary
- materializer cannot resolve ExecutionPolicy/ExecutionStrategy
- exact HOW is resolved only later by owning-domain controller from a released claim and persisted as ExecutionAttemptBinding

crash/recovery
- orphan work-contract payload has no authority
- attach failure exposes no partial Board work
- fresh session reconstructs exact grant/generation/work identity
- no shared conversation required
```
### Integration B — PM + BA product vertical

Canonical flow:

```text
RootIntent + ROOT_OUTCOME_SET
 → PM ProductObjective / ScopeDecision
 → authorized BA requirement-analysis work
 → BA pull-discovers + claims as trusted BA principal
 → released claim receipt
 → BA DomainExecutionController
      -> resolve exact BA ExecutionPolicy revision
      -> resolve ExecutionStrategyRef
      -> persist ExecutionAttemptBinding
      -> execute concrete strategy
      -> persist ExecutionAttemptOutcome/provenance
 → RequirementSet + RequirementAcceptanceCriterion ids
 → PM observes progress
```

Preconditions:

```text
ROOT_INTENT_SCOPE_AUTHORITY accepted
DOMAIN_EXECUTION_CONTROL accepted for concrete PM/BA vertical
accepted ROOT_OUTCOME_SET binds exact RootIntent revision
mandatory root outcomes may change only by root-authority RootIntent/ROOT_OUTCOME_SET revision
NO policy-exception escape hatch for mandatory root outcomes in B v1
```

`DOMAIN_EXECUTION_CONTROL` ở B phải close bằng contract tối thiểu:

```text
ApplicationOrchestrator
  = Board lifecycle / claim-generation fencing only

BA DomainExecutionController
  = one released BA claim
  -> resolve/create durable ExecutionAttemptHead
       recovery/takeover -> SAME active attempt
       new attempt only after exact remediation/lifecycle decision
  -> deterministic policy resolution
  -> exact strategy/config refs
  -> immutable ExecutionAttemptBinding
  -> execute/recover same attempt
  -> ExecutionAttemptOutcome/provenance

ExecutionPolicy
  != scheduler
  cannot choose another work/domain/priority
  cannot rewrite work/acceptance semantics

ExecutionStrategy
  != product/write authority
  returns execution result/evidence only
```

B không cần generic StrategyRegistry. Một concrete BA strategy là đủ. Nếu chọn Restate làm concrete strategy, B phải thêm Restate-adapter checks:

```text
- executionAttemptId, không phải stable workId, là workflow/invocation attempt identity
- exact strategy runtime version is addressable/verified before start
- same-attempt recovery remains pinned to same immutable deployment/binding
- a new policy/strategy revision affects only new attempts
- Restate router/multi-agent decisions cannot select organizational domains
```

`pull-discovers` vẫn chỉ explicit/poll; autonomous activation chưa claim solved.

B bounded authority must be **enforced**, not convention:

```text
PM writer cannot publish RequirementSet
BA writer cannot publish ProductObjective/ScopeDecision
producer principal identity binds every authoritative output
cross-domain write fails closed
ApplicationOrchestrator does not choose BA execution strategy/worker after claim
BA DomainExecutionController cannot claim/create unrelated work
strategy output cannot directly publish authoritative RequirementSet/Claim without BA completion/write gate
```

BA phải biến semantic root constraints (`healthy`, `reproducible`, `critical journey`, etc.) thành stable machine-addressable acceptance-criterion ids + expected verifier/evidence semantics; unresolved product ambiguity creates `HUMAN_DECISION_REQUIRED`, không để QA tự invent meaning.

Integration B exit phải prove cả semantics lẫn observability:

```text
PM/BA restart without shared chat
ScopeDecision missing a mandatory root id fails closed
mandatory-root change without new root-authority revision fails closed
forbidden producer writes fail closed

released claim -> one immutable ExecutionAttemptBinding
same attempt recovery/takeover -> same ExecutionAttemptHead + same binding
process restart alone cannot mint a new executionAttemptId
new remediation attempt -> explicit transition advances attempt head -> new executionAttemptId/binding
work contract contains no ExecutionPolicy/ExecutionStrategy choice
policy/strategy change alone does not mutate work semantics
execution provenance records exact policy/strategy/config/runtime identity
```

Reusable `DOMAIN_WRITE_AUTHORITY` still required before C.

### Integration C — SA

Mọi SA execution attempt từ C trở đi cũng phải persist `ExecutionAttemptBinding` + outcome/provenance theo contract đã prove ở B; không được đợi tới Integration I mới instrument.


Trước khi SA trở thành domain writer thứ ba, phải có accepted `DOMAIN_WRITE_AUTHORITY` contract hoặc equivalent writer gate để claim authorization không bị nhầm với product-write authority. Contract này phải cover cả **obligation issuance**, không chỉ artifact/claim kinds:

```text
canPublishArtifactKinds
canPublishClaimKinds
canIssueObligationKinds
allowedTargetDomains
requiredDerivationRefs
forbiddenMutations
```

SA→FE/BE/DevOps obligations là first executable test. Một domain tạo arbitrary obligation cho domain khác mà không đúng issuance contract được xem là hidden dispatch và phải fail closed.

Integration C cũng **không được bắt đầu** cho đến khi `DEPENDENCY_INVALIDATION` được accepted/implemented đủ để requirement supersession có thể mark đúng affected architecture/downstream claims stale. Authoritative Claim assertion payload/ref/digest là immutable; thay đổi phải qua supersede/revoke/new claim, không rewrite in place. Integration C là first slice dùng invalidation như correctness primitive, nên không được giả định nó tồn tại.

Thêm:

```text
RequirementSet
 → SA workload
 → ArchitecturePackage
 → interface/contracts
```

Và test requirement change làm architecture claim stale đúng cách.

### Integration D — FE + BE parallel autonomy

FE/BE có thể resolve **khác ExecutionStrategy kinds/versions** dưới domain policy riêng, nhưng cùng organizational work/Claim semantics. Đây là nơi strategy replaceability bắt đầu có evidence thực.


**Gap #1 closes here.** Trước khi D được phép claim "parallel autonomy", phải có accepted `DOMAIN_ACTIVATION` contract và executable activation pilot covering poll/event source, duplicate delivery, idempotent activation, ownership và restart recovery.

Hard invariant:

```text
Activation != Scheduling
```

Activation chỉ surface persisted actionable work cho **exact owning domain**. Nó không infer next domain, order, priority hay execution strategy và không tạo obligation mới. D có thể được wired manually trong dev, nhưng manual invocation không satisfy autonomy acceptance.

Reuse **Backend worker/preparation/Core/completion primitives** của vertical hiện tại, không reuse nguyên `createDurableBackendQaWorkflow(...)` làm Backend strategy vì composition đó còn chứa QA/remediation cross-domain dispatch.

Backend ExecutionStrategy phải terminate ở Backend-owned execution output/evidence; organizational QA continuation đi qua Claim/Obligation/Materialization boundary.

Thêm real Frontend domain.

Sau ArchitecturePackage:

```text
            ┌─ FE feature workload
arch-v2 ────┤
            └─ BE feature workload
```

Hai domain execution attempts chạy độc lập; strategy của mỗi domain có thể khác nhau.

Đây là test đầu tiên chứng minh:

> organization không phải sequential workflow; workflow chỉ có thể là strategy local của một workload.

D phải chạy ít nhất một **partial invalidation counterexample**: một bounded requirement/contract change làm stale đúng affected FE/BE work trong khi unrelated domain work vẫn tiếp tục. Nếu mọi change kéo toàn bộ FE+BE về một implicit stage barrier, architecture tripwire phải fire.

### Integration E — DevOps domain

DevOps execution cũng emit attempt binding/outcome refs để sau này phân biệt deployment-semantics failure với execution-strategy/runtime failure.


Deploy exact FE/BE revisions:

```text
FE-r8
BE-r5
  ↓
DeploymentWorkload
  ↓
build / package / deploy / health
  ↓
DeploymentRelease deploy-r3
```

Deployment failure chỉ tạo DevOps/remediation obligations tương ứng.

Trong Integration E phải mở bounded research/decision cho `AcceptanceSnapshot` (exact FE/BE/deployment pinning). Nó có thể chạy song song với deployment work, nhưng **must be independently accepted before Integration F starts**; không để exact-revision freeze trở thành late design discovery trong QA implementation.

### Integration F — Product QA

QA strategy/provenance cũng phải pin exact `AcceptanceSnapshot` subject và execution attempt identity; verifier evidence remains acceptance authority, không phải strategy self-report.


Existing QA hiện tại thiên Backend→QA.

Phase này phải có thêm product acceptance workload:

```text
RequirementSet
+ FE-r8
+ BE-r5
+ deploy-r3
       ↓
product QA
       ↓
browser E2E
API verification
runtime smoke
regression
       ↓
QualityAcceptance
```

QA phải prove rằng nó kiểm đúng **exact deployed revisions**, không phải source hiện tại ngẫu nhiên và không phải self-report trong `QualityAcceptance`.

`AcceptanceSnapshot` phải pin expected runtime/deployment identity. Product verifier phải **observe** runtime identity từ deployment evidence (ví dụ immutable deployment manifest/build digest/version endpoint/health metadata) và tạo evidence artifact so sánh observed identity với snapshot. `QualityAcceptance` phải reference verifier decision/evidence đó. Nếu runtime identity không observable hoặc mismatch thì QA blocked/rejected; agent không được chỉ khai "đã test deploy-r3".

Trước khi F được coi DONE, bounded remediation/escalation policy cũng phải tồn tại: attempts/time/cost budget, terminal `BLOCKED`, và `HUMAN_DECISION_REQUIRED` khi ambiguity thật sự cần Product Owner/root authority. Agent domains không được fabricate missing product decision.

### Integration G — Product claim composition

Trước G phải có canonical product-history completeness semantics. Caller không được gửi arbitrary `currentClaimRefs[]` / `currentObligationRefs[]`.

```text
append-only durable product history / ledger
  -> canonical ProductHistoryHead { generation, digest }
  -> derive complete active Claim/Obligation/lineage set at that head
  -> ProductStateProjectionInput pins:
       productHistoryHeadRef/generation/digest
       rootIntentRef
       rootOutcomeSetRef
       productObjectiveRef
       acceptancePolicyRef/revision
       applicableWaiverRefs[]
  -> deterministic ProductStateProjection
```

`ProductStateProjection` là disposable/read-only derived view; same canonical head + same policy/root inputs => same result. Projection builder, không phải caller, derives current facts from history.

Waiver/policy exception là separate artifact; **Policy waiver != RootIntent amendment**. It may alter policy treatment only within explicit authority, never erase mandatory root outcomes or mutate specialist Claim truth.

Closure:

```text
ELIGIBLE_FOR_CLOSURE projection subject/input digest
  -> PM/root-authorized closure action
  -> immutable ProductOutcomeClaim
       binds exact projection subject + ProductHistoryHead + policy/root/waiver refs
```

`ProductOutcomeClaim` là historical assertion, **không phải permanent current DONE bit**.

New upstream supersession/revocation creates a new product-history head. If prior closure inputs are no longer current:

```text
historical ProductOutcomeClaim retained
prior closure becomes NON_CURRENT / STALE relative to new head
current projection becomes NOT_READY / remediation-required
bounded revalidation/remediation work is materialized
```

Current source does not expose a general `supersede(DONE)` path; therefore v1 should prefer append-only historical closure + new current projection/revalidation instead of rewriting terminal history. Nếu team muốn actual terminal Board reopen, đó phải là separate researched/reviewed lifecycle primitive trước H.

Hard invariants:

```text
ProductStateProjection != Product Authority
Historical ProductOutcomeClaim != current DONE
caller-selected current refs != completeness proof
```

### Integration H — adversarial recovery

Cố tình phá E2E, including **after closure**:

```text
close against head H1 -> ProductOutcomeClaim C1
publish BE supersession -> head H2
expect C1 retained historically but non-current
expect current projection NOT_READY
expect bounded revalidation/remediation work
```

Current Board terminal semantics must not be silently bypassed. If implementation chooses terminal-DONE reopen instead of historical-closure semantics, that primitive requires its own accepted lifecycle research/decision.

Cố tình phá E2E:

```text
process dies after FE output
artifact mutated
BE contract changes
QA finds bug
deployment unavailable
SA decision superseded
BA changes requirement
stale QA acceptance
duplicate worker
```

Expected result:

```text
local bounded remediation
```

chứ không:

```text
restart whole website delivery organization
```

H cũng phải evaluate **architecture viability tripwires**, không chỉ recovery correctness. Fire `ARCHITECTURE_REASSESSMENT_REQUIRED` khi evidence cho thấy một trong các pattern sau lặp lại trong benchmark budget:

```text
mutual obligations make no progress while all involved domains are healthy
progress repeatedly requires a central actor to choose the next domain
local changes repeatedly invalidate unrelated domains / approximate whole-stage reset
coordination repeatedly requires whole-organization barriers to make progress
materializer/PM/activation layer begins inventing routing decisions absent from accepted obligations/authorization
projection cannot be rebuilt deterministically from durable history
```

Threshold/budget cụ thể phải được frozen trong Integration D/E benchmark plan trước khi đo; không được đặt lại sau khi thấy kết quả. Tripwire không tự chọn replacement architecture — nó pauses promotion và mở một explicit architecture-reassessment research item.

### Integration I — Observe / causal reconstruction

I **không bắt đầu instrumentation**. Nó consume durable provenance đã bắt buộc từ B–H.

Capture/reconstruct complete causal graph + organizational/execution metrics.

Goal:

```text
given objective-001

can we reconstruct:
why is it not done?
who owns remaining work?
what workload semantics failed?
what execution strategy/config was used?
which exact attempt/runtime invocation produced the artifact/evidence?
how long was waiting vs executing?
what evidence supports each Claim?
```

I phải fail nếu history thiếu `ExecutionAttemptBinding`/strategy/config identity từ earlier slices; không backfill bằng inference.

### Integration J — close one real evolutionary loop

Lấy **một failure thực sự từ B–I execution history**, không synthetic issue.

```text
Observation
→ Finding
→ exact target layer
     ExecutionStrategy
     ExecutionPolicy
     ContextPolicy
     Toolset/model/harness config
→ Candidate
→ fixed-work-semantics replay/evaluation
→ independent proposal
→ PROMOTE | KEEP_BASELINE
```

J acceptance phải có ít nhất một counterexample chứng minh separation:

```text
promote strategy v3 -> v4
existing accepted BackendDelivery produced by v3 remains product-current
  IF its product lineage/acceptance inputs remain current

new execution attempt
  -> resolves v4

in-flight/recovered old attempt
  -> remains pinned to old ExecutionAttemptBinding

candidate attempts to alter work acceptance/root authority
  -> rejected before evaluation/promotion
```

Nếu chạy được đến đây thì integration phase mới thật sự khép kín: organization học HOW để execute tốt hơn mà không tự dời goalpost.

---

# 16. E2E acceptance test cuối phase

Tao sẽ không accept phase bằng unit tests đơn thuần.

Canonical test:

The canonical fixture starts from a **ProjectSeed**, not from a requirement that every canonical project artifact already exists. The selected lifecycle is explicit/versioned; the supplied artifact bundle may be incomplete.

```text
ProjectSeed
  goal: "complete and deliver this product"
  lifecycleRef: software-product-delivery@v1
  initialArtifactRefs:
    - requirement-notes.md
    - design.fig
    - any other artifacts the end user currently has
        │
        ▼
selected explicit lifecycle establishes / evolves canonical project artifacts
with bounded end-user clarification where required
        │
        ▼
RootIntent + ROOT_OUTCOME_SET
        │
        ▼
accepted ProductObjective/ScopeDecision bound to that RootIntent
        │
        ▼
DOMAIN_ACTIVATION causes eligible domain work to be discovered without manual next-role dispatch
        │
        ▼
                organization operates
        │
        ├─ PM artifacts
        ├─ BA artifacts
        ├─ SA artifacts
        ├─ FE implementation
        ├─ BE implementation
        ├─ Deployment
        └─ QA acceptance
        │
        ▼
kill / resume at selected boundaries
        │
        ▼
ProductStateProjection
        │
        ▼
ELIGIBLE_FOR_CLOSURE
        │
        ▼
PM objective closure
        │
        ▼
DONE
```

Rồi mở artifact graph lên phải trace được:

```text
DONE
 ├── RootIntent
 ├── RootOutcomeSet
 ├── ProductObjective
 ├── AcceptancePolicy revision
 ├── applicable Waiver/PolicyException refs
 ├── RequirementSet
 ├── ArchitecturePackage
 ├── FrontendDelivery
 │     └── evidence
 ├── BackendDelivery
 │     └── evidence
 ├── DeploymentRelease
 │     └── health evidence
 ├── QualityAcceptance
 │     ├── AcceptanceSnapshot
 │     ├── FE revision
 │     ├── BE revision
 │     ├── deployed revision
 │     └── observed runtime identity evidence
 └── ProductOutcomeClaim
```

Và đặc biệt:

```text
remove QA claim
=> NOT DONE

replace BE revision
=> deployment + QA stale
=> NOT DONE

promote Backend execution strategy v3 -> v4
=> existing accepted BackendDelivery does NOT become stale solely because HOW changed
=> new attempts resolve v4; old in-flight attempt stays pinned to its binding

run same work semantics under baseline vs candidate strategy
=> acceptance/evaluator inputs remain fixed
=> candidate cannot change RootIntent/work acceptance

restart every agent process
=> state reconstructs unchanged

change BA requirement
=> affected downstream claims stale
=> local workloads appear

no shared conversation
=> organization still continues

delete ProductStateProjection cache/view
=> rebuild from complete pinned root/policy/waiver/claim inputs yields same readiness

change acceptancePolicy revision without changing claims
=> old projection subject is no longer current
=> rebuild under new policy may yield different readiness deterministically

attempt in-place mutation of an authoritative Claim assertion
=> rejected; publish superseding/revoking/new claim instead

make one bounded requirement change unrelated to catalog-list BE work
=> unrelated BE work remains current / progresses

remove manual next-role dispatcher
=> accepted DOMAIN_ACTIVATION still progresses organization

exhaust remediation attempt/time/cost budget
=> work becomes BLOCKED / escalated
=> no unbounded agent loop

emit HUMAN_DECISION_REQUIRED
=> organization does not fabricate missing Product Owner decision
=> progress resumes only after authorized external decision artifact
```

Nếu pass được bộ này thì mình đã chứng minh **organization semantics**, không phải demo nhiều agent.

---


### Mandatory completeness / closure-currentness counterexamples

```text
Projection omission attack
  caller attempts to omit QUALITY_REJECTED/blocking obligation from a custom ref list
  -> projection builder ignores caller-selected current sets
  -> rebuilds from canonical ProductHistoryHead
  -> readiness remains NOT_READY

Authorization revoke race
  materialize BA work under grant g1
  revoke g1 before claim
  -> work cannot be claimed

Duplicate materialization race
  two processes materialize same decision+grant+obligation concurrently
  -> exactly one logical Board work identity / commit receipt

Principal spoof
  Backend principal requests requestedDomain=BA
  -> denied

Post-closure invalidation
  close at head H1
  upstream accepted revision changes -> head H2
  -> historical ProductOutcomeClaim remains immutable
  -> it is non-current for H2
  -> current objective readiness becomes NOT_READY until revalidated
```

# 17. Phase definition tao đề xuất

Có thể chốt Integration phase bằng statement này:

```text
INTEGRATION PHASE

Prove that ExHarness can operate as a durable agentic
software organization in which autonomous role domains
own distinct workload types, execution policies/strategies, context,
artifacts and authority, coordinate through shared
product state rather than a global agent workflow,
and jointly deliver, verify and close one real product
objective end-to-end.

The phase must also make organizational behavior
observable and close at least one evidence-gated
execution-strategy self-improvement experiment.

The product-delivery lifecycle and workload workflows may be explicit and versioned inputs; ExHarness does not need a runtime engine that invents new workflows from project artifacts. The project artifact bundle may be incomplete at entry and evolve through those known responsibilities with bounded end-user interaction.

A Restate handler/workflow remains one possible durable implementation shape of a bounded domain-local ExecutionStrategy. Selecting or versioning that workflow does not grant organization-wide scheduling, cross-domain dispatch, product/write authority or permission to rewrite work semantics.
```

Và **không build trong phase này**: generic universal `RoleRegistry`, one global `WorkflowGraph`, central LLM manager, shared group-chat memory, Oracle-based dispatch, global LLM `DONE` judge, hay self-improvement được phép tự sửa evaluator/acceptance authority.

Điểm làm đầu tiên là **BB-046 research Organizational Integration cho đến khi publish được một candidate `IntegrationImplementationArtifact` evidence-backed, rồi đưa exact artifact qua independent review/decision**. Research producer không được tự gắn `IMPLEMENTATION_READY` authority cho output của chính nó.

Sau khi BB-046 được independently accepted, first derived implementation seam là **Integration A.1 research-to-role-work bridge**, implemented through deterministic `OrganizationWorkMaterializer` rather than PM dispatch, with canonical authority-revocation -> Blackboard lifecycle invalidation; sau khi bridge pass mới chạy PM+BA product vertical. Các mechanism chưa đủ evidence vẫn nằm trong explicit twelve-gap blocking matrix và chỉ được mở khi slice tương ứng đến gần. Như vậy Blackboard Integration vẫn bắt đầu từ concrete seam/objective, không fabricate backlog trước, nhưng research cũng không dừng ở architecture summary và không self-approve downstream implementation.


---

# 18. Artifact-evolution acceptance fixtures

The final integration proof must cover different starting completeness levels under the **same explicit lifecycle contract**:

```text
Fixture A — minimal seed
  idea / goal artifact only
  -> lifecycle evolves requirements, architecture, delivery, deployment and QA artifacts

Fixture B — partial project
  requirement markdown + Figma/design artifact
  -> reuse what is grounded
  -> clarify/complete missing semantics
  -> materialize only required downstream work

Fixture C — advanced project
  requirements + architecture + design + existing FE/BE/code/deployment refs
  -> verify/adopt current artifacts through normal authority gates
  -> do not redo already-current accepted work
  -> materialize only missing/stale obligations
```

All fixtures must converge through the same canonical product-state and closure semantics. Different initial completeness changes the amount of work, not the trust model or the selected lifecycle's authority boundaries.

Required counterexample:

```text
input contains architecture.md or design.fig
!= automatically ACCEPTED ArchitecturePackage / FrontendDelivery

input artifact
  -> exact provenance
  -> bounded owning-domain evaluation/adoption/completion
  -> canonical accepted artifact/Claim only through normal authority gates
```
