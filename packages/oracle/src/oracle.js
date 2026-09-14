const JSON_MIME = "application/json";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function clone(value) {
  return structuredClone(value);
}

function requireHarness(harness) {
  invariant(harness && typeof harness === "object", "oracle requires a harness");
  invariant(typeof harness.workState === "function", "oracle harness requires workState(sessionId)");
  invariant(typeof harness.trustArtifacts === "function", "oracle harness requires trustArtifacts(sessionId)");
  invariant(typeof harness.searchHealth === "function", "oracle harness requires searchHealth(sessionId)");
  invariant(typeof harness.recoveryStatus === "function", "oracle harness requires recoveryStatus(sessionId)");
  return harness;
}

function count(collection) {
  return Array.isArray(collection) ? collection.length : 0;
}

function lineageHead(state) {
  const lineage = state?.persistentMemory?.lineage;
  return Array.isArray(lineage) ? clone(lineage.at(-1) ?? null) : null;
}

function sessionSummary(state) {
  const memory = state.persistentMemory ?? {};
  const supervision = state.supervision ?? {};
  const trajectory = Array.isArray(state.trajectory) ? state.trajectory : [];

  return Object.freeze({
    schemaVersion: state.schemaVersion ?? null,
    revision: state.revision ?? null,
    id: state.id,
    work: clone(state.work),
    candidate: clone(state.currentCandidate),
    progress: Object.freeze({
      implementations: count(memory.implementations),
      observations: count(memory.observations),
      verifications: count(memory.verifications),
      evaluations: count(memory.evaluations),
      knowledge: count(memory.knowledge),
      variations: count(memory.variations),
      searchInvestmentDecisions: count(memory.searchInvestmentDecisions),
      trust: Object.freeze({
        evidence: count(memory.evidenceArtifacts),
        decisions: count(memory.decisionArtifacts),
        attestations: count(memory.attestations)
      }),
      lineage: Object.freeze({
        count: count(memory.lineage),
        head: lineageHead(state)
      }),
      supervision: Object.freeze({
        inspections: supervision.inspections ?? 0,
        skipped: supervision.skipped ?? 0,
        interventions: count(supervision.interventions),
        lastDecision: clone(supervision.lastDecision ?? null)
      }),
      trajectory: Object.freeze({
        eventCount: trajectory.length,
        lastEventId: trajectory.at(-1)?.id ?? null
      })
    }),
    createdAt: state.createdAt ?? null,
    updatedAt: state.updatedAt ?? null
  });
}

function parsePositiveInteger(value, label, max) {
  const parsed = Number.parseInt(value, 10);
  invariant(Number.isSafeInteger(parsed) && parsed > 0, `${label} must be a positive integer`);
  invariant(parsed <= max, `${label} must be <= ${max}`);
  return parsed;
}

function decodePathSegment(value, label) {
  invariant(typeof value === "string" && value.length > 0, `${label} is required`);
  return decodeURIComponent(value);
}

function parseResourceUri(uri, maxTrajectoryItems) {
  invariant(typeof uri === "string" && uri.length > 0, "oracle resource uri is required");
  const parsed = new URL(uri);
  invariant(parsed.protocol === "exharness:", "oracle resource uri must use exharness://");
  invariant(parsed.hostname === "sessions", "oracle resource host must be sessions");

  const segments = parsed.pathname.split("/").filter(Boolean);
  invariant(segments.length >= 2, "oracle resource uri must include session id and resource kind");

  const sessionId = decodePathSegment(segments[0], "session id");
  const kind = segments[1];

  if (kind === "trajectory") {
    invariant(segments.length === 3, "trajectory resource uri must include a limit");
    return Object.freeze({
      sessionId,
      kind,
      limit: parsePositiveInteger(segments[2], "trajectory limit", maxTrajectoryItems)
    });
  }

  invariant(segments.length === 2, `unexpected path segments for ${kind}`);
  return Object.freeze({ sessionId, kind });
}

function resource({ uri, value }) {
  return Object.freeze({
    uri,
    mimeType: JSON_MIME,
    value: clone(value)
  });
}

export const OracleResourceKind = Object.freeze({
  SUMMARY: "summary",
  STATE: "state",
  TRAJECTORY: "trajectory",
  TRUST: "trust",
  SEARCH_HEALTH: "search-health",
  RECOVERY: "recovery"
});

export const ORACLE_RESOURCE_TEMPLATES = Object.freeze([
  Object.freeze({
    name: "session-summary",
    uriTemplate: "exharness://sessions/{sessionId}/summary",
    mimeType: JSON_MIME,
    description: "Bounded session summary with current candidate and progress counts."
  }),
  Object.freeze({
    name: "session-state",
    uriTemplate: "exharness://sessions/{sessionId}/state",
    mimeType: JSON_MIME,
    description: "Explicit full persistent work-state read. Use only when a bounded projection is insufficient."
  }),
  Object.freeze({
    name: "session-trajectory",
    uriTemplate: "exharness://sessions/{sessionId}/trajectory/{limit}",
    mimeType: JSON_MIME,
    description: "Bounded tail of the persistent trajectory."
  }),
  Object.freeze({
    name: "session-trust",
    uriTemplate: "exharness://sessions/{sessionId}/trust",
    mimeType: JSON_MIME,
    description: "Current evidence, decision and attestation artifacts."
  }),
  Object.freeze({
    name: "session-search-health",
    uriTemplate: "exharness://sessions/{sessionId}/search-health",
    mimeType: JSON_MIME,
    description: "Current deterministic search-health projection."
  }),
  Object.freeze({
    name: "session-recovery",
    uriTemplate: "exharness://sessions/{sessionId}/recovery",
    mimeType: JSON_MIME,
    description: "Current deterministic recovery assessment."
  })
]);

export function createOracle({ harness, maxTrajectoryItems = 200 } = {}) {
  const source = requireHarness(harness);
  invariant(
    Number.isSafeInteger(maxTrajectoryItems) && maxTrajectoryItems > 0,
    "maxTrajectoryItems must be a positive integer"
  );

  return Object.freeze({
    listResourceTemplates() {
      return clone(ORACLE_RESOURCE_TEMPLATES);
    },

    async readResource(uri) {
      const request = parseResourceUri(uri, maxTrajectoryItems);

      if (request.kind === OracleResourceKind.SUMMARY) {
        return resource({ uri, value: sessionSummary(await source.workState(request.sessionId)) });
      }

      if (request.kind === OracleResourceKind.STATE) {
        return resource({ uri, value: await source.workState(request.sessionId) });
      }

      if (request.kind === OracleResourceKind.TRAJECTORY) {
        const state = await source.workState(request.sessionId);
        const events = Array.isArray(state.trajectory) ? state.trajectory.slice(-request.limit) : [];
        return resource({
          uri,
          value: {
            sessionId: request.sessionId,
            revision: state.revision ?? null,
            limit: request.limit,
            events
          }
        });
      }

      if (request.kind === OracleResourceKind.TRUST) {
        return resource({ uri, value: await source.trustArtifacts(request.sessionId) });
      }

      if (request.kind === OracleResourceKind.SEARCH_HEALTH) {
        return resource({ uri, value: await source.searchHealth(request.sessionId) });
      }

      if (request.kind === OracleResourceKind.RECOVERY) {
        return resource({ uri, value: await source.recoveryStatus(request.sessionId) });
      }

      throw new TypeError(`unknown oracle resource kind: ${request.kind}`);
    }
  });
}
