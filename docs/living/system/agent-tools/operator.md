# Agent tools operator: deliver slice

`exharness-agent deliver --slice <manifest.json> [--command <path>] [--recovery-dir <dir>]`
runs one local Backend-then-QA delivery slice from a repository, a bounded
objective prompt and declared verifications, through supervised agent-tools.
There is no sandbox, no remote push, no remote CI and no OpenHands involved.

## Manifest

`DELIVER_SLICE_V1` (validated by `validateDeliverSlice` before any process
starts; extra fields are ignored):

```text
{ id, repositoryRoot, baseRevision, prompt, tool,
  backendVerifications[], qaVerifications[],
  requiredFiles?, recoveryDir?, maxAttempts?, timeoutMs? }
```

- `tool` is `codex`, `kiro` or `agy`.
- `baseRevision` is a full 40-hex commit sha.
- `backendVerifications` and `qaVerifications` are non-empty arrays of
  `{ name, command, args, timeoutMs }` with unique names per stage.
- `requiredFiles` is an optional pass-through list of repository-relative paths
  that is attached to the Backend agent task when non-empty.
- `recoveryDir` makes the Backend stage durable; `--recovery-dir` on the CLI
  overrides the manifest value.

## Backend then QA

The Backend stage maps `backendVerifications` (plus `requiredFiles`) onto one
agent task and runs it with `runSupervisedTask`. Only an `ACCEPTED` Backend
with a 40-hex accepted sha proceeds to QA; `EXHAUSTED` and `TOOL_UNAVAILABLE`
return with `qa` null and no accepted sha.

QA is independent: it runs on a fresh detached checkout of the accepted Backend
commit in a new temporary worktree, never on the Backend worktree. Each QA
verification runs bound to the accepted commit with `requireUnchangedTree`:

- a QA command that writes a file fails with `TREE_MUTATED`;
- verifying a different revision than the accepted sha fails with
  `REVISION_MISMATCH`;
- any other non-`PASS` fails the slice as well.

A QA failure yields status `QA_FAILED` with the Backend sha recorded; all QA
`PASS` yields `ACCEPTED`. The QA worktree is disposed in a `finally` block.
The source repository HEAD, branch refs and working tree are preserved.

## Resume

With `recoveryDir` the Backend stage persists a durable run handle:

- no handle file: the slice starts a recoverable Backend run;
- a `RUNNING` handle: the slice resumes the same Backend attempt, then runs QA
  on the accepted sha;
- an already `ACCEPTED` handle: the slice skips Backend entirely and runs QA
  on the recorded candidate sha;
- an `EXHAUSTED` or `TOOL_UNAVAILABLE` handle: the slice returns that status
  without running QA.
- a handle whose task identity (task id, repository root, base revision) does
  not match the slice: the slice is refused with `HANDLE_INVALID` and the
  recovery directory is left untouched.

A crash after the Backend act can therefore resume and continue QA on the same
accepted sha. A terminal slice disposes the recovery directory.

## Missing tool

When the configured executable is not installed the slice returns
`TOOL_UNAVAILABLE` with reason `NOT_INSTALLED` and never `ACCEPTED`.

Process exit codes: `0` only for `ACCEPTED`; `1` for `QA_FAILED` or
`EXHAUSTED`; `2` for `TOOL_UNAVAILABLE`; `64` for usage errors such as a
missing `--slice` (which throws before any agent process starts).

## Trust boundary

This is a local composition slice: it shows the delivered Backend-to-QA
composition runs end to end on this machine. It is not first-slice
product-value evidence and not a controlled-benchmark pilot. Every slice result
carries a `claimBoundary` field (exported as `LOCAL_SLICE_CLAIM_BOUNDARY`)
marking it as a local composition slice, so it cannot be mistaken for either. The agent itself is not sandboxed: it runs with
your CLI permissions, with cwd at a temporary git worktree only (see
`state.md`).
