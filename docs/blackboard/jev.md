# Jev evaluation and delivery

The outer Blackboard has two contracts: OBJECTIVE -> READY_IMPLEMENT_PLAN through RESEARCH_SA, and exact READY_IMPLEMENT_PLAN -> DELIVERED_FEATURE through WORKER. Jev is the semantic judge for both. This tooling does not itself attest that a feature has been delivered.

## API and evidence

The trusted Node evaluator calls `POST https://api.typesafe.ai/v1/systemone` using `TYPESAFE_API_KEY`. For local use, copy `.env.example` to `.env` and fill the value after `TYPESAFE_API_KEY=`; `.env` is ignored by Git. An already exported shell or CI variable takes precedence. It sends one `{model,state,questions}` batch. Model is pinned to `jev-1.13.0`; aliases and unexpected returned models fail closed. See the [provider API](https://docs.typesafe.ai/api) and [atomic question guidance](https://docs.typesafe.ai/primitives).

The state includes the objective, semantic plan and bounded source/evidence contents, not a whole conversation or bare references. Readiness reads source at `contract.researchBaselineSha`; updating that exact baseline is an explicit research change. Large research sources are represented by deterministic bounded excerpts (head, structural outline and tail) while the evaluation state retains the hash and byte length of the complete file, so any hidden source change still invalidates the semantic cache. Research payloads also use a conservative byte ceiling below the provider's token context limit. Worker reads source from the exact candidate commit, includes changed surfaces and required seams/tests, and checks plan scope. A worker plan must also declare `livingDocs.refs`, all of which must be under `docs/living/`, inside the authorized write scope, listed as consolidated refs, and changed by the candidate. The worker payload includes their full document bodies and adds the plan's Living Docs statement as an independent Jev Choice question. Verification logs bind command, successful exit, candidate identity and content hash. Additional criterion evidence is attached through `contract.claimEvidence`.

The CI selector treats a fully bound `RESEARCH_SA/SATISFIED` readiness publication that advances the same semantic plan to `WORKER/EXECUTION` as a control-plane publication, not a new research candidate. Any other lane/routing mutation in a research candidate fails closed.

Questions are independent Choice questions. All must select SATISFIED to pass. IMPLEMENTATION_DEFECT and INSUFFICIENT_EVIDENCE return to worker repair; PLAN_INPUT_CONTRADICTION returns upstream. Research findings always stay in research. Confidence does not change the selected outcome. Invalid response shape, missing claims, model mismatch, missing evidence or stale hashes block publication.

Payload budget is 512 KiB, configured in `jev-policy.json`. Exceeding it requires more precise evidence selection; the tool does not silently truncate mandatory coverage. Research must replace generic migration verification mappings with criterion-specific commands and negative cases before readiness.

## Cache, cost and stability

Cache identity includes canonical materialized state, questions/spec, model, materializer/validator policy and lane. Keys ignore object key ordering and run metadata. Plan status and its readiness receipt are excluded from plan content hashing to avoid a circular binding. Source/evidence contents remain in the hash. A different candidate can reuse answers only when all evaluated content is identical; publication still binds the exact new subject.

Valid findings are cached as well as SATISFIED answers. Unchanged input never rerolls for acceptance. A repeated finding publication reports `noSemanticProgress`. Error responses are not cached. Cache entries are operational data under `.cache/blackboard-jev`, not canonical authority or artifact history.

API requests have a 30-second deadline and at most one transport/429/5xx retry. Auth/schema errors are not retried. Retry-After must fit within the deadline. Missing key, timeout and invalid responses cannot produce an evaluation artifact or a satisfied check. Non-success provider responses retain a bounded response body in the trusted CI error so request-shape/context failures are diagnosable without exposing credentials.

Metrics include request attempts, cache hit, payload bytes, token usage, latency, typed distributions and estimated cost. `pricing: null` means unknown monetary cost. To estimate cost, configure model, source URL, date, inputPerMillion and outputPerMillion; never infer a price from token count alone.

`npm run eval:blackboard-jev-stability` makes three uncached runs per labeled fixture for both lanes. It reports agreement, verdict flips, false-satisfied cases, usage and cost. It never publishes canonical judgment. It requires a real API key and is excluded from normal verification.

## Local lifecycle

1. Resolve current work from the graph. Claim a schedulable task with `npm run claim:blackboard -- <WORK_ID> <WORKER_ID>`, then materialize its context using the compatibility bootstrap command.
2. Research edits the current plan draft and resolves its recorded gaps. Materialize with `npm run materialize:blackboard-evaluation -- <WORK_ID>`.
3. Copy `.env.example` to `.env` and fill `TYPESAFE_API_KEY`, or set it in the process environment. Run `npm run eval:blackboard-jev -- <WORK_ID>`. Output is `artifacts/blackboard-jev/<WORK_ID>.json`; exit 2 means findings, not API failure.
4. Publish an evaluation produced by the trusted evaluator with `npm run publish:blackboard-evaluation -- <WORK_ID> <ARTIFACT>`. The publisher rereads current bindings and serializes publication with an exclusive lock. It updates current canonical artifacts and graph in place; completed publications are idempotent. An interrupted multi-file publication fails closed and requires reconciliation of the current files before work resumes. No lock is stolen on a timeout.
5. After readiness, set exact candidateSha/baselineSha and evidenceRef on the current task. The candidate must be committed. Run `npm run collect:blackboard-evidence -- <WORK_ID>` without provider credentials. Verification runs execute plan commands; attach domain observations via claimEvidence when logs are insufficient.
6. Evaluate/publish worker claims. SATISFIED advances only to MERGE_PENDING, and includes a SATISFIED Living Docs Choice for the plan's implementation description. The publisher stores the canonical Jev evaluation beside the current plan as `docs/blackboard/artifacts/ready-implement-plan/<WORK_ID>.<readiness|candidate>-jev-evaluation.json`. Merge using a merge commit or fast-forward, preserving candidate SHA. If the integrated tree changes, verify and evaluate a new candidate first.
7. Fetch main. Record exact mergeSha and current consolidatedRefs, then run `npm run verify:blackboard-delivery -- <WORK_ID> <MERGE_SHA>`. Verify checks candidate ancestry, tree identity and evaluated source still present on main.
8. `npm run publish:blackboard-delivery -- <WORK_ID> <MERGE_SHA>` writes the canonical receipt and completes routing. Commit the canonical publication changes through the repository's normal change process. Artifact upload alone never marks work DONE.

Canonical control-plane documents and generated artifacts may differ from the candidate checkout while evidence is collected; product source must match the candidate. No source code is taken from those control-plane changes for candidate evaluation. Provider credentials must not be present during verification-command execution.

## CI

`blackboard-router.yml` listens to the successful same-repository **pull-request** `test` workflow, which contains both kernel verification and the Living-doc impact gate. It is routing/control-plane only: if an exact WORKER or RESEARCH_SA subject requires semantic judgment, the router dispatches the separate `blackboard-jev.yml` workflow with exact `work_id`, subject SHA and exact trusted PR-base SHA. Therefore a run named `blackboard-jev` always represents one actual Jev evaluation path; no-op routing appears only under `blackboard-router`. Pushes run the separate `push-test` kernel workflow and do not create automatic Jev evaluations.

The router pins trusted routing/evaluator input to the exact PR base resolved from GitHub by tested head SHA and the subject to the exact tested PR head. Its dispatch carries those immutable SHAs into `blackboard-jev`, whose `collect Jev evidence` and `Jev evaluate` jobs cannot be skipped for a dispatched subject. RESEARCH_SA may contribute only its canonical plan draft and exact research baseline; objective, routing, evaluator policy and evaluator code remain trusted-PR-base data. Evidence collection runs without TypeSafe credentials; `Jev evaluate` alone receives `TYPESAFE_API_KEY`, calls the provider, validates the typed result and uploads `jev-evaluation-<WORK_ID>`. A canonical readiness-publication PR is handled by the router's `verify published Jev readiness` job instead of dispatching a second provider call.

Download the complete result bundle from this trusted workflow and use the publication command above against the current checkout. Keep the sibling implementation-result JSON and `evidence/<WORK_ID>` directory beside the evaluation. The publisher imports the result into the canonical `docs/blackboard/artifacts/ready-implement-plan/<WORK_ID>.implementation-result.json` path and evidence into `docs/blackboard/evidence`, after checking the current candidate/plan binding and log digests, then validates the full evaluation state. Commit these canonical files with the publication so future checkouts retain the evidence.

The canonical publisher rejects stale inputs; an uploaded or manually edited JSON file is not independent proof of provider provenance. Publishing is a trusted-controller action, not a worker self-acceptance API. CI does not bypass repository merge permissions or automatically push to main.

Offline validator, routing, cache and merge fixtures run in normal verification with mock transport and no API key. Live API evaluation and stability benchmarks do not run in that matrix.

## Current-only migration

`npm run migrate:blackboard-delivery` converts unfinished work into objective/plan bindings and research drafts, retaining task identities/dependencies. DONE evidence is co-located under the ready-plan directory. Any retained source material uses `.source.json` beside the canonical objective/plan; graph bindings select only the unsuffixed current contract. No generation siblings, history chains or retrospective judgments are created.

The evaluator's own initial implementation is bootstrapped by the explicit user instruction. It remains unconverged until real readiness, candidate judgment and merge evidence exist. Neither mock tests nor installation of this workflow count as a live Jev verdict.
