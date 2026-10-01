# Agent tool grounded context

Source-synchronized projection of `packages/agent-tools/src/task-context.js`. Open questions live only in `docs/blackboard/state.md`.

## Optional required files

`AGENT_TASK_V1` accepts an optional `requiredFiles` list of unique relative POSIX paths. Paths that escape the workspace (`..` segments, absolute paths, `.git` segments) are rejected by `validateAgentTask` with a `TypeError` before anything else runs. A task without the list (omitted or empty) is byte-identical to older callers: the frozen task carries no `requiredFiles` key and no Oracle object is ever constructed.

## EXACT resolution before spawn

`resolveAgentTaskContext(task, { repositoryReader, maxMaterializedBytes, snapshotObserve })` maps a non-empty list to one `REQUIRED` evidence entry per file (`file-<i>`) against a `REPOSITORY` source snapshotted `EXACT` at the task `baseRevision`, then resolves it through the delivered Oracle facade (`createExactRepositoryProvider`, `createRetrievalPlanner`, `createOracleContextResolver`). The default repository reader runs `git show <revision>:<path>` in the source repository and reports `sourceRef: <revision>:<path>`. The default snapshot authority pins the task `baseRevision`; the default budget allows about one megabyte of materialized bytes.

Resolution runs inside `runSupervisedTask` after `validateAgentTask` and before the worktree is created. Only tasks that declare files pay for a catalog, planner and resolver.

## Grounded prompt and worktree copies

Consumable items are projected twice:

- the strategy prompt becomes `<prefix>\n\n<task prompt>`, where the prefix begins exactly with `ExHarness grounded context:` followed by one block per file (`path:`, `sourceRef:`, then an excerpt of at most 4000 characters, with a trailing `[truncated]` marker when the content is longer);
- after the worktree exists, the full bytes of each file are written to `.exharness/context/<path>` and a worktree-local `.exharness/.gitignore` containing `*` is written, so the copies never dirty `git status` and never enter the candidate commit. The exclusion is worktree-local and the source repository is never written.

The original task prompt object is not mutated.

## Fail-closed error

Anything unresolved throws `AgentTaskContextError` (`name: "AgentTaskContextError"`, `code: "CONTEXT_UNSATISFIED"`) before the agent process starts, so the fake-agent record stays absent:

- a missing file resolves `UNSATISFIED` with an unresolved `SOURCE_FAILURE`;
- an exhausted byte budget resolves `UNSATISFIED` with `BUDGET_EXHAUSTED` (a budget so small that even the empty materialization does not fit raises the contract `TypeError`, which is mapped to the same error);
- a snapshot authority that drifts between the pre and post observations raises a durability failure, mapped to status `STALE` with reason `STALE_DURING_RESOLUTION`.

`error.status` carries the Oracle resolution status (`UNSATISFIED`, `PARTIAL`) or `STALE`; `error.unresolved`, `error.failures` and `error.reason` carry the Oracle detail. The supervised result status enum stays `ACCEPTED | EXHAUSTED | TOOL_UNAVAILABLE`.

## Distinct from production adoption

The Backend and QA workers resolve their own production context through a different consumer owned by the agentic-system package. This consumer belongs to agent-tools supervision only: it grounds the files a supervised CLI agent starts from, and it never performs lexical, semantic or graph retrieval.
