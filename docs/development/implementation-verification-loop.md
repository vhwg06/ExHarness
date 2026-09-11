# Implementation + Verification Loop

ExHarness development treats verification as a first-class track, not as an afterthought attached to implementation.

```text
                 CHANGE OBJECTIVE
                       |
             +---------+---------+
             |                   |
             v                   v
      IMPLEMENTATION TRACK   VERIFICATION TRACK
             |                   |
      design / mutate        manual vigilance
             |                   |
      candidate change       codify checks
             |                   |
             |            VerificationArtifact
             |                   |
             |           automate when useful
             |                   |
             |          verifier / capability
             |                   |
             +---------+---------+
                       |
                       v
                OBJECTIVE REVIEW
                       |
                 +-----+-----+
                 |           |
                GAP         PASS
                 |           |
              repair       merge
```

## Development contract

1. State the change objective in observable terms before implementation.
2. Identify what a careful human would manually verify if no automation existed.
3. Externalize those checks as inspectable verification artifacts/evidence.
4. Automate stable, repeatable checks when the leverage is worth the cost.
5. Keep implementation and verification evidence separate enough that implementation cannot silently certify itself.
6. Tests may be verification producers, but `tests green` is not the entire verification model by default.
7. For any mechanism whose amount materially changes behavior, state its context and intended dose instead of assuming `more = better`.
8. Challenge both under-dose and over-dose when practical; if a useful range cannot yet be benchmarked, record that uncertainty explicitly.
9. Treat defaults as bounded starting doses unless evidence supports a stronger optimality claim.
10. Merge only when objective review can point to concrete evidence and unresolved gaps are explicit.

The cross-cutting architecture rule is documented in `docs/architecture/dosage-principle.md`.

## Pull-request evidence

Every non-trivial kernel PR should expose both tracks and record:

- objective;
- implementation changes;
- manual vigilance checks;
- verification artifacts/evidence;
- automated verification, if any;
- independent or orthogonal evidence;
- relevant dosage/context assumptions for mechanisms being introduced;
- residual gaps and assumptions.

When dosage is material, the PR should answer:

```text
What happens with too little?
What range are we intentionally targeting?
What happens with too much?
Which context variables move that range?
What evidence would justify changing the default?
```

The desired progression is:

```text
manual vigilance
      ↓
codify verification artifact
      ↓
automate harness capability
```

The point is not to convert every judgment into a test. The point is to make important verification observable, reusable, and increasingly automatable without losing judgment quality.

Likewise, the point is not to maximize verification, context, guardrails, review or any other practice. The point is to apply enough of the mechanism to address the current risk and objective without silently turning its marginal benefit negative.