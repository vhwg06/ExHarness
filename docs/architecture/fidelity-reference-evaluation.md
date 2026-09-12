# NOOA-F5 — Fidelity reference + adversarial evaluation

## Stage claim

F5 closes the NOOA fidelity expansion with a packed-package reference workload that evaluates F1-F4 together and preserves the earlier `nooa-substrate-v1` baseline as an independent regression chain.

The fidelity evaluator is intentionally deterministic. Its percentages are capability-rubric labels for the declared semantic target, not scientific benchmark scores and not claims about universal model quality.

## Evaluation path

```text
packages/core-harness
        ↓ npm pack
blank temporary consumer
        ↓ install packed exharness tarball
copy only consumer-owned reference executor/worker
        ↓
run one deterministic fidelity workload
        ├─ agent-as-object ergonomics
        ├─ live object identity / mutation / cycles
        ├─ progressive doc() discovery
        ├─ explicit action-protocol CodeAct baseline
        ├─ language-native JavaScript CodeAct
        ├─ adversarial authority/containment checks
        ├─ trace correlation
        ├─ snapshot + explicit live-object rebind
        └─ AVO composition above JavaScript CodeAct
        ↓
validate semantic thresholds
        ↓
deep-compare stable measured artifact
```

Stable artifact: `artifacts/nooa-fidelity-eval.json`.

The earlier `artifacts/nooa-reference-eval.json` remains unchanged. F5 therefore adds a fidelity regression surface rather than rewriting the substrate completion baseline.

## Same-task comparison

Both execution styles solve the same deterministic task:

```text
double 1, 2, 3 → total 12
rename live child → "after"
reread live child name
return { total: 12, name: "after" }
```

Measured packed result:

| Measurement | Explicit action protocol | JavaScript fidelity path |
|---|---:|---:|
| task success | 1 | 1 |
| model turns | 6 | 2 |
| explicit capability action calls | 5 | — |
| JavaScript cells | 0 | 2 |
| host calls | — | 8 |
| final semantic result | `{total:12,name:"after"}` | `{total:12,name:"after"}` |

The observed model-turn reduction is `66.6667%` for this reference workload. This demonstrates that language-native glue code can collapse several deterministic action turns into a smaller number of code cells for this task. It is **not** a universal latency, token, cost, or quality improvement claim.

## Fidelity measurements

The measured JavaScript/object-native path records:

```text
model turns                  2
JavaScript cells             2
host calls                   8
typed correction             1
initial object doc chars     242
discovered full doc chars    688
initial/full ratio           35.17%
handle/authority rejections  3
sandbox failures observed    2
trace correlation            PASS
correlated spans             13
snapshot/rebind fidelity     PASS
AVO composition              PASS
packed consumer              PASS
false success                0
unsafe accept                0
```

The `242 / 688` discovery measurement belongs to the F5 workload surface. It does not replace F3's separate packed measurement (`236 / 725`) because the two stages intentionally expose different surfaces.

## Capability rubrics

Each fidelity area is represented by ten explicit boolean checks. The pipeline target is `>= 90%`; the measured reference workload passes all declared checks:

```text
Agent-as-object ergonomics   10 / 10 = 100
Live object semantics        10 / 10 = 100
Progressive discovery        10 / 10 = 100
JavaScript CodeAct fidelity  10 / 10 = 100
```

### Agent-as-object

The rubric covers:

- exact object identity;
- `instanceof` preservation;
- ordinary awaited agentic method calls;
- live instance state across calls;
- deterministic method auto-capability exposure;
- multi-argument call preservation;
- hidden method exclusion;
- deterministic/agentic surface typing;
- automatic concise `self` context.

### Live object semantics

The rubric covers:

- nested live handles;
- cycle identity back to the original root;
- mutation of the original object;
- reread of mutation;
- different authority surfaces receiving different handles;
- undeclared method rejection;
- revoked handle rejection;
- declared full discovery surface;
- hidden member exclusion;
- no serialized clone on the mutation path.

### Progressive discovery

The rubric covers:

- concise disclosure smaller than full disclosure;
- explicit concise/full modes;
- hidden object/live member exclusion;
- on-demand live docs;
- member count bounding;
- description bounding;
- automatic concise self context;
- discovery not granting undeclared invocation authority.

### JavaScript CodeAct

The rubric covers:

- real JavaScript cells;
- persistent locals across cells;
- `self` capability calls;
- nested live proxies;
- `doc()` inside the execution session;
- typed terminal `return_result()` semantics;
- typed correction;
- direct terminal-action smuggling rejection;
- infinite-loop containment;
- AVO composition above the JavaScript runtime.

## Adversarial evaluation

All eight adversarial checks pass:

```text
forbidden live member       PASS  LIVE_OBJECT_MEMBER_NOT_ALLOWED
stale/revoked live handle   PASS  LIVE_OBJECT_REVOKED
typed terminal correction   PASS
direct terminal smuggling   PASS
infinite loop containment   PASS  CODEACT_TIME_BUDGET_EXCEEDED
infrastructure crash        PASS  propagated, not repaired as code
stdout bounding             PASS
snapshot fresh authority    PASS
```

The infinite-loop reference path forces one child-process kill. The process-backed worker remains a reference containment proof only; production sandbox isolation remains an injected consumer responsibility.

## Trace and snapshot boundaries

The successful JavaScript run produces one correlated causal trace for the runtime call, including model and live-object spans; the reference workload observed `13` correlated spans.

Snapshot testing deliberately does not preserve the original live handle. Restore requires explicit live-object rebinding, produces fresh authority, rejects the old ref, and applies subsequent mutation to the rebound live object. That is counted as fidelity because NOOA-like live state is preserved semantically without weakening ExHarness authority freshness.

## AVO composition

The packed fidelity workload injects a JavaScript CodeAct AgentRuntime into `createHarness({ agent })`. Generated JavaScript calls the AVO capabilities through `self`:

```text
ACT(v1)
  ↓
EVALUATE
  ↓
PROMOTE
  ↓
return_result({ status: "COMMITTED" })
```

The variation advances committed lineage from `v0` to `v1`. This proves the object-native/language-native runtime remains a substrate under the existing AVO control plane rather than becoming a parallel orchestrator.

## Material finding from the first F5 run

The first packed F5 candidate failed before the fidelity workload could complete because one test fixture declared a live surface containing `rename/getName` while its root object implemented only `child()`.

ExHarness rejected the mismatch while binding the live authority:

```text
LIVE_OBJECT_MEMBER_NOT_ALLOWED
live object target method does not exist
```

The repair changed the fixture to implement the declared surface. The runtime, rubric and gate were not weakened. This is useful evidence that surface declaration is not enough to fabricate authority over a missing target implementation.

## Claim boundary

F5 proves the declared F1-F4 semantic target on a deterministic packed-package reference workload with an inspectable stable artifact and adversarial failures.

It does not prove:

- universal model reasoning or code-generation quality;
- provider-specific reliability;
- general task success outside the reference workload;
- production sandbox security of the checked-in child-process/`vm` worker;
- universal token, latency, cost, or model-turn improvement;
- scientific equivalence with every NOOA implementation detail.

Within that boundary, the fidelity expansion supports the architectural identity:

```text
ExHarness
  = AVO long-horizon control plane
  + NOOA-like object-native programmable-agent substrate
  + explicit authority / trust / verification boundaries
  + injected execution and infrastructure
```
