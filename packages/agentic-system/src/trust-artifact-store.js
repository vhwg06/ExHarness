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

function artifactRef(artifact) {
  return Object.freeze({ id: artifact.id, digest: artifact.digest });
}

function validateEvidenceArtifact(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "EvidenceArtifact is required");
  invariant(raw.type === "EVIDENCE", "trust artifact must be an EvidenceArtifact");
  const body = {
    type: raw.type,
    subject: raw.subject,
    kind: raw.kind,
    producer: raw.producer,
    environment: raw.environment,
    contentDigest: raw.contentDigest,
    uri: raw.uri ?? null,
    metadata: raw.metadata ?? null,
    generatedAt: raw.generatedAt
  };
  const digest = digestValue(body);
  invariant(raw.digest === digest && raw.id === `evidence:${digest}`, "EvidenceArtifact identity/digest mismatch");
  if (raw.content != null) {
    invariant(digestValue(raw.content) === raw.contentDigest, "EvidenceArtifact content digest mismatch");
  }
  return freezeClone(raw);
}

function validateDecisionArtifact(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "DecisionArtifact is required");
  invariant(raw.type === "DECISION", "trust artifact must be a DecisionArtifact");
  const body = {
    type: raw.type,
    subject: raw.subject,
    boundary: raw.boundary,
    policy: raw.policy,
    evaluator: raw.evaluator,
    evidenceManifest: raw.evidenceManifest,
    claims: raw.claims,
    unresolved: raw.unresolved,
    verdict: raw.verdict,
    generatedAt: raw.generatedAt,
    metadata: raw.metadata ?? null
  };
  const digest = digestValue(body);
  invariant(raw.digest === digest && raw.id === `decision:${digest}`, "DecisionArtifact identity/digest mismatch");
  invariant(
    raw.evidenceManifest?.digest === digestValue(raw.evidenceManifest?.refs ?? []),
    "DecisionArtifact evidence manifest digest mismatch"
  );
  return freezeClone(raw);
}

function validateAttestation(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "Attestation is required");
  invariant(raw.type === "ATTESTATION", "trust artifact must be an Attestation");
  const payload = {
    type: raw.type,
    boundary: raw.boundary,
    subject: raw.subject,
    decision: raw.decision,
    policy: raw.policy,
    issuer: raw.issuer,
    environment: raw.environment,
    evidenceManifest: raw.evidenceManifest,
    upstreamAttestations: raw.upstreamAttestations,
    issuedAt: raw.issuedAt
  };
  const payloadDigest = digestValue(payload);
  const digest = digestValue({ payloadDigest, signature: raw.signature });
  invariant(raw.payloadDigest === payloadDigest, "Attestation payload digest mismatch");
  invariant(raw.digest === digest && raw.id === `attestation:${digest}`, "Attestation identity/digest mismatch");
  return freezeClone(raw);
}

function normalizeRef(raw, type) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), `${type} ref is required`);
  const id = requireText(raw.id, `${type} ref.id`);
  const digest = requireText(raw.digest, `${type} ref.digest`);
  return Object.freeze({ id, digest });
}

function digestFileName(type, digest) {
  invariant(/^sha256:[0-9a-f]{64}$/.test(digest), `${type} ref.digest must be a sha256 digest`);
  return `${type.toLowerCase()}-${digest.slice("sha256:".length)}.json`;
}

export function createJsonTrustArtifactStore({ path, fs = nodeFs }) {
  requireText(path, "trustArtifactStore path");
  invariant(
    fs &&
      typeof fs.mkdir === "function" &&
      typeof fs.open === "function" &&
      typeof fs.readFile === "function" &&
      typeof fs.link === "function" &&
      typeof fs.unlink === "function",
    "trustArtifactStore requires filesystem mkdir/open/read/link/unlink capability"
  );

  async function readExisting(filePath, artifact, type) {
    const existing = JSON.parse(await fs.readFile(filePath, "utf8"));
    invariant(
      canonicalize(existing) === canonicalize(artifact),
      `${type} trust artifact digest already exists with different content`
    );
  }

  async function persist(type, raw, validate) {
    const artifact = validate(raw);
    await fs.mkdir(path, { recursive: true });
    const fileName = digestFileName(type, artifact.digest);
    const filePath = join(path, fileName);
    const tempPath = join(path, `.${fileName}.${randomUUID()}.tmp`);
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    let handle = null;
    let tempExists = false;

    try {
      handle = await fs.open(tempPath, "wx");
      tempExists = true;
      await handle.writeFile(serialized, "utf8");
      await handle.close();
      handle = null;

      try {
        await fs.link(tempPath, filePath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        await readExisting(filePath, artifact, type);
      }
    } finally {
      if (handle != null) await handle.close();
      if (tempExists) {
        try {
          await fs.unlink(tempPath);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }

    return artifactRef(artifact);
  }

  async function read(type, rawRef, validate) {
    const ref = normalizeRef(rawRef, type);
    const filePath = join(path, digestFileName(type, ref.digest));
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`${type} trust artifact unavailable: ${ref.id}`);
      throw error;
    }
    const artifact = validate(raw);
    invariant(artifact.id === ref.id && artifact.digest === ref.digest, `${type} trust artifact ref mismatch: ${ref.id}`);
    return artifact;
  }

  return Object.freeze({
    putEvidence(artifact) {
      return persist("EVIDENCE", artifact, validateEvidenceArtifact);
    },
    putDecision(artifact) {
      return persist("DECISION", artifact, validateDecisionArtifact);
    },
    putAttestation(attestation) {
      return persist("ATTESTATION", attestation, validateAttestation);
    },
    readEvidence(ref) {
      return read("EVIDENCE", ref, validateEvidenceArtifact);
    },
    readDecision(ref) {
      return read("DECISION", ref, validateDecisionArtifact);
    },
    readAttestation(ref) {
      return read("ATTESTATION", ref, validateAttestation);
    }
  });
}

export function requireTrustArtifactStore(store) {
  invariant(
    store &&
      typeof store.putEvidence === "function" &&
      typeof store.putDecision === "function" &&
      typeof store.putAttestation === "function" &&
      typeof store.readEvidence === "function" &&
      typeof store.readDecision === "function" &&
      typeof store.readAttestation === "function",
    "project acceptance requires durable trustArtifactStore read/write capability"
  );
  return store;
}
