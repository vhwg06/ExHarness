# Oracle Reconciliation Phase

Status: **SCHEDULED RESEARCH TOPIC**

## Why this is a phase

Oracle is declared infrastructure, but its concrete implementation still lives inside `@exharness/agentic-system`. The original concrete-first colocation was acceptable as a temporary delivery choice; the architecture debt is that closure later treated lack of generic-resolver pressure as proof that no Oracle debt remained.

This phase reconciles **logical ownership, physical package ownership, dependency direction, source connectivity, durability/provenance, and closure guards**. It is intentionally larger than one file move or one implementation task.

## Phase invariant

```text
declared architectural ownership
        ==
physical module/package ownership
        ==
dependency direction
        ==
runtime authority boundary
```

For Oracle specifically:

```text
Application owns WHAT context is required
Oracle owns WHERE/HOW declared source data is read/adapted
Core executes with resolved context

Oracle != Application
Oracle != Core
Oracle != scheduling / acceptance / recovery / product authority
```

## Workstreams

### A — Physical ownership and package boundary — BB-060

Extract the existing concrete Oracle boundary from Agentic Application ownership without inventing a generic resolver/provider framework. Preserve current Backend/QA resolution semantics.

### B — Semantic port and dependency direction — BB-061

Make the Application ↔ Oracle compile-time and semantic dependency explicit and acyclic. Application schemas/requirements remain above Oracle; Oracle source IO remains below them.

### C — Concrete source connectivity and adapter topology — BB-062

Define concrete repository/application-artifact adapter ownership and the bounded shape for future external/MCP-backed sources. MCP, if justified, remains a source/capability adapter rather than an Oracle lifecycle.

### D — Provenance, durability and migration compatibility — BB-063

Preserve manifest validation, stable source refs, accepted-artifact provenance, durable Backend→QA continuation and failure/recovery semantics through the package split.

### E — Phase acceptance and architecture-drift closure — BB-064

Prove the real Backend and QA flows cross the infrastructure-owned Oracle boundary and add a deterministic architecture alignment check so the same logical/physical drift cannot be closed as zero debt again.

## Scheduling

```text
RESEARCH_SA
  BB-060 A ┐
  BB-061 B │ research may run ahead
  BB-062 C │
  BB-063 D │
  BB-064 E ┘

WORKER
  BB-060
    -> BB-061
      -> BB-062
        -> BB-063
          -> BB-064 phase acceptance
```

## Phase acceptance

The topic is not closed by creating `packages/oracle` alone. Closure requires:

- Oracle implementation physically owned by infrastructure;
- acyclic Application ↔ Oracle dependency direction matching documented authority;
- current Backend repository and QA application-artifact resolution behavior preserved;
- durable provenance/manifest/recovery semantics preserved;
- concrete source connectivity has explicit adapter ownership;
- old in-package Oracle implementation is retired;
- deterministic closure checks detect future architecture-to-source placement drift;
- Living Oracle architecture/state matches delivered physical topology.

## Non-goals

This phase does not require a generic `Resolver<T>`, provider registry, retrieval engine, cache lifecycle, autonomous Oracle agent, third source class, or MCP deployment merely to justify the package boundary.
