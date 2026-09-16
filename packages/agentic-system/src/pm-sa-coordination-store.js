import { randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import { join } from "node:path";
import {
  canonicalize,
  digestValue
} from "../../core-harness/src/index.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

const REF_PREFIX = "coordination";

export const PmSaCoordinationArtifactKind = Object.freeze({
  PM_PROPOSAL: "PM_COORDINATION_PROPOSAL",
  SA_ASSESSMENT: "SA_ARCHITECTURE_ASSESSMENT"
});

function normalizeKind(kind) {
  invariant(Object.values(PmSaCoordinationArtifactKind).includes(kind), "PM/SA coordination artifact kind is invalid");
  return kind;
}

function kindToken(kind) {
  return normalizeKind(kind).toLowerCase();
}

function recordFor(kind, payload) {
  normalizeKind(kind);
  invariant(payload && typeof payload === "object" && !Array.isArray(payload), "PM/SA coordination artifact payload is required");
  const body = freezeClone({ kind, payload });
  const digest = digestValue(body);
  return freezeClone({
    ...body,
    digest,
    ref: `${REF_PREFIX}:${kindToken(kind)}:${digest}`
  });
}

function parseRef(ref) {
  const value = requireText(ref, "PM/SA coordination artifact ref");
  const match = /^coordination:(pm_coordination_proposal|sa_architecture_assessment):(sha256:[0-9a-f]{64})$/.exec(value);
  invariant(match, `invalid PM/SA coordination artifact ref: ${value}`);
  const kind = match[1] === "pm_coordination_proposal"
    ? PmSaCoordinationArtifactKind.PM_PROPOSAL
    : PmSaCoordinationArtifactKind.SA_ASSESSMENT;
  return Object.freeze({ ref: value, kind, digest: match[2] });
}

function fileName(digest) {
  invariant(/^sha256:[0-9a-f]{64}$/.test(digest), "PM/SA coordination artifact digest must be sha256");
  return `coordination-${digest.slice("sha256:".length)}.json`;
}

function validateRecord(raw, expectedRef = null) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "PM/SA coordination artifact record is required");
  const kind = normalizeKind(raw.kind);
  const recreated = recordFor(kind, raw.payload);
  invariant(raw.digest === recreated.digest, "PM/SA coordination artifact digest mismatch");
  invariant(raw.ref === recreated.ref, "PM/SA coordination artifact ref mismatch");
  if (expectedRef != null) invariant(raw.ref === expectedRef, `PM/SA coordination artifact ref mismatch: ${expectedRef}`);
  return recreated;
}

export function isPmSaCoordinationArtifactRef(ref) {
  if (typeof ref !== "string") return false;
  try {
    parseRef(ref);
    return true;
  } catch {
    return false;
  }
}

export function createJsonPmSaCoordinationArtifactStore({ path, fs = nodeFs }) {
  requireText(path, "PM/SA coordination artifact store path");
  invariant(
    fs &&
      typeof fs.mkdir === "function" &&
      typeof fs.open === "function" &&
      typeof fs.link === "function" &&
      typeof fs.readFile === "function" &&
      typeof fs.unlink === "function",
    "PM/SA coordination artifact store requires filesystem mkdir/open/link/read/unlink capability"
  );

  async function persist(kind, payload) {
    const record = recordFor(kind, payload);
    await fs.mkdir(path, { recursive: true });
    const finalPath = join(path, fileName(record.digest));
    const tempPath = join(path, `.coordination-${randomUUID()}.tmp`);
    let handle = null;

    try {
      handle = await fs.open(tempPath, "wx");
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await handle.close();
      handle = null;

      try {
        await fs.link(tempPath, finalPath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = validateRecord(JSON.parse(await fs.readFile(finalPath, "utf8")));
        invariant(
          canonicalize(existing) === canonicalize(record),
          "PM/SA coordination artifact digest already exists with different content"
        );
      }
    } finally {
      if (handle != null) await handle.close();
      try {
        await fs.unlink(tempPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    return record.ref;
  }

  async function read(ref, expectedKind = null) {
    const parsed = parseRef(ref);
    if (expectedKind != null) invariant(parsed.kind === expectedKind, `PM/SA coordination artifact kind mismatch: ${ref}`);
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(join(path, fileName(parsed.digest)), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`PM/SA coordination artifact unavailable: ${ref}`);
      throw error;
    }
    return validateRecord(raw, parsed.ref);
  }

  return Object.freeze({
    putPmProposal(proposal) {
      return persist(PmSaCoordinationArtifactKind.PM_PROPOSAL, proposal);
    },
    putSaAssessment(assessment) {
      return persist(PmSaCoordinationArtifactKind.SA_ASSESSMENT, assessment);
    },
    async readPmProposal(ref) {
      return (await read(ref, PmSaCoordinationArtifactKind.PM_PROPOSAL)).payload;
    },
    async readSaAssessment(ref) {
      return (await read(ref, PmSaCoordinationArtifactKind.SA_ASSESSMENT)).payload;
    },
    readArtifact(ref) {
      return read(ref);
    }
  });
}

export function requirePmSaCoordinationArtifactStore(store) {
  invariant(
    store &&
      typeof store.putPmProposal === "function" &&
      typeof store.putSaAssessment === "function" &&
      typeof store.readPmProposal === "function" &&
      typeof store.readSaAssessment === "function" &&
      typeof store.readArtifact === "function",
    "PM/SA coordination requires durable coordination artifact store capability"
  );
  return store;
}
