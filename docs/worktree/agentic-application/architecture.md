# Agentic Application architecture

Desired architecture for composing domain-specific agentic systems above ExHarness Core and Oracle infrastructure.

## LAYERS

```text
external objective / product workflow
              |
              v
+---------------------------------------------+
|         Agentic Application Layer           |
|                                             |
|  Orchestrator ---------> Advisor            |
|       |                 bounded judgment    |
|       |                                     |
|       v                                     |
|  WorkOrder<C,R>                             |
|       |                                     |
|       +--> ContextRequirement<C>             |
|       |              |                      |
|       |              v                      |
|       |           Oracle port               |
|       |              |                      |
|       |        resolved context C           |
|       |              |                      |
|       v              |                      |
|  Worker<C,R> <-------+                      |
|       |                                     |
|       v                                     |
|  WorkResult<R> ----------------> Orchestrator|
+---------------+-----------------------------+
                |
                | worker execution
                v
+---------------------------------------------+
|               ExHarness Core                |
| runtime / cognition / lifecycle / authority |
| evidence / trust / effects / execution      |
+---------------------------------------------+

Infrastructure below application ports:

Oracle -> files / repo / Figma / OpenAPI / CI / docs / external APIs
Executor/workspace -> process / filesystem / sandbox / credentials / network
```

## DEPENDENCY DIRECTION

Application defines semantic ports and contracts. Infrastructure implements them.

```text
Agentic Application
    defines ContextRequirement / Worker / result semantics
               |
               v
          Oracle port
               ^
               |
Infrastructure adapters implement source resolution
```

The application must not depend on transport-specific source details such as MCP, REST, filesystem libraries or retrieval engines.

## COMPONENT BOUNDARIES

### Orchestrator

Application control plane only. It may call Advisor, Oracle and Workers through explicit contracts. It does not own model/runtime mechanics already supplied by ExHarness.

### Advisor

Application judgment boundary. Advisor may itself use ExHarness/model execution, but only returns structured proposals/assessments to the Orchestrator.

### Worker

Specialist application object. Worker role semantics and input/output contracts belong here. Worker implementation may compose ExHarness capabilities and injected execution/workspace infrastructure.

### Oracle

Infrastructure boundary satisfying application-defined ContextRequirements. Oracle is outside the Agentic Application Layer even though the application defines the port it consumes.

### ExHarness

Execution substrate beneath application roles. Agentic Application must not recreate ExHarness turn lifecycle, memory, tracing, trust, recovery or agent runtime abstractions.

## DEFAULT TOPOLOGY

Use manager-style specialist composition:

```text
Orchestrator
   |
   +--> Advisor?     structured judgment
   |
   +--> Oracle       resolve explicit context once for a WorkOrder
   |
   +--> Worker       execute bounded work
   |
   <--- WorkResult
```

Do not default to group chat, shared conversation takeover or model-selected speaker routing.

## RESEARCH PROVENANCE

The desired shape reuses proven semantics rather than framework runtimes:

- NOOA: typed object/specialist composition and deterministic coordination when semantics are known;
- OpenAI Agents SDK: manager-over-handoff topology for centrally controlled specialist delegation;
- Microsoft Agent Framework Magentic: separation between planning/progress judgment and execution control;
- CrewAI: explicit work-unit shape with expected output/context/dependency concepts;
- OpenHands Software Agent SDK: explicit execution/workspace boundary around agent work.

These are semantic references, not required runtime dependencies. ExHarness remains the execution substrate.
