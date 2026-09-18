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

Research revision: **v7 trust-transition lifecycle closure**.

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