# BB-065 development baseline

This is a development experiment, not an ExHarness product runtime. The direct arm imports pinned mini-SWE-agent and edits only a copied request-tracker fixture. The verifier runs outside the agent container against a separate candidate copy. The three fixture calibrations are distinct from the later 20-pair pilot; pilot repository selection needs a recorded product-owner decision in BB-074.

The committed `profile.json` is an incomplete template. Its OpenAI model is fixed to `gpt-6-luna` at `https://api.openai.com/v1`, Standard processing, using the [official model price](https://developers.openai.com/api/docs/models/gpt-6-luna) dated 2026-09-24. Only `OPENAI_API_KEY` names the credential; the key value belongs in the operator's environment and must not enter the repository or run artifacts. The run profile and evidence should be written under ignored `runs/` until reviewed for publication.

## Local preparation

Use Node 24.19.0, Python 3.12.13, Docker, and Playwright Chromium. Install the exact dependencies from `package-lock.json` and `requirements.lock`, then build the image from the digest-pinned `Dockerfile`. Before provider dispatch, commit the candidate source and update the run profile from that commit:

```powershell
npm ci --prefix scripts/delivery/baseline
uv venv --python 3.12.13 scripts/delivery/baseline/.venv
uv pip sync scripts/delivery/baseline/requirements.lock --python scripts/delivery/baseline/.venv/Scripts/python.exe
./scripts/delivery/baseline/node_modules/.bin/playwright install chromium
docker build -f scripts/delivery/baseline/Dockerfile -t exharness-bb065-agent:node24 scripts/delivery/baseline
npm exec --yes --package=node@24.19.0 -- node scripts/delivery/baseline/prepare-profile.mjs --output scripts/delivery/baseline/runs/BB-065/profile.local.json --operator OPERATOR_ID --reviewer REVIEWER_ID --python scripts/delivery/baseline/.venv/Scripts/python.exe --image exharness-bb065-agent:node24
```

The operator and reviewer must be different people. The profile builder checks the exact candidate commit/tree, fixture and acceptance digests, Python and mini-SWE-agent commit, Chromium executable, lockfile, and Docker image digest. It rejects uncommitted candidate source. A changed candidate requires a new profile and fresh calibration runs.

## Run and review

```powershell
npm exec --yes --package=node@24.19.0 -- node scripts/delivery/baseline/run.mjs --mode validate --registration calibration --profile scripts/delivery/baseline/runs/BB-065/profile.local.json
npm exec --yes --package=node@24.19.0 -- node scripts/delivery/baseline/run.mjs --mode live --profile scripts/delivery/baseline/runs/BB-065/profile.local.json --output scripts/delivery/baseline/runs/BB-065/evidence
node scripts/delivery/baseline/provider-export.mjs --profile scripts/delivery/baseline/runs/BB-065/profile.local.json --output scripts/delivery/baseline/runs/BB-065/evidence --reviewer REVIEWER_ID
npm exec --yes --package=node@24.19.0 -- node scripts/delivery/baseline/run.mjs --mode audit-live --profile scripts/delivery/baseline/runs/BB-065/profile.local.json --output scripts/delivery/baseline/runs/BB-065/evidence
```

The reviewer export independently retrieves stored Chat Completions by provider ID. OpenAI [requires `store: true` for retrieval](https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions/methods/retrieve); the driver sets this explicitly. A project that disallows storage cannot pass this evidence route. Unknown usage stays unknown and fences further requests for that task. The audit checks the provider records, candidate digest, frozen verifier and deterministic report. The report cannot assert pilot value from these three calibrations.

Run `node --test test/delivery/baseline-*.test.mjs` for deterministic contract, fixture, accounting and runner checks. Those tests are labelled deterministic and do not count as LIVE evidence.
