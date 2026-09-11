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
7. Merge only when objective review can point to concrete evidence and unresolved gaps are explicit.

## Pull-request evidence

Every non-trivial kernel PR should expose both tracks and record:

- objective;
- implementation changes;
- manual vigilance checks;
- verification artifacts/evidence;
- automated verification, if any;
- independent or orthogonal evidence;
- residual gaps and assumptions.

The desired progression is:

```text
manual vigilance
      ↓
codify verification artifact
      ↓
automate harness capability
```

The point is not to convert every judgment into a test. The point is to make important verification observable, reusable, and increasingly automatable without losing judgment quality.
