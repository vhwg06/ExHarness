function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export async function readApplicationArtifacts({ requiredArtifacts, producerWorkOrderId, revision, acceptanceDecision }, { artifactReader } = {}) {
  invariant(artifactReader && typeof artifactReader.readArtifact === "function", "resolveQaContext requires artifactReader.readArtifact()");
  invariant(Array.isArray(requiredArtifacts), "requiredArtifacts must be an array");

  const artifacts = [];
  for (const artifact of requiredArtifacts) {
    let resolved;
    try {
      resolved = await artifactReader.readArtifact({
        ref: artifact.ref,
        path: artifact.path ?? null,
        producerWorkOrderId,
        revision,
        acceptanceDecision
      });
    } catch (error) {
      const detail = error?.message ?? String(error);
      throw new Error(`qa context resolution failed for ${artifact.ref} from application artifact store: ${detail}`, { cause: error });
    }
    invariant(resolved && typeof resolved === "object" && !Array.isArray(resolved), `artifactReader.readArtifact() must return an object for ${artifact.ref}`);
    invariant(typeof resolved.content === "string", `artifactReader.readArtifact() must return content for ${artifact.ref}`);
    invariant(typeof resolved.sourceRef === "string" && resolved.sourceRef.length > 0, `artifactReader.readArtifact() must return sourceRef for ${artifact.ref}`);
    artifacts.push({
      ref: artifact.ref,
      ...(artifact.path == null ? {} : { path: artifact.path }),
      content: resolved.content,
      sourceRef: resolved.sourceRef,
      provenance: { sourceClass: "APPLICATION_ARTIFACT", producerWorkOrderId, acceptanceDecision }
    });
  }

  return { artifacts };
}
