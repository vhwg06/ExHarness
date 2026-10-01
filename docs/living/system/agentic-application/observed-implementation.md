# Observed implementation: grounded observation and context binding

This file describes the delivered observed-implementation contracts as implemented
today in `packages/agentic-system/src/grounded-observation.js` and
`packages/agentic-system/src/observation-context-binding.js`. It covers only
delivered behavior; planned BB-085 feedback and BB-086 self-improve semantics do
not belong here.

## Contracts

`GROUNDED_OBSERVATION_V1` normalizes BB-058 causal facts and delivered execution
identity for one pinned `CAUSAL_OBSERVATION_SUBJECT`:

- `subject` carries the pin mode (`HISTORICAL` or `CURRENT`), the immutable
  subject ref and the canonical subject digest. Historical and current subjects
  never mix: a rebuild from the same pinned subject yields the same
  `observationId`, while a newer `CURRENT` head requires a new subject and
  produces a new id.
- `execution` binds `executionAttemptId`, `runtimeInvocationId`, the attempt
  binding ref+digest and the runtime attestation refs+digests resolved through
  the delivered `resolveExecutionAttemptBinding` /
  `resolveRuntimeExecutionAttestation` path. Projection requires declared
  execution coordinates (`workId`+`workContractRef`+`projectId` or
  `attemptSubjectKey`) and always consults the delivered
  `OrganizationObserver.describeExecution` for those coordinates: caller pins
  must equal the observer-derived attempt, and every attestation must belong
  to that attempt's invocation set. Mixing attestations from several runtime
  invocations is rejected; one observation records one invocation. Provider
  events are attributes (`provider`, `eventKind`, `eventId`,
  `attemptBindingRef`) bound to the same execution binding **and** attributed
  to the pinned invocation id; an arbitrary event id with the correct binding
  ref is rejected and never becomes a grounded attribute.
- Every fact carries evidence refs or `MISSING_PROVENANCE`. Provenance from
  BB-058 passes through unchanged: narrative text cannot clear a
  `MISSING_PROVENANCE` fact or add a `PROVENANCED` fact.
- `narrative` is retained only as `UNTRUSTED_NARRATIVE` and is excluded from
  `observationId`, facts and classification.
- Unmeasured values are `null` with a typed reason; a zero default for a
  missing measurement is rejected.
- `observationId` is `sha256` over the canonical content without narrative.
  Boundary timestamps come only from durable attestation facts; materialization
  time is operational and excluded.

`OBSERVATION_CONTEXT_BINDING_V1` binds an already-produced BB-064
`ContextResolution` without resolving anything: `observationRef+digest`,
`requirementId`, `resolutionId`, `resolutionStatus`, unresolved evidence with
`REQUIRED`/`OPTIONAL` necessity, `receiptRef+digest` (or explicit nulls) and a
`currentness` snapshot produced by the injected `receiptCurrentness` function
wired to the delivered BB-063 `evaluateReceiptCurrentness`. The binder never
calls a resolver, planner, provider or retriever. At bind time the binder
verifies semantic identity: the resolution must answer the declared
requirement, and the receipt must carry that requirement id, that resolution
id and its own `receiptId` digest under a content-addressed `receiptRef`. When
the receipt bytes are available in the immutable store they must equal the
supplied receipt exactly; a wrong ref, a foreign resolution or a tampered
receipt is rejected. The store blob digest and the semantic `receiptId` use
different schemes, so both the ref locator and the semantic identity are
verified rather than equated.

Grounding classification is a pure total function. `GROUNDED` holds only when
the observation proof is present with every required fact `PROVENANCED`, the
resolution proof is a supported status that is `COMPLETE` or `PARTIAL` with
only `OPTIONAL` unresolved evidence, a receipt is present and currentness is
`CURRENT`. Missing, malformed, unsupported or contradictory required proof —
absent observation or binding, unknown status or currentness, any `REQUIRED`
unresolved item even under a `COMPLETE` claim, malformed necessity — is
`UNRESOLVED` with typed reasons from exactly `MISSING_PROVENANCE`,
`MISSING_CONTEXT`, `UNSATISFIED_CONTEXT`, `STALE_CONTEXT`,
`AMBIGUOUS_CONTEXT`, `CURRENTNESS_UNVERIFIABLE` or `SUBJECT_MISMATCH`. No
receipt means `CURRENTNESS_UNVERIFIABLE`; the binder never self-certifies
`CURRENT`.

`GROUNDED_FINDING_INPUT_V1` is the only feedback-facing output. It carries
observation refs, the context binding ref+digest, the grounding status, typed
unresolved reasons and uncertainty
(`missingProvenanceFactIds`, `unresolvedEvidenceIds`,
`optionalUnresolvedEvidenceIds`). Any key named `finding`, `impact`,
`disposition`, `response`, `verdict`, `accepted`, `promoted`, `remediation` or
`principal` at any depth is rejected. `assertGroundedFindingInputCurrent`
re-resolves the binding and re-evaluates currentness at consumption time: the
resolved binding bytes must match the pinned binding digest (store blob
scheme), the receipt bytes must be resolvable, and the receipt's semantic
digest must match the binding pin before the injector is ever called. Missing
or tampered binding/receipt bytes, a receipt digest mismatch, a `STALE` result
or an unverifiable result each return an `UNRESOLVED` consumption result for
that consumer without rewriting the immutable input.

## Authority limits

Observation, context binding and grounded finding input are evidence only. They
grant no lifecycle, acceptance, promotion, finding, disposition or remediation
authority. Both the projector and the binder receive only read/query ports and
an immutable artifact store; constructor validation rejects any argument
exposing `publish`, `claim`, `dispatch`, `accept`, `recover` or
`compareAndSwap` methods. No mutable observation head, index, warehouse,
telemetry backend or tracing platform is persisted.

## Dependency seam

The Worker binds only DONE BB-058 and BB-064 delivered package-root exports
through the `test/observed-implementation-dependency-contract.test.mjs`
preflight: the query-only `OrganizationObserver` surface, the domain execution
artifact registry (`ExecutionAttemptBinding`, `RuntimeExecutionAttestation`),
`createOracleContextResolver`, the `ContextResolution` validator and
`evaluateReceiptCurrentness`. BB-058/BB-064 owner files, BB-083 planned
`feedback-*.js` paths, `packages/oracle/**` and `docs/blackboard/**` are never
modified. A missing delivery, changed ownership, deep-import requirement or
incompatible public contract is `PLAN_INPUT_CONTRADICTION`.

## Unsupported cases

- Inferring causal truth from model or provider narrative.
- Substituting provider event ids for ExHarness attempt identity, or
  attributing provider events to any invocation but the pinned one.
- Grounding on missing, unsatisfied, stale, ambiguous or unverifiable context.
- Mixing historical observations with newer canonical heads, or mixing
  attestations from several runtime invocations into one observation (recovery
  multi-invocation attempts need one observation per invocation).
- Consuming a grounded finding input without re-checking currentness at
  consumption time.
