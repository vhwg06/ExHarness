# Feedback lifecycle: episode, response, outcome and resolution

This file describes the delivered feedback lifecycle contracts as implemented
today in `packages/agentic-system/src/feedback-lifecycle-contracts.js`,
`packages/agentic-system/src/feedback-outcome.js` and
`packages/agentic-system/src/feedback-lifecycle-controller.js`. It covers only
delivered behavior; observation production, context binding, cross-episode
pattern projection and improvement proposals do not belong here.

## Contracts

`FEEDBACK_EPISODE_V1` is immutable evidence. It binds exact grounded finding
input refs with digests, a finding (`kind`, `statement`, `evidenceRefs` and a
producer identity of kind observer, model, human or application with an id),
an impact with basis `MEASURED` or `HYPOTHESIZED` and measurements, an explicit
`scopeKey` and contrary evidence refs. The episode id is the sha256 hash over
the canonical episode content. Finding and impact grant no disposition,
acceptance, lifecycle or promotion authority; authority fields smuggled at any
depth are rejected. `MEASURED` requires a non-empty measurement set with
finite numeric values; consumption checks additionally require every input to
be grounded and current at consumption time, otherwise the basis must be
`HYPOTHESIZED`.

`FEEDBACK_RESPONSE_V1` is application-owned. It binds the episode ref with
digest, the previous response ref or explicit null, the verified authority
ref, a disposition of `ACTED`, `REJECTED`, `DEFERRED` or `SUPERSEDED`, a
rationale ref, action refs, a successor episode ref or null, a revisit
condition or null and, for `ACTED` only, a frozen outcome policy with its
digest. Disposition rules are exact: `ACTED` requires non-empty action refs
and a frozen policy; `REJECTED` requires a rationale ref; `DEFERRED`
requires a revisit condition of kind after-episode, after-revision or manual;
`SUPERSEDED` requires a successor episode ref. Every other disposition
carries none of the fields it does not own.

`FEEDBACK_OUTCOME_POLICY_V1` freezes the measurement contract before any
outcome is recorded: a metric key, a direction of higher-is-better or
lower-is-better, a positive minimum effect, a no-change band at or above zero
and bounded by the minimum effect, and a non-empty unique set of required
measurement keys that includes the metric key. The policy digest is stored
inside the `ACTED` response and never changes afterwards.

`FEEDBACK_OUTCOME_V1` binds the responding response ref with digest, the
fresh input ref with digest, a freshness identity with the fresh execution
attempt ids and the effective after-boundary, the frozen policy digest, the
baseline and fresh measurement sets, a value of `IMPROVED`, `NO_CHANGE`,
`REGRESSED` or `UNKNOWN` and reasons. The freshness identity is explicit:
the response must be the current head response, the fresh input must not
already belong to the episode, its execution attempts must be disjoint from
the baseline attempts and every fresh boundary must be strictly later than
the latest baseline boundary.

Outcome classification is a pure function of the frozen policy, the two
measurement sets and the freshness checks. A missing or null required
measurement, an unresolved fresh input or any failed freshness check yields
`UNKNOWN`. Missing values are never coerced to zero. Otherwise the signed
delta for the metric key decides: at or above the minimum effect is
`IMPROVED`; below the negated no-change band is `REGRESSED`; anything in
between is `NO_CHANGE`. The direction factor rewards an increase when higher
is better and a decrease when lower is better.

`FEEDBACK_RESOLUTION_V1` is the terminal record. It binds the episode ref,
the final response ref, an outcome ref or explicit null, a resolution of
`IMPROVED`, `NO_CHANGE`, `REGRESSED`, `REJECTED_ACKNOWLEDGED` or `SUPERSEDED`
and the verified authority ref. Measured resolutions carry an outcome ref;
acknowledged rejections and supersessions carry none. The value is derived
from recorded head state rather than chosen by the caller: a caller-supplied
value that differs from the derived value is rejected.

## Authority limits

Only an application principal verified by the injected principal authority
can create or revise a response or resolve an episode. The controller accepts
the principal only as an explicit call argument and calls the authority
verify operation with the principal, the episode ref and the transition name,
which must return an authority ref. Principals of observer, evaluator,
provider or optimizer kind are rejected before verification; a principal
that the authority does not verify is rejected; principal-like fields inside
episode, finding, observation or provider payloads are never read.

Persistence reuses the delivered immutable artifact store for immutable
artifacts and the delivered compare-and-swap head store for the per-episode
head. The head key is the episode id prefixed for feedback episodes; the
head value carries the episode ref, the lifecycle state, the response ref or
null, the outcome ref or null and the resolution ref or null. Every
transition is a compare-and-swap on the exact expected head revision.
Exact replay converges with no second mutation; a stale revision with
different content fails without rebase. A crash between artifact put and
head swap leaves the head unchanged; retry recreates the same content
addressed ref and performs exactly one transition.

Lifecycle states are `OPEN`, responded acted, rejected, deferred or
superseded, outcome recorded and resolved. An acted response can record an
outcome; a recorded non-unknown outcome can resolve; rejected and
superseded responses resolve without an outcome. `UNKNOWN` never advances
the head, so a later fresh outcome or a new deferred or superseded response
remains possible. Deferred responses can be revisited with any disposition.
Resolved is terminal. `UNKNOWN` and deferred states never resolve.

## Dependency seam

The lifecycle binds only delivered grounded finding input package-root
exports through the dependency preflight: the finding input validator and
the consumption-time currentness check, plus the delivered immutable store
and compare-and-swap head store. Outcome evidence is fresh grounded
observation. There is no benchmark, optimizer, promotion, pattern or
cross-episode dependency, and the lifecycle modules import none of that
code.

## Unsupported cases

- Grounding an episode on unresolved, missing, stale or unverifiable input
  while claiming measured impact or an acted disposition.
- Acting as principal from observation, finding, evaluation or provider
  payloads, or from an unverified principal.
- Recording an outcome against a non-current response, reusing an episode
  input as fresh evidence, reusing a baseline execution attempt or relying
  on a boundary that is not strictly after the response boundary.
- Coercing a missing measurement to zero, converting unknown to success or
  resolving from an unknown outcome or a deferred state.
- Changing the outcome policy after the acted response, rebasing a stale
  revision silently or mutating a resolved episode.
- Aggregating episodes, proposing improvements, scheduling the work an
  acted response references or integrating episodes into orchestrator
  transitions; those concerns live outside this lifecycle.
<!-- Delivery rebuild 2026-10-01: re-validated on current main. -->
