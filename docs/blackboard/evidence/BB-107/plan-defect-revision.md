
## Plan defect and revision

Worker implementation of the READY plan exposed a PLAN_DEFECT: decision D2's
per-evidence-ops byte split starves the delivered GRAPH_EXPANDED_V1 expansion
(`packages/oracle/src/planning-strategies.js:122`,
`Math.min(8192, free.materializedBytes)`, SKIP when `<1`), so 2 pinned
planning-strategies tests fail. Those tests are DELIVERED_TRUTH (BB-091) and
are outside this task's write scope.

Executed evidence: `docs/blackboard/evidence/BB-107/plan-defect-probe.mjs` →
`plan-defect-probe-result.json`, run on current main (hermetic, in-memory
fakes mirroring the pinned tests; pure simulation for the D2 and corrected
rules, no product edits).

- **DELIVERED_TRUTH.** Pinned graph scenario (budget maxItems 3 /
  maxProviderCalls 3 / maxMaterializedBytes 20000): base plans LOOKUP_SYMBOL
  and SEARCH_LEXICAL at 8192 bytes each (reserved 2 calls / 2 items / 16384
  bytes), leaving free 1 / 1 / 3616 bytes. GRAPH expansion reserves
  `min(8192, 3616) = 3616` bytes; the derived `src/b.js` candidate needs 805
  bytes, so status is EXPANDED with 2 candidates (base `src/a.js` needs 383
  bytes).
- **Defect.** The plan's D2 rule gives each REPOSITORY work
  `floor(remainingBytes / remainingOps-for-that-evidence)`: LOOKUP 10000 +
  SEARCH 10000 = 20000, leaving free.materializedBytes = 0, so GRAPH gets
  `min(8192, 0) = 0` and SKIPs BUDGET_EXHAUSTED with 1 candidate. This
  contradicts `candidates keep provider provenance and graph-derived items
  carry AUTHORITATIVE_SOURCE` (expects 2 candidates, D2 yields 1) and `GRAPH
  adds exactly one IMPORTS hop anchored at the top base candidate when budget
  remains` (expects EXPANDED, D2 yields SKIPPED).
- **RP1 baseline.** The 9000-byte EXACT file materializes to 9358 bytes by the
  `execute()` byte formula; main reserves 8192, so it stays BUDGET_EXHAUSTED.
  Any corrected rule must reserve at least 9358 bytes for that single work.

Corrected rule (RESEARCH_DESIRED_STATE, proven in the same probe simulation):

- READ_EXACT: items = 1, bytes = `max(1, floor(remainingBytes / R))` with R =
  remaining itemRefs (this and later evidences); a single-itemRef evidence
  receives all remaining bytes (RP1: 40000 >= 9358; 100-byte oversize stays
  BUDGET_EXHAUSTED).
- REPOSITORY LOOKUP_SYMBOL / SEARCH_LEXICAL / STRUCTURAL_MAP: items = 1,
  bytes = `max(1, floor(remainingBytes / remainingCalls))` with
  remainingCalls = remaining.maxProviderCalls − reserved.providerCalls at
  reserve time. Pinned scenario: 6666 + 6667 = 13333, free 1 / 1 / 6667, so
  GRAPH reserves 6667 bytes and EXPANDs (383- and 805-byte candidates fit).
  Tight budget (2 / 2 / 20000): 10000 + 10000, free 0, so expansion still
  SKIPs BUDGET_EXHAUSTED as pinned.
- TRAVERSE_GRAPH / FETCH_EXTERNAL: items = all remaining items, bytes = all
  remaining bytes (CG3 keeps items 4 / bytes 20000, both importer paths fit).
- No 8192 constant anywhere; every magnitude is a share of the remaining
  budget. `execute()` checks stay on `reservedBudget`.

The objective now carries the GRAPH non-starvation constraint and the plan is
back to DRAFT with corrected D2, a new RP4 criterion (byte shares 6666/6667,
free 1/1/6667, tight-budget SKIP) bound to two exact-titled tests, and
`test:oracle` covering the pinned planning-strategies tests.
