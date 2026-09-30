# Agent-tool durable recovery

A supervised agent-tool run can crash and resume the same semantic attempt: same
worktree, same tool session, same Core session and same candidate history, without
minting a second lineage and without changing the source repository.

## The run handle

`AGENT_TOOL_RUN_HANDLE_V1` (`packages/agent-tools/src/recovery.js`,
`AGENT_TOOL_RUN_HANDLE_VERSION`) is a JSON file at `<recoveryDir>/handle.json`:

```text
{ version, taskId, repositoryRoot, baseRevision, sourceHead, recoveryDir,
  worktreeRoot, candidateSha, coreSessionId, toolId, toolVersion, toolSessionRef,
  attemptIndex, maxAttempts, phase, status, feedback, createdAt, digest }
```

- `phase` is `ACT_COMPLETED` (the agent act finished and the candidate was saved)
  or `ATTEMPT_COMPLETED` (verification and evaluation for the attempt finished).
- `status` is `RUNNING` while the run is in flight, then `ACCEPTED`, `EXHAUSTED`
  or `TOOL_UNAVAILABLE`.
- `digest` is the SHA-256 of the canonical JSON body (every field except the
  digest itself). Any rewrite is detected on resume.

The handle is written after the ACT capability returns (Core has saved the current
candidate) and again after evaluation with the feedback for the next attempt. The
optional `onHandleWrite(handle)` hook (default null) is awaited after each persist;
tests use it to simulate a crash at an exact attempt and phase.

## Default runs still dispose

`runSupervisedTask` without `recoveryDir` is unchanged: a unique worktree under the
system temporary directory, a random Core session id, and worktree disposal in a
`finally` block after `ACCEPTED`, `EXHAUSTED` or throw.

With `recoveryDir`, the layout is `<recoveryDir>/{handle.json, worktree/, logs/,
core-session/}`: the worktree is created once, the Core session id is the stable
`agent-task:<task id>` persisted through a file-backed session store, and nothing
is disposed on completion or on throw. The caller disposes with
`disposeRecoverableRun(handle)`, which removes the git worktree registration and
deletes the recovery directory. Starting a first run while `handle.json` already
exists fails closed instead of starting a second attempt.

## Crash resume

`resumeSupervisedTask(handle, { tool, task, ... })` reopens the same worktree
(`git rev-parse HEAD`, never a second `worktree add`), reopens the same Core
session store, recovers the interrupted variation with force and runs the next
variation; it never calls start, so it cannot mint a second Core session. The
strategy resumes at the recorded attempt: an `ACT_COMPLETED` handle re-runs
verification and evaluation for the same attempt index without re-invoking the
agent, while an `ATTEMPT_COMPLETED` handle continues at the next attempt with the
recorded feedback. The tool session continues when the adapter supports it
(Codex resumes by session id; Kiro and agy resume by worktree directory, which is
also stable). Attempts recorded by a resume keep their original attempt indexes.
The original task (prompt plus verifications) is supplied again and its identity
must match the handle. The observation hook is passed through on the first run
and on resume.

## Fail-closed refusals

Resume refuses with `RecoveryError` (a `code` plus message, shaped like the trace
error) instead of starting a fresh temporary run:

| Code | Meaning |
| --- | --- |
| `MISSING_WORKTREE` | the worktree path is gone or is not a git worktree of the source repository |
| `DIGEST_MISMATCH` | the provided handle body does not match its digest |
| `SOURCE_HEAD_DRIFT` | the source repository HEAD moved away from `sourceHead` |
| `STALE_HANDLE` | the handle on disk is newer than the provided handle |
| `HANDLE_CURRENT` | a first run was requested while a current handle already exists |
| `HANDLE_COMPLETE` | resume was requested for an `ACCEPTED`, `EXHAUSTED` or `TOOL_UNAVAILABLE` handle |
| `TOOL_MISMATCH` | the tool id differs from the handle's tool id |
| `HANDLE_INVALID` | the handle or the resume task does not validate |

A current handle therefore identifies exactly one semantic attempt: neither a
second first-run nor a resumed run can fork a second lineage from it.
