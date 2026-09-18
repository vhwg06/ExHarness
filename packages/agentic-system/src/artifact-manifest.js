import { createHash, randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import { join } from "node:path";

import { canonicalize, digestValue } from "../../core-harness/src/index.js";
import { BackendCompletionAction } from "./backend-completion.js";
import { validateBlackboardPersistedPayload } from "./blackboard-json-payload.js";

export const ApplicationArtifactManifestKind = "APPLICATION_ARTIFACT_MANIFEST";
export const ApplicationArtifactManifestVersion = 1;

export const ArtifactAvailability = Object.freeze({
  AVAILABLE: "AVAILABLE",
  UNAVAILABLE: "UNAVAILABLE"
});

export const ArtifactManifestErrorCode = Object.freeze({
  MANIFEST_MISSING: "ARTIFACT_MANIFEST_MISSING",
  MANIFEST_CONFLICT: "ARTIFACT_MANIFEST_CONFLICT",
  PRODUCER_MISMATCH: "ARTIFACT_PRODUCER_MISMATCH",
  PRODUCER_REVISION_MISMATCH: "ARTIFACT_PRODUCER_REVISION_MISMATCH",
  ACCEPTANCE_DECISION_MISMATCH: "ARTIFACT_ACCEPTANCE_DECISION_MISMATCH",
  STORED_REVISION_MISMATCH: "ARTIFACT_STORED_REVISION_MISMATCH",
  UNAVAILABLE: "ARTIFACT_UNAVAILABLE",
  CONTENT_MISMATCH: "ARTIFACT_CONTENT_MISMATCH"
});

export class ArtifactManifestError extends Error {
  constructor(code, message, { cause = null } = {}) {
    super(message, cause == null ? undefined : { cause });
    this.name = "ArtifactManifestError";
    this.code = code;
  }
}

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function requireRecord(value, name) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  return value;
}

function uniqueTextArray(value, name) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  const normalized = (value ?? []).map((entry, index) => requireText(entry, `${name}[${index}]`));
  invariant(new Set(normalized).size === normalized.length, `${name} must not contain duplicates`);
  return normalized;
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function parseDecisionRef(raw, name) {
  const value = requireRecord(raw, name);
  return Object.freeze({
    id: requireText(value.id, `${name}.id`),
    digest: requireText(value.digest, `${name}.digest`)
  });
}

function decisionSemanticDigest(raw) {
  const value = requireRecord(raw, "Backend acceptance decision");
  const semantic = {};
  for (const [key, entry] of Object.entries(value)) {
    if (["id", "digest", "generatedAt"].includes(key)) continue;
    semantic[key] = structuredClone(entry);
  }
  return Object.keys(semantic).length === 0 ? null : digestValue(semantic);
}

function normalizePath(path, name) {
  return path == null ? null : requireText(path, name);
}

function artifactKey(ref, path) {
  return `${ref}\u0000${path ?? ""}`;
}

function contentDigest(content) {
  invariant(typeof content === "string", "artifact content must be a string");
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function parseRetention(raw) {
  const value = requireRecord(raw, "artifact manifest retention");
  return Object.freeze({
    policyRevision: requireText(value.policyRevision, "artifact manifest retention.policyRevision"),
    pinnedBy: uniqueTextArray(value.pinnedBy ?? [], "artifact manifest retention.pinnedBy")
  });
}

function parseEntry(raw, index) {
  const value = requireRecord(raw, `artifact manifest entries[${index}]`);
  const availability = value.availability ?? ArtifactAvailability.AVAILABLE;
  invariant(
    Object.values(ArtifactAvailability).includes(availability),
    `artifact manifest entries[${index}].availability is invalid`
  );
  const digest = requireText(value.contentDigest, `artifact manifest entries[${index}].contentDigest`);
  invariant(/^sha256:[0-9a-f]{64}$/.test(digest), `artifact manifest entries[${index}].contentDigest must be a sha256 digest`);
  return Object.freeze({
    ref: requireText(value.ref, `artifact manifest entries[${index}].ref`),
    ...(value.path == null ? {} : { path: requireText(value.path, `artifact manifest entries[${index}].path`) }),
    storedRevision: requireText(value.storedRevision, `artifact manifest entries[${index}].storedRevision`),
    contentDigest: digest,
    availability
  });
}

function manifestBody(raw) {
  const value = requireRecord(raw, "ApplicationArtifactManifest");
  invariant(
    value.kind === ApplicationArtifactManifestKind,
    `ApplicationArtifactManifest.kind must be ${ApplicationArtifactManifestKind}`
  );
  invariant(
    value.version === ApplicationArtifactManifestVersion,
    `ApplicationArtifactManifest.version must be ${ApplicationArtifactManifestVersion}`
  );
  invariant(Array.isArray(value.entries) && value.entries.length > 0, "ApplicationArtifactManifest.entries must contain at least one artifact");
  const entries = value.entries.map(parseEntry);
  const keys = entries.map((entry) => artifactKey(entry.ref, entry.path ?? null));
  invariant(new Set(keys).size === keys.length, "ApplicationArtifactManifest.entries must not contain duplicate ref/path pairs");
  return {
    kind: ApplicationArtifactManifestKind,
    version: ApplicationArtifactManifestVersion,
    producerWorkOrderId: requireText(value.producerWorkOrderId, "ApplicationArtifactManifest.producerWorkOrderId"),
    producerRevision: requireText(value.producerRevision, "ApplicationArtifactManifest.producerRevision"),
    acceptanceDecision: parseDecisionRef(value.acceptanceDecision, "ApplicationArtifactManifest.acceptanceDecision"),
    ...(value.acceptanceDecisionSemanticDigest == null
      ? {}
      : {
          acceptanceDecisionSemanticDigest: (() => {
            const digest = requireText(
              value.acceptanceDecisionSemanticDigest,
              "ApplicationArtifactManifest.acceptanceDecisionSemanticDigest"
            );
            invariant(
              /^sha256:[0-9a-f]{64}$/.test(digest),
              "ApplicationArtifactManifest.acceptanceDecisionSemanticDigest must be a sha256 digest"
            );
            return digest;
          })()
        }),
    retention: parseRetention(value.retention),
    entries
  };
}

export function defineApplicationArtifactManifest(raw) {
  validateBlackboardPersistedPayload(raw, { path: "$.manifest" });
  const body = manifestBody(raw);
  const digest = digestValue(body);
  const ref = `artifact-manifest://${digest}`;
  if (raw.digest != null) invariant(raw.digest === digest, "ApplicationArtifactManifest.digest mismatch");
  if (raw.ref != null) invariant(raw.ref === ref, "ApplicationArtifactManifest.ref mismatch");
  return freezeClone({ ...body, digest, ref });
}

function normalizedProducedArtifact(raw, index, revision) {
  const value = requireRecord(raw, `producedArtifacts[${index}]`);
  return Object.freeze({
    ref: requireText(value.ref, `producedArtifacts[${index}].ref`),
    path: normalizePath(value.path, `producedArtifacts[${index}].path`),
    storedRevision: value.storedRevision == null
      ? revision
      : requireText(value.storedRevision, `producedArtifacts[${index}].storedRevision`),
    content: typeof value.content === "string"
      ? value.content
      : (() => { throw new TypeError(`producedArtifacts[${index}].content must be a string`); })()
  });
}

export function captureAcceptedBackendArtifactManifest({
  backendRun,
  producedArtifacts,
  retention
}) {
  const run = requireRecord(backendRun, "backendRun");
  invariant(run.completion?.action === BackendCompletionAction.ACCEPT, "artifact manifest capture requires ACCEPTED Backend completion");
  const producerWorkOrderId = requireText(run.order?.id, "backendRun.order.id");
  const producerRevision = requireText(run.result?.revision, "backendRun.result.revision");
  const acceptanceDecision = parseDecisionRef(run.completion?.decision, "backendRun.completion.decision");
  invariant(Array.isArray(run.result?.artifacts) && run.result.artifacts.length > 0, "artifact manifest capture requires Backend result artifacts");
  invariant(Array.isArray(producedArtifacts), "producedArtifacts must be an array");

  const expected = run.result.artifacts.map((artifact, index) => {
    const value = requireRecord(artifact, `backendRun.result.artifacts[${index}]`);
    return {
      ref: requireText(value.ref, `backendRun.result.artifacts[${index}].ref`),
      path: normalizePath(value.path, `backendRun.result.artifacts[${index}].path`)
    };
  });
  const produced = producedArtifacts.map((artifact, index) => normalizedProducedArtifact(artifact, index, producerRevision));
  invariant(produced.length === expected.length, "producedArtifacts must exactly cover accepted Backend artifacts");

  const byKey = new Map(produced.map((artifact) => [artifactKey(artifact.ref, artifact.path), artifact]));
  invariant(byKey.size === produced.length, "producedArtifacts must not contain duplicate ref/path pairs");
  const entries = expected.map((artifact) => {
    const producedArtifact = byKey.get(artifactKey(artifact.ref, artifact.path));
    invariant(producedArtifact, `producedArtifacts missing accepted artifact: ${artifact.ref}`);
    invariant(
      producedArtifact.storedRevision === producerRevision,
      `produced artifact revision mismatch for ${artifact.ref}: expected ${producerRevision}; got ${producedArtifact.storedRevision}`
    );
    return {
      ref: artifact.ref,
      ...(artifact.path == null ? {} : { path: artifact.path }),
      storedRevision: producedArtifact.storedRevision,
      contentDigest: contentDigest(producedArtifact.content),
      availability: ArtifactAvailability.AVAILABLE
    };
  });
  invariant(
    [...byKey.keys()].every((key) => expected.some((artifact) => artifactKey(artifact.ref, artifact.path) === key)),
    "producedArtifacts contains an artifact outside the accepted Backend result"
  );

  const acceptanceDecisionSemanticDigest = decisionSemanticDigest(run.completion.decision);
  return defineApplicationArtifactManifest({
    kind: ApplicationArtifactManifestKind,
    version: ApplicationArtifactManifestVersion,
    producerWorkOrderId,
    producerRevision,
    acceptanceDecision,
    ...(acceptanceDecisionSemanticDigest == null ? {} : { acceptanceDecisionSemanticDigest }),
    retention,
    entries
  });
}

function fileNameForDigest(digest) {
  invariant(/^sha256:[0-9a-f]{64}$/.test(digest), "artifact manifest digest must be sha256");
  return `manifest-${digest.slice("sha256:".length)}.json`;
}

function digestFromManifestRef(ref) {
  const value = requireText(ref, "artifact manifest ref");
  const match = /^artifact-manifest:\/\/(sha256:[0-9a-f]{64})$/.exec(value);
  invariant(match, "artifact manifest ref must contain an exact sha256 digest");
  return match[1];
}

function publicationDescriptor(manifest) {
  return {
    producerWorkOrderId: manifest.producerWorkOrderId,
    producerRevision: manifest.producerRevision,
    artifacts: manifest.entries
      .map((entry) => ({ ref: entry.ref, path: entry.path ?? null }))
      .sort((left, right) => artifactKey(left.ref, left.path).localeCompare(artifactKey(right.ref, right.path)))
  };
}

function publicationIdentity(manifest) {
  return canonicalize(publicationDescriptor(manifest));
}

function publicationFileName(manifest) {
  const digest = digestValue(publicationDescriptor(manifest));
  invariant(/^sha256:[0-9a-f]{64}$/.test(digest), "artifact publication identity must be sha256");
  return `publication-${digest.slice("sha256:".length)}.json`;
}

export function createJsonArtifactManifestStore({ path, fs = nodeFs }) {
  requireText(path, "artifact manifest store path");
  invariant(
    fs &&
      typeof fs.mkdir === "function" &&
      typeof fs.open === "function" &&
      typeof fs.readFile === "function" &&
      typeof fs.readdir === "function" &&
      typeof fs.link === "function" &&
      typeof fs.unlink === "function",
    "artifact manifest store requires filesystem mkdir/open/readFile/readdir/link/unlink capability"
  );

  async function readAll() {
    try {
      const names = (await fs.readdir(path))
        .filter((name) => /^(?:manifest|publication)-[0-9a-f]{64}\.json$/.test(name))
        .sort();
      const byRef = new Map();
      for (const name of names) {
        const manifest = defineApplicationArtifactManifest(
          JSON.parse(await fs.readFile(join(path, name), "utf8"))
        );
        const existing = byRef.get(manifest.ref);
        if (existing != null) {
          invariant(
            canonicalize(existing) === canonicalize(manifest),
            `artifact manifest ref ${manifest.ref} resolves to different persisted content`
          );
        } else {
          byRef.set(manifest.ref, manifest);
        }
      }
      return [...byRef.values()];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async function putManifest(raw) {
    const manifest = defineApplicationArtifactManifest(raw);
    await fs.mkdir(path, { recursive: true });

    // Compatibility: honor a previously persisted legacy/content-addressed
    // manifest before attempting the new atomic publication slot.
    const samePublication = (await readAll()).filter(
      (existing) => publicationIdentity(existing) === publicationIdentity(manifest)
    );
    if (samePublication.length > 0) {
      const refs = new Set(samePublication.map((existing) => existing.ref));
      if (refs.size === 1 && refs.has(manifest.ref)) return manifest.ref;
      throw new ArtifactManifestError(
        ArtifactManifestErrorCode.MANIFEST_CONFLICT,
        `artifact manifest publication already exists for accepted Backend identity: ${manifest.producerWorkOrderId}@${manifest.producerRevision}`
      );
    }

    // The final filename is derived only from the accepted Backend publication
    // identity, not the manifest content digest. hard-link no-overwrite makes
    // this the atomic single-winner slot across concurrent publishers.
    const filename = publicationFileName(manifest);
    const finalPath = join(path, filename);
    const tempPath = join(path, `.${filename}.${randomUUID()}.tmp`);
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    let handle = null;
    let tempExists = false;
    try {
      handle = await fs.open(tempPath, "wx");
      tempExists = true;
      await handle.writeFile(serialized, "utf8");
      await handle.close();
      handle = null;
      try {
        await fs.link(tempPath, finalPath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = defineApplicationArtifactManifest(
          JSON.parse(await fs.readFile(finalPath, "utf8"))
        );
        if (existing.ref === manifest.ref && canonicalize(existing) === canonicalize(manifest)) {
          return existing.ref;
        }
        throw new ArtifactManifestError(
          ArtifactManifestErrorCode.MANIFEST_CONFLICT,
          `concurrent artifact manifest publication conflicts for accepted Backend identity: ${manifest.producerWorkOrderId}@${manifest.producerRevision}`,
          { cause: error }
        );
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
    return manifest.ref;
  }

  async function readManifest(ref) {
    const digest = digestFromManifestRef(ref);

    // Legacy BB-043/045 stores used content-addressed manifest filenames.
    try {
      const manifest = defineApplicationArtifactManifest(
        JSON.parse(await fs.readFile(join(path, fileNameForDigest(digest)), "utf8"))
      );
      invariant(manifest.ref === ref, "artifact manifest ref does not match persisted content");
      return manifest;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const matches = (await readAll()).filter((manifest) => manifest.ref === ref);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new ArtifactManifestError(
        ArtifactManifestErrorCode.MANIFEST_CONFLICT,
        `multiple persisted manifests resolve exact ref ${ref}`
      );
    }
    throw new ArtifactManifestError(
      ArtifactManifestErrorCode.MANIFEST_MISSING,
      `artifact manifest is unavailable for exact ref ${ref}`
    );
  }

  async function findPublication({ producerWorkOrderId, producerRevision, artifacts }) {
    const identity = canonicalize({
      producerWorkOrderId: requireText(producerWorkOrderId, "artifact publication producerWorkOrderId"),
      producerRevision: requireText(producerRevision, "artifact publication producerRevision"),
      artifacts: artifacts
        .map((artifact, index) => {
          const value = requireRecord(artifact, `artifact publication artifacts[${index}]`);
          return {
            ref: requireText(value.ref, `artifact publication artifacts[${index}].ref`),
            path: normalizePath(value.path, `artifact publication artifacts[${index}].path`)
          };
        })
        .sort((left, right) => artifactKey(left.ref, left.path).localeCompare(artifactKey(right.ref, right.path)))
    });
    const matches = (await readAll()).filter((manifest) => publicationIdentity(manifest) === identity);
    if (matches.length > 1) {
      throw new ArtifactManifestError(
        ArtifactManifestErrorCode.MANIFEST_CONFLICT,
        `multiple artifact manifests exist for accepted Backend identity: ${producerWorkOrderId}@${producerRevision}`
      );
    }
    return matches[0] ?? null;
  }

  async function findCandidates({ ref, path: artifactPath = null }) {
    const normalizedRef = requireText(ref, "artifact manifest lookup ref");
    const normalizedPath = normalizePath(artifactPath, "artifact manifest lookup path");
    const manifests = await readAll();
    const matches = [];
    for (const manifest of manifests) {
      const entry = manifest.entries.find(
        (candidate) => candidate.ref === normalizedRef && (candidate.path ?? null) === normalizedPath
      );
      if (entry) matches.push(freezeClone({ manifest, entry }));
    }
    return Object.freeze(matches);
  }

  return Object.freeze({ putManifest, readManifest, findPublication, findCandidates });
}

function fail(code, message, cause = null) {
  throw new ArtifactManifestError(code, message, { cause });
}

function exactManifestCandidate(candidates, request) {
  if (candidates.length === 0) {
    fail(ArtifactManifestErrorCode.MANIFEST_MISSING, `artifact manifest missing for ${request.ref}`);
  }
  let narrowed = candidates.filter(({ manifest }) => manifest.producerWorkOrderId === request.producerWorkOrderId);
  if (narrowed.length === 0) {
    fail(ArtifactManifestErrorCode.PRODUCER_MISMATCH, `artifact producer work-order mismatch for ${request.ref}`);
  }
  narrowed = narrowed.filter(({ manifest }) => manifest.producerRevision === request.revision);
  if (narrowed.length === 0) {
    fail(
      ArtifactManifestErrorCode.PRODUCER_REVISION_MISMATCH,
      `artifact producer revision mismatch for ${request.ref}: requested ${request.revision}`
    );
  }
  narrowed = narrowed.filter(({ manifest }) => manifest.acceptanceDecision.id === request.acceptanceDecision.id);
  if (narrowed.length === 0) {
    fail(ArtifactManifestErrorCode.ACCEPTANCE_DECISION_MISMATCH, `artifact acceptance-decision id mismatch for ${request.ref}`);
  }
  narrowed = narrowed.filter(({ manifest }) => manifest.acceptanceDecision.digest === request.acceptanceDecision.digest);
  if (narrowed.length === 0) {
    fail(ArtifactManifestErrorCode.ACCEPTANCE_DECISION_MISMATCH, `artifact acceptance-decision digest mismatch for ${request.ref}`);
  }

  const identities = new Set(narrowed.map(({ entry }) => `${entry.storedRevision}\u0000${entry.contentDigest}\u0000${entry.availability}`));
  if (identities.size !== 1) {
    fail(ArtifactManifestErrorCode.MANIFEST_CONFLICT, `conflicting artifact manifests found for ${request.ref}`);
  }
  return narrowed[0];
}

export function createManifestArtifactReader({ reader, manifestStore }) {
  invariant(reader && typeof reader.readArtifact === "function", "manifest artifact reader requires reader.readArtifact()");
  invariant(
    manifestStore &&
      typeof manifestStore.findCandidates === "function" &&
      typeof manifestStore.readManifest === "function",
    "manifest artifact reader requires manifestStore.findCandidates()/readManifest()"
  );

  const counters = {
    manifestLookups: 0,
    underlyingReads: 0,
    bytesHashed: 0,
    validationFailures: 0
  };

  function scopedReader(requiredManifestRef = null) {
    const exactRef = requiredManifestRef == null ? null : requireText(requiredManifestRef, "required manifest ref");

    async function readArtifact(rawRequest) {
      const request = requireRecord(rawRequest, "artifact read request");
      const normalized = {
        ref: requireText(request.ref, "artifact read request.ref"),
        path: normalizePath(request.path, "artifact read request.path"),
        producerWorkOrderId: requireText(request.producerWorkOrderId, "artifact read request.producerWorkOrderId"),
        revision: requireText(request.revision, "artifact read request.revision"),
        acceptanceDecision: parseDecisionRef(request.acceptanceDecision, "artifact read request.acceptanceDecision")
      };

      try {
        counters.manifestLookups += 1;
        let candidates;
        if (exactRef == null) {
          candidates = await manifestStore.findCandidates({ ref: normalized.ref, path: normalized.path });
        } else {
          const manifest = await manifestStore.readManifest(exactRef);
          const entry = manifest.entries.find(
            (candidate) => candidate.ref === normalized.ref && (candidate.path ?? null) === normalized.path
          );
          candidates = entry == null ? [] : [freezeClone({ manifest, entry })];
        }
        const candidate = exactManifestCandidate(candidates, normalized);
        if (candidate.entry.storedRevision !== normalized.revision) {
          fail(
            ArtifactManifestErrorCode.STORED_REVISION_MISMATCH,
            `artifact stored revision mismatch for ${normalized.ref}: requested ${normalized.revision}; manifest has ${candidate.entry.storedRevision}`
          );
        }
        if (candidate.entry.availability !== ArtifactAvailability.AVAILABLE) {
          fail(ArtifactManifestErrorCode.UNAVAILABLE, `artifact payload is unavailable for ${normalized.ref}`);
        }

        let resolved;
        try {
          counters.underlyingReads += 1;
          resolved = await reader.readArtifact(rawRequest);
        } catch (error) {
          fail(ArtifactManifestErrorCode.UNAVAILABLE, `artifact payload is unavailable for ${normalized.ref}`, error);
        }
        invariant(resolved && typeof resolved === "object" && !Array.isArray(resolved), "underlying artifact reader must return an object");
        const content = typeof resolved.content === "string"
          ? resolved.content
          : (() => { throw new TypeError("underlying artifact reader content must be a string"); })();
        const sourceRef = requireText(resolved.sourceRef, "underlying artifact reader sourceRef");
        counters.bytesHashed += Buffer.byteLength(content, "utf8");
        if (contentDigest(content) !== candidate.entry.contentDigest) {
          fail(ArtifactManifestErrorCode.CONTENT_MISMATCH, `artifact content identity mismatch for ${normalized.ref}`);
        }
        return freezeClone({ content, sourceRef });
      } catch (error) {
        counters.validationFailures += 1;
        throw error;
      }
    }

    return Object.freeze({
      readArtifact,
      stats,
      forManifest
    });
  }

  function forManifest(manifestRef) {
    return scopedReader(manifestRef);
  }

  function stats() {
    return freezeClone(counters);
  }

  return scopedReader();
}

export function createAcceptedBackendArtifactManifestPublisher({
  manifestStore,
  producerArtifactReader,
  retentionPolicy
}) {
  invariant(
    manifestStore &&
      typeof manifestStore.putManifest === "function" &&
      typeof manifestStore.findPublication === "function",
    "artifact manifest publisher requires manifestStore.putManifest()/findPublication()"
  );
  invariant(
    producerArtifactReader && typeof producerArtifactReader.readProducedArtifact === "function",
    "artifact manifest publisher requires producerArtifactReader.readProducedArtifact()"
  );
  invariant(
    retentionPolicy && (typeof retentionPolicy === "object" || typeof retentionPolicy === "function"),
    "artifact manifest publisher requires retentionPolicy"
  );

  async function publishAcceptedBackendManifest({ itemId, backendRun }) {
    const run = requireRecord(backendRun, "backendRun");
    const producerWorkOrderId = requireText(run.order?.id, "backendRun.order.id");
    const producerRevision = requireText(run.result?.revision, "backendRun.result.revision");
    const decision = parseDecisionRef(run.completion?.decision, "backendRun.completion.decision");
    invariant(run.completion?.action === BackendCompletionAction.ACCEPT, "manifest publication requires ACCEPTED Backend completion");
    invariant(Array.isArray(run.result?.artifacts) && run.result.artifacts.length > 0, "manifest publication requires Backend artifacts");

    const existing = await manifestStore.findPublication({
      producerWorkOrderId,
      producerRevision,
      artifacts: run.result.artifacts
    });
    if (existing != null) {
      return freezeClone({
        manifestRef: existing.ref,
        manifest: existing,
        reused: true
      });
    }

    const producedArtifacts = [];
    for (const [index, rawArtifact] of run.result.artifacts.entries()) {
      const artifact = requireRecord(rawArtifact, `backendRun.result.artifacts[${index}]`);
      const ref = requireText(artifact.ref, `backendRun.result.artifacts[${index}].ref`);
      const path = normalizePath(artifact.path, `backendRun.result.artifacts[${index}].path`);
      const resolved = await producerArtifactReader.readProducedArtifact({
        itemId: requireText(itemId, "itemId"),
        ref,
        path,
        producerWorkOrderId,
        revision: producerRevision,
        acceptanceDecision: decision
      });
      invariant(resolved && typeof resolved === "object" && !Array.isArray(resolved), `producer artifact reader must return an object for ${ref}`);
      producedArtifacts.push({
        ref,
        ...(path == null ? {} : { path }),
        storedRevision: requireText(resolved.storedRevision, `producer artifact ${ref}.storedRevision`),
        content: typeof resolved.content === "string"
          ? resolved.content
          : (() => { throw new TypeError(`producer artifact ${ref}.content must be a string`); })()
      });
    }

    const retention = typeof retentionPolicy === "function"
      ? await retentionPolicy({ itemId, backendRun: freezeClone(run) })
      : retentionPolicy;
    const manifest = captureAcceptedBackendArtifactManifest({
      backendRun: run,
      producedArtifacts,
      retention
    });

    const manifestRef = await manifestStore.putManifest(manifest);
    return freezeClone({ manifestRef, manifest, reused: false });
  }

  return Object.freeze({ publishAcceptedBackendManifest });
}
