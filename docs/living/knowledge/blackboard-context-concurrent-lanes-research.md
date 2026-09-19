# Blackboard Context Plane — concurrent-lane review currentness research

Status: **PENDING REVIEW**

## Problem

The repository Context Plane currently validates a REVIEW target by comparing the immutable candidate SHA to local git HEAD and rejecting changed paths outside allowedPostTargetEnvelopePaths.

In GitHub pull-request CI, actions/checkout checks out the synthetic merge ref (refs/remotes/pull/<n>/merge). Therefore local HEAD is not necessarily the pull-request branch head. It includes current base-branch state.

This couples one item's review-currentness check to unrelated base advancement.

## Observed evidence

PR #155 CI checked out synthetic merge commit e617465..., merging branch head a0a2c6c... into base 908ffac....

The Context Plane verifier then evaluated the still-current BB-046 review target against that synthetic merge HEAD and rejected the A.1 source paths as REVIEW_TARGET_STALE.

For PR #155 this rejection is correct for a different reason: main still exposes BB-046 generation 4 as current and no BB-047 implementation authority exists yet.

However, the checkout semantics expose a separate concurrency hazard: after a review target is validly bound to one PR branch, an unrelated commit merged into its base can appear in synthetic merge HEAD and falsely stale the review target.

## Required semantic distinction

review target currentness = immutable candidate -> actual PR branch head
review target currentness != immutable candidate -> synthetic merge checkout HEAD

base compatibility = normal CI/tests against synthetic merge
base compatibility != review-subject identity

The two checks answer different questions.

Review currentness asks whether the submitted candidate branch changed outside the declared envelope.

Merge CI asks whether that candidate composes with the latest base.

A base-only change must be allowed to fail compatibility tests, but must not silently rewrite the identity of the review subject.

## Candidate correction

For pull-request CI, use github.event.pull_request.head.sha as an explicit comparison endpoint. Diff reviewTarget.candidateHeadSha -> comparisonEndpoint.

For local/non-PR verification, comparisonEndpoint = HEAD.

The workflow should pass the exact PR head SHA as an explicit environment input. The verifier must use it only as the comparison endpoint; it must not require reviewTarget.candidateHeadSha == PR_HEAD_SHA, because allowed post-target envelope commits intentionally advance the branch head.

## Fail-closed requirements

- immutable review target object must exist locally;
- explicit PR comparison endpoint must exist locally;
- target must be an ancestor of comparison endpoint;
- every target..endpoint changed path must be in the allowed post-target envelope;
- missing/invalid endpoint fails closed;
- synthetic merge HEAD remains the runtime state used by the rest of CI/tests;
- base-only changes never count as candidate-surface drift;
- candidate branch changes outside the envelope still stale the review;
- no fallback may infer PR head from commit-parent position.

## Architectural consequence

Context currentness is item/candidate authority. Merge compatibility is repository integration evidence. Combining them through one git HEAD creates an accidental global serialization point: one review lane can become sensitive to unrelated work merged elsewhere.

The Context Plane should preserve independent lanes:

item A review identity -> item A branch history
item B implementation -> separate branch/history
latest base -> integration compatibility for both, not authority identity for either

## Proposed implementation slice after review

- update .github/workflows/test.yml to expose exact pull-request head SHA to the verifier;
- update scripts/blackboard-context-verify.mjs to use explicit comparison endpoint for review-surface drift;
- add tests for allowed envelope commit, candidate-path mutation rejection, unrelated synthetic-base change ignored for review identity, and missing/unknown PR-head rejection;
- retain full-history checkout.

This research does not authorize that source change.
