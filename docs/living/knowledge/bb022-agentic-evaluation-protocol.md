# BB-022 — Agentic application evaluation protocol for BB-005

Status: **EVIDENCE / EVALUATION PROTOCOL**

This artifact defines how BB-005 production evaluation must extend the deterministic Backend -> QA reference gate without treating fixture scores as production effectiveness.

## Evidence classes

Every evaluation run must declare exactly one evidence class:

```text
DETERMINISTIC_REFERENCE
REAL_REPOSITORY_CONTROLLED
REAL_PROVIDER_CONTROLLED
PRODUCTION_OBSERVATION
```

A result from one class must not be silently promoted into another. In particular, the checked deterministic artifact is regression evidence, not production evidence.

## Required run identity

A real-task run must persist enough provenance to be reproduced or audited:

```text
run id
ExHarness implementation revision
scenario/task-set version
evidence class
repository/project identity + exact starting revision
model/provider configuration when applicable
Backend/QA objective inputs
runtime/evaluation policy refs
artifact/evidence refs
terminal Board status
accepted revision when one exists
measured outcomes
known missing evidence / run limitations
```

Secrets and raw credentials are never part of the evaluation artifact.

## Required measurements

BB-005 real-task evaluation must measure at least:

- task outcome across Backend -> QA;
- role acceptance separately from enclosing Board completion;
- false-completion count/rate;
- accepted-revision and ref-only artifact-handoff integrity;
- repository vs application-artifact context reads/size or token/cost proxy;
- QA issue and Backend remediation frequency;
- restart/recovery outcomes for exercised interruption scenarios;
- Advisor invocation count plus a comparison that can show value-add, no value-add or harm;
- latency/cost when an external provider/runtime supplies meaningful measurements;
- missing/inconclusive evidence as a first-class outcome rather than coercing it to success.

## Baseline-derived hard acceptance thresholds

The deterministic reference baseline establishes safety/integrity invariants that remain hard gates for every later evidence class:

```text
falseCompletionCount          == 0
handoffMismatchCount          == 0
unexpectedSourceReads         == 0
workerEvidenceAcceptedCount   == 0
```

Any non-zero value is a regression/blocker, regardless of aggregate task-success rate.

For scenarios that exercise the corresponding behavior:

```text
accepted Backend -> QA handoff preserves the exact accepted revision
successful delivery stops at PENDING_REVIEW until independent project acceptance exists
blocked artifact resolution preserves a resumable durable checkpoint
explicit cancellation does not become successful completion
```

These are contract thresholds, not claims that the system is production-effective.

## Effectiveness metrics without invented thresholds

The deterministic fixture does **not** justify numeric production thresholds for:

```text
taskSuccessRate
QA issue/remediation rate
context/token cost
latency
provider/model quality
Advisor value-add
generic-abstraction benefit
```

The first representative real-task corpus establishes observed distributions for these measures. BB-005 may set an effectiveness threshold only after the corpus/task mix, environment and comparison baseline are recorded; until then these measurements are descriptive evidence, not pass/fail authority.

## Advisor evaluation

Advisor value-add requires comparison, not invocation count alone. Runs must distinguish at least:

```text
Advisor not invoked
Advisor invoked -> retry/context/escalation proposal
outcome after proposal
comparable outcome without that proposal when a controlled comparison is available
extra model/cost/latency introduced
```

If no controlled or sufficiently comparable evidence exists, report Advisor value-add as `UNEVALUATED`; do not infer value from successful runs.

## Abstraction decision gate

BB-005 may recommend a generic Worker/WorkOrder/context/review abstraction only when real evaluation exposes a repeated semantic shape across concrete roles/workflows and the abstraction reduces measured duplication/coordination cost without weakening authority or evidence boundaries.

A passing deterministic reference gate alone is explicit evidence **against** premature generalization pressure: it proves the current concrete composition can be exercised and measured without introducing the abstraction.

## Exit evidence for BB-005

BB-005 production evaluation is ready for an architecture conclusion only when it has:

1. a versioned representative real-task set;
2. reproducible run provenance;
3. hard integrity gates above all passing;
4. task/outcome/context/recovery measurements with missing evidence explicit;
5. Advisor value-add measured or explicitly `UNEVALUATED` with reason;
6. enough repeated-role/workflow evidence to answer the abstraction question without extrapolating from fixture-only behavior.
