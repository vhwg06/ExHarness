# Oracle capabilities

Oracle is the current declared-source resolution boundary. It does not own workflow, lifecycle, acceptance or Core execution.

## O1 — Declared repository-context resolution
Outcome: Backend receives application-shaped context for exactly declared repository files.
Input: repository ref/revision + required paths + `repositoryReader`.
Guarantees: read only declared files; preserve source refs; validate concrete Backend context.
Failure: surface the concrete failing ref/path.
Limits: Oracle does not decide which files are semantically required or inject hidden context.
Details: `state.md`, `workflow.md`.

## O2 — Declared application-artifact resolution
Outcome: QA receives application-shaped context for exactly declared accepted Backend artifacts.
Input: artifact ref/path + producer work order + accepted revision + acceptance provenance + `artifactReader`.
Guarantees: external repository and internal application-artifact IO remain separate; provenance is preserved.
Failure: wrap the concrete application-artifact failure while preserving cause.
Limits: successful dereference is not artifact correctness or acceptance.
Details: `state.md`, `workflow.md`.

## O3 — Optional manifest-backed integrity/provenance validation
Outcome: protected QA can verify payload identity/provenance against the exact producer manifest.
Input: exact persisted manifest ref + required artifact + underlying reader.
Guarantees: validate ref/path, producer, revision, acceptance, stored revision, availability and SHA-256 content identity before returning ordinary `{ content, sourceRef }`.
Durable state: immutable `APPLICATION_ARTIFACT_MANIFEST v1` + publication receipt.
Failure: missing/conflict/provenance/content mismatch fails closed; never silently downgrade.
Limits: integrity is not semantic correctness, project acceptance, independent authenticity or retention authority.
Details: `artifact-manifest.md`.

## O4 — Exact manifest-scoped fresh QA
Outcome: fresh protected QA resolves through the exact manifest ref persisted in the application checkpoint.
Guarantees: filesystem-backed manifest state reconstructs without producer in-memory state; `forManifest(ref)` scopes reads to that handoff.
Failure: protected checkpoint cannot be read through an ordinary direct reader.
Limits: Oracle does not decide when `QA_PENDING` is committed; Application owns ordering.
Details: `artifact-manifest.md`, `../agentic-application/contracts.md`.

## Boundary rule

```text
Application: WHAT / WHY / application context shape
Oracle: WHERE declared source lives / HOW it is retrieved, adapted and validated
```

Oracle must not widen semantic requirements, create lifecycle state, authorize acceptance or invent a generic provider framework without concrete pressure.
