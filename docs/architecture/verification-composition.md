# Objective Verification Composition

## Objective

A candidate must not become promotable merely because one check says PASS or because the same verifier is run repeatedly. ExHarness composes candidate-bound verification artifacts before the domain objective is allowed to certify the candidate.

```text
verification producers
  manual / capability / external
            |
            v
  VerificationArtifact[]
            |
            v
 deterministic assessment
  - conflicts
  - failures
  - required claims
  - source diversity
            |
      ready / gap
            |
            v
    domain objective
            |
            v
     AVO evaluation
            |
            v
   continue / promote
```

## Separation of responsibilities

Verification producers answer narrow claims and emit evidence-bearing artifacts. The deterministic assessment layer does not decide the domain objective; it only checks whether the declared verification policy is ready to let the objective judge the candidate.

The domain objective remains responsible for the final task-specific judgment. It receives the full current-candidate verification artifacts and their assessment.

## Policy

A verification policy may declare required claims and the minimum number of distinct source identities that must PASS each claim.

```js
{
  requirements: [
    { claim: "correctness", minSources: 2 }
  ],
  rejectFailures: true,
  rejectConflicts: true
}
```

The same source repeated multiple times counts once. This prevents repeated execution of one verifier from masquerading as multiple verification perspectives.

PASS and FAIL for the same claim remain visible as a conflict. Missing PASS source diversity remains visible as incompleteness. With the default policy, any observed FAIL or PASS/FAIL conflict blocks readiness.

## Evaluation input freshness

A PASS only certifies the exact observation and verification snapshot seen by that evaluation.

```text
observations O_t + verifications V_t
              |
              v
          evaluation PASS
              |
       new O or new V arrives
              |
              v
        previous PASS stale
              |
              v
          re-evaluate
```

The evaluation metadata persists `inputSnapshot.observationIds` and `inputSnapshot.verificationIds`. Promotion compares those IDs with the current candidate-bound inputs. If either set changed after evaluation, promotion is rejected until the candidate is evaluated again.

This invariant was added after manual verification found a failure mode where a later contradictory verification artifact could arrive after PASS while promotion still used the older evaluation.

## Important limitation

Distinct source identity is **not proof of semantic independence**. Two differently named verifiers may still share implementation, assumptions, data, or failure modes. ExHarness therefore calls this source diversity, not independent verification.

Semantic independence remains a verification-design responsibility for the consuming harness. A later capability may model provenance/dependency graphs strongly enough to automate more of that judgment, but the kernel must not pretend that naming two sources proves independence.

## Development verification for this slice

Manual vigilance should challenge at least these cases:

1. run the same verifier repeatedly and confirm it cannot satisfy `minSources > 1`;
2. create PASS and FAIL artifacts for the same claim and confirm the conflict blocks readiness;
3. omit a required claim/source and confirm the domain objective is not called;
4. satisfy source diversity and confirm the objective receives the assessment before promotion;
5. confirm candidate freshness still applies, so stale artifacts never enter the current assessment;
6. add verification evidence after PASS and confirm promotion requires re-evaluation;
7. add an observation after PASS and confirm promotion requires re-evaluation.

Automated tests guard these cases, but test success is only one verification artifact for the implementation objective.
