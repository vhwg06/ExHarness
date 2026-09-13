import { invariant, requireText } from "./contracts.js";
import { defineRuntimeExecution } from "./runtime-execution.js";

export const ArtifactRefKind = Object.freeze({
  OBSERVATION: "OBSERVATION"
});

export const ObservationSourceKind = Object.freeze({
  ENVIRONMENT: "ENVIRONMENT"
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function defineArtifactRef({ kind, id }) {
  invariant(Object.values(ArtifactRefKind).includes(kind), "artifact ref kind is invalid");
  return Object.freeze({
    kind,
    id: requireText(id, "artifact ref id")
  });
}

export function defineObservationProvenance({
  sessionId,
  variationId = null,
  runtime = null,
  source = { kind: ObservationSourceKind.ENVIRONMENT, name: "environment.observe" }
}) {
  invariant(source && typeof source === "object", "observation provenance source is required");
  invariant(Object.values(ObservationSourceKind).includes(source.kind), "observation provenance source kind is invalid");

  return Object.freeze({
    source: Object.freeze({
      kind: source.kind,
      name: requireText(source.name, "observation provenance source name")
    }),
    sessionId: requireText(sessionId, "observation provenance sessionId"),
    variationId: variationId == null ? null : requireText(variationId, "observation provenance variationId"),
    runtime: runtime == null ? null : defineRuntimeExecution(runtime)
  });
}

export function defineObservationArtifact({
  id,
  candidate,
  at,
  request,
  value,
  provenance
}) {
  const observationId = requireText(id, "observation id");
  return Object.freeze({
    id: observationId,
    artifactRef: defineArtifactRef({ kind: ArtifactRefKind.OBSERVATION, id: observationId }),
    candidate: clone(candidate),
    at: requireText(at, "observation at"),
    request: clone(request),
    value: clone(value),
    provenance: defineObservationProvenance(provenance)
  });
}
