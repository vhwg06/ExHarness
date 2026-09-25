# BB-065 development baseline

This is a development experiment, not an ExHarness product runtime. The direct arm imports pinned mini-SWE-agent and edits only a copied request-tracker fixture. The verifier runs outside the agent container against a separate candidate copy. The three fixture calibrations are distinct from the later 20-pair pilot; pilot repository selection needs a recorded product-owner decision in BB-074.

The committed `profile.json` is an incomplete template. It pins NVIDIA's [Nemotron 3.5 Lightning free endpoint](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b), observed on 2026-09-25 at $0 API charge per million input and output tokens. The public catalog lists release 2026-08-11 and version 1.0-preview; the hosted backend revision is not exposed, so the profile records `CATALOG_RELEASE` evidence and `backendRevision: null`. Token use remains measured even though API charges are zero. Keep `NVIDIA_API_KEY` in an ignored local `.env` or external environment; the driver maps it to `NVIDIA_NIM_API_KEY` in memory. The run profile and evidence belong under ignored `runs/` until reviewed for publication.

## Local preparation

Use Node 24.19.0, Python 3.12.13, Docker, and Playwright Chromium. Install the exact dependencies from `package-lock.json` and `requirements.lock`, then build the image from the digest-pinned `Dockerfile`. Before provider dispatch, commit the candidate source and update the run profile from that commit:

```powershell
npm ci --prefix scripts/delivery/baseline
uv venv --python 3.12.13 scripts/delivery/baseline/.venv
uv pip sync scripts/delivery/baseline/requirements.lock --python scripts/delivery/baseline/.venv/Scripts/python.exe
./scripts/delivery/baseline/node_modules/.bin/playwright install chromium
docker build -f scripts/delivery/baseline/Dockerfile -t exharness-bb065-agent:node24 scripts/delivery/baseline
npx -y node@24.19.0 scripts/delivery/baseline/prepare-profile.mjs --output scripts/delivery/baseline/runs/BB-065/profile.local.json --operator OPERATOR_ID --reviewer REVIEWER_ID --python scripts/delivery/baseline/.venv/Scripts/python.exe --image exharness-bb065-agent:node24
```

The profile registers distinct operator and reviewer IDs before any result; this calibration does not claim a human review action. The profile builder checks the exact candidate commit/tree, fixture and acceptance digests, Python and mini-SWE-agent commit, Chromium executable, lockfile, and Docker image digest. It rejects uncommitted candidate source. A changed candidate requires a new profile and fresh calibration runs.

## Run and review

```powershell
npx -y node@24.19.0 scripts/delivery/baseline/run.mjs --mode validate --registration calibration --profile scripts/delivery/baseline/runs/BB-065/profile.local.json
npx -y node@24.19.0 --env-file=.env scripts/delivery/baseline/run.mjs --mode live --profile scripts/delivery/baseline/runs/BB-065/profile.local.json --output scripts/delivery/baseline/runs/BB-065/evidence
npx -y node@24.19.0 scripts/delivery/baseline/run.mjs --mode audit-live --profile scripts/delivery/baseline/runs/BB-065/profile.local.json --output scripts/delivery/baseline/runs/BB-065/evidence
```

When provider quota requires spreading work across resets, pass `--task-id NORM-01`, `--task-id STATUS-01`, or `--task-id ORDER-01` to a LIVE invocation. Keep the same profile and output directory across invocations; the registration remains bound to the candidate and the report accumulates task results. Run `audit-live` only after all three calibration tasks have settled provider requests. An unknown provider outcome remains fenced and must not be counted as a successful run.

The NIM transport captures each original Chat Completions JSON response outside the agent workspace, fsyncs it, and binds its hash to the provider ledger before settlement. A completed HTTP 200 needs no retrieval call; a pending HTTP 202 is polled by `requestId` at `/v1/status/{requestId}`. The live command builds the NIM provider evidence export from those captures automatically. `audit-live` checks the captured bytes, returned model ID, usage, candidate digest, frozen verifier and report without credentials. Missing cache detail remains `null`; missing usage is `UNKNOWN` and fences later calls for that task. The report cannot assert pilot value from these three calibrations.

Run `node --test test/delivery/baseline-*.test.mjs` for deterministic contract, fixture, accounting and runner checks. Those tests are labelled deterministic and do not count as LIVE evidence.
