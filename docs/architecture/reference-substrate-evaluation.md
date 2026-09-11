# NOOA-10 — Reference substrate + adversarial evaluation

## Goal

Prove the completed NOOA-style substrate is usable by a blank consumer through the packed/public `exharness` package, with AVO layered above it, without kernel source modifications or workload-specific kernel hooks.

This stage is an integration/evaluation stage, not a new feature stage unless the evaluation exposes a substrate contract bug.

## Execution boundary

The reference gate does not import package source paths.

```text
repository
   ↓
npm pack ./packages/core-harness
   ↓
blank temporary package
   ↓
npm install file:exharness-*.tgz
   ↓
reference-substrate-consumer.mjs
   ↓
measured JSON
   ↓
semantic assertions
   +
stable artifact comparison
```

Root `npm run verify` includes this path through `npm run eval:reference`.

## Reference composition

The packed consumer exercises the completed substrate together:

- typed judgments and typed output rejection;
- Predict bounded repair;
- canonical AgentEvent working history;
- trusted named context blocks plus invocation-context separation;
- explicit bounded history selection;
- opaque ResourceRef progressive disclosure;
- CodeAct resource describe/invoke/terminal loop;
- nested causal tracing;
- scoped model routing and runtime-owned `modelUsage` provenance;
- runtime snapshot/resume with ResourceRef redaction and explicit resource rebinding;
- restored NOOA runtime passed as a custom agent to the AVO production harness;
- AVO ACT → EVALUATE → PROMOTE variation without NOOA/AVO special-case coupling.

## Adversarial matrix

The reference workload must fail closed for:

1. invalid scoped model route;
2. malformed CodeAct action;
3. oversized CodeAct observation pressure;
4. incompatible runtime snapshot;
5. stale/cross-runtime ResourceRef;
6. strict trace-sink loss.

It also verifies two non-fatal fault boundaries:

7. invocation context cannot shadow the trusted context block;
8. non-strict lifecycle telemetry sink failure remains observable while AVO engineering progress still succeeds.

The measured baseline therefore requires `adversarialPasses === adversarialChecks === 8`.

## Measured artifact

Stable cross-version measurements are checked into:

`artifacts/nooa-reference-eval.json`

The artifact was produced from the packed blank-consumer path and matched across the Node 20 and Node 24 reference runs before being committed. Node 22 also passed the same semantic gate.

Stable baseline:

```text
taskSuccess                  1
modelCalls                  13
invalidOutputs               5
invalidOutputRate       5 / 13
correctionRetryCount         5
validationErrorEvents        3
modelOutputEvents           12
AVO capability calls         3
resource invocations         1
executor calls               1
history: off / selected    0 / 2
prompt chars: off/selected 223 / 1155
nested spans                37
trace sink failures         47
non-strict event failures   14
false success                0
unsafe accept                0
resume fidelity              1
snapshot ResourceRef redact  3
adversarial pass/check      8 / 8
```

Model-call breakdown:

```text
predict       7
predict-alt   1
codeact       3
malformed     1
pressure      1
```

The `never-loaded` adapter is registered by the reference runtime but must remain absent from model-load metrics.

## Route provenance vs usage provenance

The workload explicitly proves the N8 distinction:

```text
model selector
→ requested configuration

modelRoute
→ adapter resolved by runtime

modelUsage
→ runtime-wrapped adapter generate() calls
```

A `route-only` judgment resolves a routed adapter but intentionally never invokes it:

```text
routeOnlyRoute.adapter = route-only
routeOnlyUsage.calls    = 0
```

Therefore downstream trust/evaluation must not treat route resolution alone as proof of model participation.

## Stable vs dynamic evidence

The checked artifact intentionally excludes:

- `snapshotDigest`;
- `evaluationId`.

Those values bind a particular run and change with runtime-generated event IDs/timestamps. They remain printed in each raw reference result as run-specific provenance, but are not used as brittle cross-run baseline fields.

All stable metrics and stable model route/usage provenance are deep-compared against the checked artifact. Drift requires an explicit artifact review/update rather than silently passing CI.

## Manual findings that changed the implementation

### 1. Invalid routes were fail-closed but not operationally classifiable

The first packed reference run failed because `model not registered` was a plain JavaScript `Error` with no stable code. Unit tests had only asserted the error message.

Repair:

- introduced exported `ModelRouteError`;
- invalid route/adapter identity failures use the existing stable `CONTRACT_VIOLATION` code;
- lazy-registry `pending` entries are cleared with `finally`, including adapter-validation failures;
- added a focused regression test outside the reference benchmark.

This is a substrate contract fix discovered by N10, not a benchmark workaround.

### 2. Metrics must be measurements, not prose claims

The first passing reference output was captured from CI before the baseline artifact was created. The stable values were cross-checked between Node 20 and Node 24, then checked in and made part of `npm run verify`.

### 3. Dynamic provenance must not become a brittle baseline

Snapshot digest and evaluation ID differed between equivalent runs because event IDs are generated per run. They remain inspectable raw provenance but are excluded from the stable measurement artifact.

## Trust boundary

The reference workload proves runtime/control contracts under a deterministic fake model/resource/executor workload. It does **not** prove:

- universal model quality;
- provider honesty;
- external sandbox/OS correctness;
- the semantic adequacy of an arbitrary application test suite;
- benchmark-optimal context/budget values;
- workload-specific backend/frontend/QA correctness.

It proves that a consumer can compose the substrate and that the declared fail-closed/control/provenance invariants hold in the reference workload.

## Exit contract

NOOA-10 is complete when:

1. packed blank consumer runs without source-relative imports;
2. all required substrate capabilities are exercised together;
3. all 8 adversarial checks behave as declared;
4. stable measured output matches the checked artifact;
5. false-success and unsafe-accept remain zero;
6. existing unit/example/kernel benchmark/package/consumer-smoke gates remain green;
7. exact final PR head passes Node 20/22/24;
8. merged `main` passes Node 20/22/24.
