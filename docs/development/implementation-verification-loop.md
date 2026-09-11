# Implementation + Verification Loop

ExHarness development must treat verification as a first-class track, not as an afterthought attached to implementation.

The default development shape is:

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

## Rules

1. Before implementation, state the objective in observable terms.
2. Identify what a careful human would manually verify if no automation existed.
3. Externalize those checks into inspectable verification artifacts.
4. Automate stable/repeatable checks as capabilities when the leverage is worth the cost.
5. Keep implementation and verification evidence separate enough that one cannot silently certify itself.
6. Tests are allowed verification producers, but `tests green` is never the entire verification model by default.
7. A change is ready only when the objective review can point to concrete artifacts/evidence and unresolved gaps are explicit.

## Pull request evidence

Every non-trivial kernel PR should describe:

- objective;
- implementation changes;
- manual vigilance checks;
- verification artifacts produced;
- automated verification capabilities/checks, if any;
- independent or orthogonal evidence used;
- residual gaps / assumptions.

The goal is to progressively move high-value manual vigilance into reusable verification capabilities without pretending that every judgment should become a test.
