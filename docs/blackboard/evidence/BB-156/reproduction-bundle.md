# BB-156 historical research reproduction bundle

`reproduction-bundle.json` retains ten complete compressed model sources, logs
and reports. This is historical scratch-model evidence; it does not establish
native Blackboard V2 implementation, current parity, live cutover or delivery.
The bundle's `extract` field gives the exact historical Git pins, environment
variables and commands. Use Node 24 in an owned scratch directory. Never run the
model against current-work authority or treat its historical counts as migration
inputs. The Worker must capture a fresh held snapshot and compare actual native
`nextActions`/`buildContext` on the cutover transaction.

To extract, load JSON, base64-decode and gzip-decompress every `files` entry;
verify the decoded byte count and SHA-256 before writing the named scratch file.
Run `node --test probe.test.mjs` with `V2_RESEARCH_SOURCE_ROOT` pointing at a Git
repository containing the bundle's exact source commit. For the separate all-id
calibration, follow `extract` with `V2_PARITY_SOURCE_ROOT` pointing at the stated
immutable checkout. Output stays in scratch; no checkout or authority is mutated.

Before archival, all ten entries were decoded and their lengths and digests
verified, including the full 148,042-byte parity report. Original compressed bytes
and report contents are retained unchanged. The readiness plan binds this bundle
by path, immutable Git commit and raw-file SHA-256.
