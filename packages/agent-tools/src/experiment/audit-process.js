#!/usr/bin/env node
// Fresh-process audit: reopens every settled attempt under <out>/attempts from disk and runs the
// kernel auditAttempt with the persisted ledger events and a shared reset registry.
import { readFile, readdir } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { auditAttempt } from "@exharness/benchmark";

const out = process.argv[2];
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const registration = await readJson(join(out, "registration.json"));
const ledgerEvents = await readJson(join(out, "ledger-events.json"));
const resetRegistry = new Set();
const audits = [];
for (const unitId of (await readdir(join(out, "attempts"))).sort()) {
  const dir = join(out, "attempts", unitId);
  const evidenceRoot = join(dir, "evidence");
  const store = {
    async read(ref) {
      const path = normalize(join(evidenceRoot, ref));
      if (!path.startsWith(evidenceRoot + sep)) throw new Error(`ref escapes evidence root: ${ref}`);
      return readFile(path);
    }
  };
  const audit = await auditAttempt({
    registration, unit: await readJson(join(dir, "unit.json")), record: await readJson(join(dir, "record.json")),
    manifest: await readJson(join(dir, "manifest.json")), store, ledgerEvents, resetRegistry
  });
  audits.push({ attemptId: audit.attemptId, unitId: audit.unitId, status: audit.status, findings: audit.findings, pid: process.pid });
}
process.stdout.write(`${JSON.stringify(audits)}\n`);
