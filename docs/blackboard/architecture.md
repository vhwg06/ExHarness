# Outer Blackboard architecture

Status: **CURRENT DEVELOPMENT COORDINATION MODEL**

```text
SOURCE / TESTS / RUNTIME
        |
        v
docs/living/system/*
CURRENT SYSTEM TRUTH
        ^
        |
        | selected bounded refs
        |
docs/blackboard/context/<work>/gNNNN-*.json
        ^
        |
docs/blackboard/state.md
CURRENT DEVELOPMENT ROUTING
```

The Blackboard does not explain the system. It points fresh sessions at the exact bounded context needed to perform current development work.

Two independent pipeline lanes consume the same Living Docs truth but own different work products:

```text
RESEARCH_SA
  -> research / architecture development artifacts
  -> accepted implementation input

IMPLEMENTATION_WORKER
  -> consumes accepted implementation input
  -> changes source/tests
  -> reconciles Living Docs when delivered semantics change
```

No pipeline may silently infer missing authority or missing project knowledge from a previous session.
