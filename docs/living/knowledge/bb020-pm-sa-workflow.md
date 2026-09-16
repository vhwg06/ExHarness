# BB-020 — bounded PM/SA workflow research

Status: research result `NARROW`

Evidence class: `DETERMINISTIC_REFERENCE`

Production evidence: `false`

## Question

Can ExHarness add concrete PM coordination and SA architecture roles around the delivered Backend → QA lifecycle without collapsing project coordination, architecture judgment, review authority, or Blackboard mutation into one generic agent role?

## Current source-backed boundary

The current Agentic Application already exposes the ingredients needed for a bounded experiment:

- D003 separates PM coordination authority from SA architecture judgment and keeps Orchestrator lifecycle authority;
- D004 keeps durable project intent rooted in the user and makes Blackboard + referenced artifacts the session-handoff surface;
- `sessionHandoffFromBlackboard(...)` exposes project identity, durable user intent, eligible/pending/blocked/review work, dependencies, blockers, review requirements, findings, and artifact/evidence refs;
- the durable Backend → QA workflow can execute role-local work and submit the item to `PENDING_REVIEW` without fabricating project acceptance;
- the Orchestrator already owns review requirements, review dispatch/recovery, trusted assessment, finding reconciliation, and lifecycle mutation.

What does not exist in current source is a concrete PM/SA runtime layer that is allowed to edit canonical project state directly. This research does not assume such a layer should exist.

## Concrete project scenario

The probe models one user-rooted objective:

> Deliver a Backend change through QA while preserving declared user constraints.

Four controlled situations are evaluated against the same session-handoff projection:

1. ordinary Backend → QA delivery;
2. a schema migration becomes a coordination prerequisite;
3. a public architecture boundary changes and requires architecture assessment/review;
4. a required artifact is unavailable while an existing recovery work ref is known.

The static baseline always schedules only `BACKEND → QA`.

The bounded candidate composes two distinct proposal surfaces:

- SA receives architecture-only context and may emit a source-linked architecture assessment;
- PM receives durable intent, project-work state, coordination facts, and only the bounded SA assessment reference/summary needed for coordination.

Neither role is allowed to change Blackboard state in the probe.

## PM contract

### Input

PM context is a bounded projection of:

- stable project identity;
- durable user intent;
- relevant work ids, declared dependencies, remaining work, blockers, and review requirements;
- concrete coordination facts for the current project scenario;
- a bounded SA assessment reference when architecture review pressure exists.

PM does not receive authority to redefine the user objective.

### Output

The research candidate uses a `PM_COORDINATION_PROPOSAL` containing only coordination semantics:

- proposed obligations;
- proposed dependency edges;
- proposed blockers or links to existing recovery work;
- proposed review requirements with source `PM`;
- progress projection derived from those obligations.

The proposal explicitly carries no user-intent patch and no architecture verdict.

### Authority fence

A PM proposal must be rejected before application if it:

- rewrites durable user intent;
- claims architecture acceptance authority;
- references unknown obligations/dependency endpoints;
- creates an immediate self-dependency;
- fabricates a non-PM review-requirement source.

The proposal is not a Blackboard mutation. Application orchestration must validate it against current state and invoke existing lifecycle operations separately.

## SA contract

### Input

SA context is separate from PM context and contains only:

- project identity;
- user objective and architecture-relevant constraints;
- the exact target work item;
- architecture facts for the target;
- exact evidence refs supporting an architecture judgment.

### Output

The research candidate uses an `SA_ARCHITECTURE_ASSESSMENT` containing:

- exact target item id;
- immutable assessment artifact ref;
- evidence refs;
- whether independent architecture review remains required;
- a concise architecture finding.

### Authority fence

SA does not own:

- project dependency construction;
- project priority or sequencing;
- work status/lifecycle mutation;
- project timeline/progress authority;
- review acceptance merely because it produced an architecture assessment.

An architecture-changing assessment without exact evidence refs fails closed.

## Handoff between SA and PM

The handoff is artifact/ref based, not shared mutable role state:

```text
architecture facts + evidence refs
  -> SA architecture assessment artifact
  -> bounded assessment ref in PM context
  -> PM may REQUIRE architecture review
  -> Orchestrator validates requirement against current work
  -> existing review lifecycle dispatches/assesses/reconciles
```

This preserves D003:

```text
SA ASSESSMENT != PM REQUIREMENT != REVIEW DISPATCH != REVIEW ASSESSMENT != ACCEPT
```

## Orchestrator validation before mutation

The experiment deliberately keeps proposal production separate from project mutation.

A future concrete application slice must treat PM/SA outputs as proposals and re-read current Blackboard state before applying them. At minimum it must verify:

- proposal root intent still matches the durable user-intent root;
- target work still exists and is in a lifecycle state compatible with the requested coordination action;
- proposed dependency endpoints exist and the resulting graph remains valid;
- blockers link to current evidence/work rather than inventing completed prerequisites;
- review requirements preserve PM source semantics and target the current work/revision;
- an SA assessment is bound to exact evidence and target work;
- no proposal grants completion, review acceptance, claim ownership, or user-intent mutation authority.

Existing Orchestrator operations remain the mutation authority. The research result does not justify a parallel PM/SA state machine.

## Measured deterministic result

Probe: `packages/agentic-system/test/bb020-pm-sa-research.test.js`

Exact measured run: CI #1605 on research head `9b1d593dd370d9e3fabdbe4bbde8bebfebed5294`.

| Metric | Static Backend→QA baseline | Bounded PM/SA candidate |
| --- | ---: | ---: |
| Expected coordination obligations | 11 | 11 |
| Matched obligations | 8 | 11 |
| Obligation coverage | 72.73% | 100% |
| False obligations | 0 | 0 |
| Semantic replans | n/a | 3 |
| SA assessments | n/a | 1 |
| Authority-fence rejection cases | n/a | 4 |

Role-specific context serialization across the four fixtures measured:

- separate PM + SA contexts: `4,464` characters;
- one universal context projection: `7,743` characters;
- measured reduction: `42.35%`.

Per-scenario obligation coverage:

- simple delivery: baseline `1.0`, bounded `1.0`;
- migration: baseline `0.667`, bounded `1.0`;
- architecture boundary: baseline `0.667`, bounded `1.0`;
- artifact blocker: baseline `0.667`, bounded `1.0`.

The architecture-boundary case carries `artifact:sa-assessment:delivery` into the PM review requirement by ref. The other scenarios do not fabricate an SA assessment.

## Interpretation

The experiment supports one narrow conclusion:

> A concrete application-local PM coordination proposal plus a separate evidence-bound SA architecture assessment can cover scenario-specific coordination obligations while preserving role authority separation and using less serialized role context than one universal projection in this fixture.

It does **not** establish that model-driven PM/SA agents improve production outcomes. The candidate logic is deterministic and synthetic. The context metric is serialized characters, not tokens, latency, or provider cost. The scenarios are authored within the research slice and therefore do not establish representative project coverage.

The result therefore does not justify:

- a generic `Role<TContext,TProposal>` abstraction;
- a role registry;
- a workflow DSL;
- a second lifecycle engine beside the Orchestrator;
- runtime-default PM/SA autonomy;
- allowing PM or SA to mutate the Board directly;
- using SA prose or PM planning as correctness/acceptance evidence.

## Re-planning semantics

The bounded behavior observed in the probe is intentionally small:

- ordinary delivery: retain current Backend → QA plan;
- migration pressure: PM proposes the additional migration obligation/dependency;
- architecture pressure: SA emits an evidence-bound assessment; PM may require architecture review from that ref;
- artifact outage: PM links the existing recovery work and blocks the affected work instead of inventing a replacement artifact or redispatching unchanged work.

A change in user objective is outside PM/SA re-planning authority. It must come from new user intent/input and be reconciled through the project authority boundary.

## Fresh-session continuation

No new hidden role memory is required for continuation. A future PM/SA slice should reconstruct from:

- the existing project-bound session handoff;
- immutable proposal/assessment artifact refs persisted by the application when needed;
- current Blackboard work/review/blocker state.

A fresh session should not need prior PM/SA conversation history. If a proposal was never validated/applied, it is not canonical project state.

## Conditional BB-021 implementation handoff

BB-021 already owns implementation and remains blocked by BB-019 plus this research dependency. This research does not create a duplicate implementation item.

If BB-021 proceeds after the concrete review pipeline is available, the smallest evidence-supported slice is:

1. application-local `PmCoordinationProposal` and `SaArchitectureAssessment` data contracts;
2. separate PM and SA context builders over the existing project/session-handoff state;
3. an application-owned validator/applier that re-reads current Blackboard state and maps valid proposals onto existing Orchestrator operations;
4. ref-only SA-assessment → PM-review-requirement handoff;
5. deterministic fallback to current orchestration when no valid proposal adds an obligation;
6. tests for stale target/evidence, intent rewrite attempts, invalid dependency proposals, duplicate/existing work links, deferred review, and fresh-session reconstruction.

Compatibility rule: existing Backend/QA workflows continue unchanged when PM/SA coordination is not configured.

Adoption rule: opt-in only until representative project scenarios show value beyond deterministic fixtures.

Rollback rule: disable the PM/SA proposal producer and retain current Orchestrator/Backend/QA behavior; proposal artifacts remain historical evidence but do not become canonical state unless validated/applied.

## Result

`NARROW`.

Preserve separate PM and SA contexts and proposal authority boundaries as the candidate architecture for BB-021. Do not generalize into a role framework or runtime default from this evidence.

## Limitations

- deterministic synthetic scenarios only;
- no external model/provider calls;
- no measured production task success, latency, token cost, or planning quality;
- authored scenarios can bias the measured obligation set;
- character reduction is a serialization proxy;
- the probe validates proposal boundaries, not a delivered PM/SA runtime;
- BB-019 must still provide the concrete independent review execution boundary consumed by BB-021.
