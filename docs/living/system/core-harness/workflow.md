# Workflow state

Current Core execution/cognition/recovery projection. This file does not define Agentic Application orchestration or Oracle source resolution.

## PRE-RENDER CONTEXT RESOLUTION

For each agent call, Core selects requirement blocks, invokes the injected resolver once per selected block, projects each result to a fixed context block, then renders ordinary context. Turn-aware strategies may render history and dynamic ordinary blocks again on later turns while the requirement projection remains fixed. Missing resolver or resolver/projection failure stops before model generation with zero Capability/Resource/LiveObject dispatch. This port is separate from Capability, Resource and LiveObject action surfaces. It does not automatically request later resolution steps. The delivered Oracle facade is one conforming resolver behind this port.

## CURRENT AVO RUNNING PATH

```text
createHarness.vary()
  -> reject unrecovered RUNNING variation
  -> gate next variation by search investment
  -> createAVOHarness.vary()
       -> project bounded AVO context
       -> begin persisted variation
       -> AgentRuntime.runWithReport()
            -> strategy.run(...)
            -> observe / act / verify / evaluate / memory / promote
       -> complete persisted variation
       -> assess search investment
       -> resume public AVO snapshot
  -> optional supervisor trajectory review
```

Public built-in `avo.act` crosses a durable effect boundary before `core.act()` derives/persists candidate state:

```text
semantic action + current candidate
        -> deterministic actionKey
        -> effect journal INTENDED
        -> effect journal DISPATCHED
        -> environment.act(...)
        -> effect journal CONFIRMED(result)
        -> core.act applies result to candidate/event state
        -> persist Core session state
```

If Core state persistence fails after `CONFIRMED`, a later identical action over the still-current candidate reuses the confirmed result and does not dispatch the external action again.

If execution becomes ambiguous before confirmation:

```text
DISPATCHED / UNKNOWN
        -> fail closed
        -> reconcile by declared adapter replay policy
             PURE / IDEMPOTENT -> RETRY
             OBSERVABLE        -> observe -> CONTINUE or RETRY
             NON_RECONCILABLE  -> ESCALATE
```

The default is `NON_RECONCILABLE`. Deterministic `actionKey` establishes identity; it does not by itself prove idempotency or effect completion.

Built-in action-effect journal state remains separate from candidate lineage, trajectory, evaluation, semantic memory and application completion.

## DELIVERED COGNITION BOUNDARIES

Core has an explicit structured cognition path:

```text
persisted evidence + bounded context
        -> DeliberationArtifact
        -> ActionIntent
        -> authorization policy
        -> action/effect boundary
        -> outcome refs
        -> observation / evaluation
        -> grounded REFLECTION / durable INTENT
        -> intent/reflection alignment
```

The deliberation artifact is bounded structured state, never raw chain-of-thought. `ActionIntent` is a per-step concrete operation intent; `SemanticMemory.INTENT` remains durable goal/continuation state.

Grounded cognition is separate from correctness authority:

```text
persisted source snapshots
  -> semantic derivation proposal
  -> grounding verifier
  -> ACTIVE REFLECTION / durable INTENT
```

Every activated reflection must retain a fresh persisted evaluation source. Intent/reflection alignment can produce semantic-divergence knowledge for later search policy, but it is not an evaluation or promotion verdict.

## ACTION INTENT + EFFECT COMPOSITION

`createActionIntentEffectController()` composes capability-target ActionIntent with the existing effect journal:

```text
AUTHORIZED ActionIntent
        -> exact intended capability + input
        -> effect operationKey
        -> journal INTENDED
        -> dispatch
        -> CONFIRMED
             -> link EFFECT_OPERATION ref
             -> ActionIntent EXECUTED
```

Ambiguous effect state does not become false failure:

```text
dispatch boundary error
        -> journal UNKNOWN / pending
        -> link exact EFFECT_OPERATION ref
        -> ActionIntent remains AUTHORIZED
        -> reconcile
             PURE/IDEMPOTENT -> RETRY
             OBSERVABLE      -> observe -> CONTINUE or RETRY
             NON_RECONCILABLE-> ESCALATE
```

If observation confirms the effect, reconciliation completes the ActionIntent without replaying the side effect. A retryable effect remains authorized until the retry actually confirms.

Built-in AVO actions use the same replay-policy vocabulary but do not synthesize a model `ActionIntent`; ActionIntent and built-in AVO effect-operation state remain distinct artifacts.

## CORRECTNESS PATH

Existing correctness authority remains independent:

```text
current candidate
  -> observations + verification artifacts
  -> evaluation bound to exact artifact IDs
  -> freshness assertion
  -> promotion to committed lineage
```

Effect confirmation does not imply evaluation success, and grounded semantic memory does not imply effect completion.

## MEMORY VISIBILITY

Semantic retrieval and spontaneous recall are composable, but visibility is deliberately explicit:

```text
semantic memory
  -> retrieval port (RELEVANCE_ONLY)
  -> optional NOOA ranking adapter
  -> explicitly selected __semantic_memory__ context block
  -> UNTRUSTED bounded context
```

There is no desired hidden global memory injection. Ranking selects context; it never becomes correctness authority.

## RECOVERY PATHS

Three mechanisms exist and remain distinct:

1. **AVO variation recovery** — closes persisted interrupted work explicitly.
2. **AgentRuntime snapshot/resume** — restores compatible runtime state with explicit live-authority rebinding.
3. **Effect reconciliation** — reconciles journaled operations through replay policy/external observation, including built-in AVO action effects.

The concrete recovery-reference consumer in `test/recovery-composition.test.js` proves these mechanisms can be ordered without inventing another recovery authority:

```text
restore compatible AgentRuntime authority
  -> load persisted Core work + exact observation/verification evidence
  -> inspect built-in AVO effect operations
  -> reconcile effect truth first
       CONFIRMED
         -> if Core is still at effect base, consume confirmed result through avo.act
            without external redispatch
         -> if Core already reflects result, continue
         -> if Core diverged, escalate
       PURE / IDEMPOTENT
         -> machine-first RETRY under declared semantics
       OBSERVABLE
         -> machine-first observation -> CONTINUE or RETRY
       NON_RECONCILABLE
         -> ESCALATE and leave interrupted work unresolved
  -> only after effect reconciliation succeeds:
       close RUNNING variation as INTERRUPTED
  -> assert persisted observation/verification ids are unchanged
  -> explicit harness.resume()
  -> continue with a new variation from recovered candidate state
```

The proof deliberately restores the last safe runtime snapshot rather than pretending to resume an in-flight JavaScript call stack. Persisted Core observation/verification artifacts survive independently and are not reconstructed from traces or model prose.

A confirmed mutating effect may therefore be ahead of Core candidate persistence after a crash. Recovery is allowed to consume that confirmed result only while the current Core candidate still matches the effect's recorded base candidate. Candidate divergence is an escalation condition, not a replay guess.

Tracing and semantic memory are context/evidence inputs, never recovery authority by themselves.

## DETACHED OPERATION PATH

Detached scheduling is a transport projection over the existing effect boundary; it adds no new correctness, acceptance or external-effect authority:

```text
manager.capability(name).execute(input, runtime)
  -> existing effect.operationKey()               (exact semantic identity)
  -> durable RUNNING record, generation 1         (compare-and-set persisted first)
  -> handle returns immediately                   (background continues independently)
  -> underlying effect capability runs with AbortSignal + scheduler binding
  -> journal INTENDED -> DISPATCHED -> CONFIRMED | UNKNOWN   (unchanged authority)
  -> scheduler converges to exactly one terminal
       SUCCEEDED (only from journal CONFIRMED)
     | FAILED    (deterministic pre-dispatch failure only)
     | CANCELLED (cancel fence, per replay-policy matrix)
     | UNKNOWN   (unresolved ambiguity, escalated explicitly)
```

Recovery and cancellation ordering:

```text
manager.recover()
  -> CAS-increment generation (one current generation across managers)
  -> verify exact capability/input/call/turn/action/effect binding, else UNKNOWN
  -> CONFIRMED        -> SUCCEEDED with the confirmed result
  -> absent/INTENDED  -> execute the exact capability (no dispatch recorded yet)
  -> DISPATCHED/UNKNOWN -> existing reconcileEffectOperation()
       CONTINUE -> SUCCEEDED | RETRY (same operation, no cancel fence) | ESCALATE -> UNKNOWN

manager.cancel(operationId)
  -> CAS RUNNING -> CANCEL_REQUESTED (fences dispatch/retry) + cooperative abort
  -> CONFIRMED at settle time -> SUCCEEDED for every policy
  -> pre-dispatch  -> CANCELLED (all policies)
  -> post-dispatch with the local attempt still capable of committing
     -> stay CANCEL_REQUESTED (all policies) until it settles
  -> post-dispatch once settled (or with no live attempt, e.g. after restart)
     -> PURE: CANCELLED once settled
        IDEMPOTENT: UNKNOWN unless confirmed
        OBSERVABLE: SUCCEEDED if observed satisfied,
                    CANCELLED if settled and observed absent,
                    UNKNOWN on observer failure or unsettled attempt
        NON_RECONCILABLE: UNKNOWN
```

A raw success that never confirms the journal converges `UNKNOWN`, never `SUCCEEDED`. An unexpected internal run error fails closed to `UNKNOWN` with evidence instead of leaving the record silently `RUNNING`. All operations of one scope share a single persisted document, so a revision conflict caused by a different operation's write retries the mutation against the fresh document (bounded, loud on exhaustion); only an observable move of the same operation short-circuits.

Consumers observe transitions with monotonic sequence and deterministic transition ids and must deduplicate by transition id; repeated delivery never creates a second semantic completion, and stale generations cannot publish authoritative terminal transitions. Synchronous capabilities keep working unchanged alongside detached wrappers. Wakeup/steering integration over these updates belongs to BB-080; cache-stable context projection over these updates is delivered below.

## CACHE-STABLE ASYNC RESULT PROJECTION

The async-result projector turns delivered detached-operation transitions into append-only model-visible context without touching committed history or effect truth:

```text
delivered transition envelope (BB-078 truth, at-least-once)
  -> stageAsyncResultTransitions()
       duplicate transitionId, identical binding -> ignored
       conflicting transitionId reuse            -> fail closed
       missing effectOperationId                 -> fail closed
       RUNNING/CANCEL_REQUESTED                  -> immutable handle item, no result payload
       SUCCEEDED/FAILED/CANCELLED/UNKNOWN        -> immutable terminal item with delivered result/error
  -> staged suffix appended behind the committed prefix
  -> commitAsyncResultContext({ stagedItemIds, submissionId })
       leading prefix of the staged suffix, in order (no duplicates/reorder/skips)
       committed bytes stay byte-identical and in order
       next request projection starts with the exact prior committed bytes
```

Every stage/commit/projection entry re-verifies the recorded committed-prefix digest against the committed items, staged payloads are deeply frozen, and a restored JSON checkpoint is revalidated (digests plus operation-binding consistency) before use — so a mutated checkpoint or rewritten payload fails closed instead of silently becoming the prefix.

Prefix/cache accounting per turn:

```text
projectAsyncResultRequest()
  -> committedPrefixSha256 + committedPrefixBytes (exact prior-turn bytes)
  -> stagedSuffixSha256 + stagedSuffixBytes       (new items only)
  -> provider cached/cache-write tokens when reported, else null (missing|unsupported|ambiguous)
  -> a stable digest never implies a provider cache hit
```

Provider delivery at the model-adapter boundary (`asyncResultDelivery`, default `SYNCHRONOUS`):

```text
NATIVE_PENDING_CALL: RUNNING -> pending call, no tool result
                     terminal -> one tool output on the original provider call id (repeats rejected)
HANDLE_THEN_EVENT:  RUNNING -> exactly one paired RUNNING tool result
                     terminal with fulfilled handle -> ordinary async event, never a second tool result
                     terminal with no prior handle  -> the terminal output itself as the single tool result
                     second tool result for a fulfilled call -> rejected
SYNCHRONOUS:        RUNNING -> wait (no progressive context)
                     terminal -> one ordinary terminal tool result
```

This projection cannot confirm effects, accept products, or authorize external work, and it publishes no efficiency verdict. It is checkpoint state only; BB-080 owns persisting it with model-turn state, waking the model, and recovery-loop scheduling.

## CURRENT ABSTRACTION BOUNDARY

The concrete recovery composition shows insufficient repeated pressure for a higher-level executable Core lifecycle facade.

Current evidence has one concrete recovery-reference consumer. The existing public primitives already expose the distinct mechanisms that consumer needs; repository usage does not yet demonstrate a second real caller repeating the full restore/reconcile/recover/resume sequence.

Therefore Core intentionally keeps these mechanisms explicit rather than adding a `LifecycleEngine`, `RecoveryCoordinator`, registry or workflow DSL. Reassess only when another concrete consumer or production evaluation demonstrates repeated orchestration pressure. Any future extraction must preserve the proven ordering and must not absorb Agentic Application orchestration or merge effect/evidence/completion authority.

Application WorkOrder/Worker/Advisor/completion abstractions remain owned by Agentic Application and must preserve concrete-first sequencing.

## SOURCE

## SYNCHRONOUS HARNESS-ECONOMICS COMPARISON

The tooling in `benchmarks/harness-efficiency/` is built to isolate orchestration cost without changing Core behavior:

```text
preregistered cohort (6 tasks x 3 repeats x 2 arms)
  -> fixed-factor protocol binds model/task/prompt/workspace/tools/evaluator/budget
  -> both arm adapters really execute the shared JavaScript CodeAct strategy
     (shim versus createAgentRuntime) against an offline scripted model client
  -> arm adapters return measured raw producer observations only
  -> shared kernel registers experiments/units, ledgers attempts, binds evidence,
     normalizes outcome/accounting, audits
  -> economics observations: measured model turns, tool calls, fixture-clock
     MODEL/CALL intervals, stable-prefix/dynamic-suffix hashes, cache labels
  -> reducer: paired distributions/medians over ALL attempts (retries included),
     nullable UNKNOWN preserved, no winner score
  -> versioned comparison manifest + held-out manifest + preregistered gate
```

Cache labels are conservative: provider cached tokens above zero prove CONFIRMED, known zero is MISS, a repeated stable prefix without provider evidence is ELIGIBLE, and anything else is UNKNOWN. A repeated prefix never proves a provider cache hit. Missing cost/token/cache observations stay null and every retry stays in the ledger and in denominators; producer or provider termination never rewrites independent verifier quality. The independent evaluator step judges only the artifact the producer wrote.

To reproduce the offline fixture pipeline locally (no credentials, no model calls):

```text
preflight()         -> kernel + substrate manifest check
runCohort()         -> 36 paired strategy executions + 1 retry, all settled
auditAttempt()      -> 37/37 PASS on reopened evidence (pipeline proof, not a measurement)
buildReport()       -> multidimensional vector report, no winner score
buildHandoff()      -> versioned comparison / held-out / gate handoff
node --test benchmarks/harness-efficiency/test/*.test.mjs
```

The committed report proves the pipeline runs end to end; it establishes no quality, cost or latency result. The live synchronous baseline on the frozen route has not been executed yet — `run.mjs --live` refuses without the route credential and Harbor substrate, and a live run additionally requires an explicitly authorized paid run. The held-out task set and the promotion gate are frozen inputs to a future decision owned elsewhere; this tooling executes no async candidate and publishes no promotion verdict.
