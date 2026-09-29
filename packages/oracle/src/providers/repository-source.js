function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export async function readRepositorySources({ repositoryRef, revision, requiredFiles }, { repositoryReader } = {}) {
  invariant(repositoryReader && typeof repositoryReader.readFile === "function", "resolveBackendContext requires repositoryReader.readFile()");
  invariant(Array.isArray(requiredFiles), "requiredFiles must be an array");

  const files = [];
  for (const path of requiredFiles) {
    let resolved;
    try {
      resolved = await repositoryReader.readFile({ repositoryRef, revision, path });
    } catch (error) {
      const detail = error?.message ?? String(error);
      throw new Error(`backend context resolution failed for ${path} from ${repositoryRef}@${revision}: ${detail}`, { cause: error });
    }
    invariant(resolved && typeof resolved === "object" && !Array.isArray(resolved), `repositoryReader.readFile() must return an object for ${path}`);
    invariant(typeof resolved.content === "string", `repositoryReader.readFile() must return content for ${path}`);
    invariant(typeof resolved.sourceRef === "string" && resolved.sourceRef.length > 0, `repositoryReader.readFile() must return sourceRef for ${path}`);
    files.push({ path, content: resolved.content, sourceRef: resolved.sourceRef });
  }

  return { repository: { ref: repositoryRef, revision }, files };
}
