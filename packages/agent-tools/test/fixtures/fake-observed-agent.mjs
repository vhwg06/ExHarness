#!/usr/bin/env node
// Deterministic fake CLI for BB-098 observation tests. It never contacts a provider.
//   FAKE_OBSERVED_STDOUT  path whose bytes are written to stdout (default: one line)
//   FAKE_OBSERVED_STDERR  text written to stderr
//   FAKE_OBSERVED_LOG     path copied to the agy --log-file argument when present
//   FAKE_OBSERVED_EDIT    "1": rewrite sum.mjs and add an untracked notes.txt in cwd
//   FAKE_OBSERVED_EXIT    exit code (default 0)
//   FAKE_OBSERVED_HANG    "1": never exit (for timeout tests)
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
if (argv.includes("--version")) {
  process.stdout.write("fake-observed-agent 1.0.0\n");
  process.exit(0);
}
try { readFileSync(0); } catch { /* no stdin */ }
if (process.env.FAKE_OBSERVED_EDIT === "1") {
  writeFileSync(join(process.cwd(), "sum.mjs"), "export const sum = (a, b) => a + b;\n");
  writeFileSync(join(process.cwd(), "notes.txt"), "first\nsecond\nthird\n");
}
const logIndex = argv.indexOf("--log-file");
if (logIndex >= 0 && process.env.FAKE_OBSERVED_LOG) copyFileSync(process.env.FAKE_OBSERVED_LOG, argv[logIndex + 1]);
if (process.env.FAKE_OBSERVED_STDERR) process.stderr.write(process.env.FAKE_OBSERVED_STDERR);
const out = process.env.FAKE_OBSERVED_STDOUT ? readFileSync(process.env.FAKE_OBSERVED_STDOUT) : Buffer.from("fake agent finished\n");
if (process.env.FAKE_OBSERVED_HANG === "1") {
  process.stdout.write(out);
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(out, () => process.exit(Number(process.env.FAKE_OBSERVED_EXIT ?? 0)));
}
