# BB-097 CLI session evidence

Checked 2026-09-29. This supplements the local `--help` probe; it does not execute a provider call or inspect user configuration.

- The [Antigravity headless documentation](https://www.antigravity.google/docs/cli/headless/) describes `agy --continue` and `--conversation`, shows a duration such as `15m` for `--print-timeout`, and shows a `conversation_id` in structured output. The locally installed agy 1.1.1 help advertises `--continue`, `--conversation` and `--print-timeout`, but does **not** advertise `--output-format`; BB-097 must not rely on that output mode at this installed version.
- The [Antigravity resume documentation](https://www.antigravity.google/docs/cli/commands/resume/) says `--continue` resolves the most recent conversation for the current workspace path. BB-097 uses a unique temporary worktree cwd per task run and sends the complete task and bounded feedback on each retry. The adapter does not read the CLI session cache.
- The local Kiro help example lists `fs_read` and `fs_write` for `--trust-tools`; it does not name a shell tool. WORKSPACE_EDIT trusts only those two names. FULL_AUTO uses the locally advertised `--trust-all-tools` flag.
- The local Codex resume help accepts a session ID and `-` to read its prompt from stdin. Codex `--json` is the only locally probed structured event stream used for a stable session ID.

The local probe result records the installed versions and exact help surfaces. A Worker re-runs it before implementing against newer CLI versions.
