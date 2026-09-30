# Oracle context budgets

Source-synchronized projection of `packages/oracle/src/context-budget.js`. Open Oracle questions live only in the Blackboard state document.

## Delivered budget profile

`defineContextBudgetProfile` validates a `CONTEXT_BUDGET_PROFILE` (version 1)
keyed by `modelProfileRef`, with a rendered-character ceiling, reserved
characters, a measured block envelope, per-counter limits and an optional
exact tokenizer:

```text
packages/oracle/src/context-budget.js
  -> defineContextBudgetProfile(raw)          validate + identity (profileId)
  -> deriveRequirementBudget(profile)        ContextRequirement.budget
  -> deriveNextStepBudget(profile, previous) remaining step budget
  -> measureTokens(profile, text, impl)      UNKNOWN unless exact tokenizer
```

Import path: consumers import from
`packages/oracle/src/context-budget.js` directly. The names are deliberately
not re-exported from `packages/oracle/src/index.js`, whose export list is
pinned by the architecture boundary (same precedent as the planning
strategies and the progressive-resolution surface).

Every numeric field (`renderedCharCeiling`, `reservedChars`,
`blockEnvelopeChars`, `maxItems`, `maxProviderCalls`, `maxResolutionSteps`)
must be a positive safe integer; `tokenizer` is `null` or
`{ id, version }`. Identity is `profileId`, the SHA-256 of the canonical
profile body, so equal profiles share an id and any field change moves it.

## Derivation

`deriveRequirementBudget(profile)` returns the exact requirement budget:

```text
maxMaterializedBytes = renderedCharCeiling - reservedChars - blockEnvelopeChars
```

A non-positive result is rejected. Materialization bytes are the UTF-8 byte
length of the canonical items, which is always greater than or equal to the
UTF-16 code-unit length a projection of those items renders as, so a
projection rendering the canonical items renders at most
`maxMaterializedBytes` characters plus the block envelope.

`deriveNextStepBudget(profile, previousResolution)` subtracts the previous
resolution's cumulative `consumed` counters from the derived budget and
returns the remaining `{ maxItems, maxMaterializedBytes, maxProviderCalls,
maxResolutionSteps }` for an explicit next step. Any exhausted counter
(remaining below 1) is rejected instead of yielding an unusable budget.

## Measured render fit

The envelope is measured, not guessed: rendering an empty-items block named
`oracle-budget` through Core `renderAgentContext` yields **203 chars**, and
the profile declares `blockEnvelopeChars: 512`, above the measurement. With
`renderedCharCeiling: 8192` and `reservedChars: 1024` the derived byte
budget is **6656**. Resolving one requirement per content class at that
budget and rendering the projected items through Core gives:

```text
ascii (repetition):            materialized 2945 B -> rendered 3146 chars
quotes/newlines/tabs:          materialized 2828 B -> rendered 3029 chars
BMP (accents/CJK/Greek):       materialized 3919 B -> rendered 2520 chars
astral (emoji surrogate pairs): materialized 4148 B -> rendered 2369 chars
near-bound ascii (16 B under): materialized 6640 B -> rendered 6841 chars
near-bound quotes (16 B under): materialized 6640 B -> rendered 6841 chars
```

Every fixture renders well under the 8192 ceiling, including the near-bound
fixtures sized programmatically to sit 16 bytes under the 6656-byte derived
budget. A fixture sized exactly 1 byte over the budget resolves
`BUDGET_EXHAUSTED` with no items. ASCII-family content
renders at materialization bytes plus the constant envelope remainder; BMP
and astral content renders shorter than its byte count because one UTF-16
code unit (or surrogate pair) encodes to multiple UTF-8 bytes. Core still
enforces its own `maxSerializedChars` independently of these byte budgets.

## UNKNOWN token semantics

`measureTokens` never derives tokens from bytes. It calls the injected
`countTokens` only when the profile declares a tokenizer and the injected
implementation reports the same `{ id, version }`; otherwise it returns
`{ tokens: null, status: 'UNKNOWN' }`. A declared tokenizer with no
implementation, a missing `countTokens` function, or an id/version mismatch
all report `UNKNOWN`. Token results are operational diagnostics and never
enter resolution identity.

## Whole-item overflow

Over-budget evidence keeps the facade semantics: it becomes
`BUDGET_EXHAUSTED` and whole items are dropped, never truncated or
rewritten. Kept items are byte-identical to the same items resolved under a
wide budget. The profile layer adds no truncation, summarization or
compression path.

## Limits

- No tokenizer dependency is bundled; without an injected implementation
  with exact identity every reading is `UNKNOWN`.
- The module never imports Core; render fit is proven only by tests that
  compose Oracle resolution with Core rendering.
- Requirement budget fields, resolution identity and the Core render
  policy/defaults are unchanged.
- Reproduce with `node --test packages/oracle/test/context-budget.test.js`
  and `node --test test/oracle-budget-render-fit.test.mjs`.
