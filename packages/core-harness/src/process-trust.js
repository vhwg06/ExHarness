import { invariant, requireText } from "./contracts.js";
import { defineAuthority, defineEnvironmentRef, digestValue } from "./trust.js";

export const ControlInputKind = Object.freeze({
  INSTRUCTION: "INSTRUCTION",
  POLICY: "POLICY",
  RUBRIC: "RUBRIC",
  SKILL_BUNDLE: "SKILL_BUNDLE",
  WORKFLOW: "WORKFLOW",
  TEST_DEFINITION: "TEST_DEFINITION",
  MODEL_CONFIG: "MODEL_CONFIG",
  TOOLCHAIN: "TOOLCHAIN",
  OTHER: "OTHER"
});

export const VerificationDomainDimension = Object.freeze({
  MODEL: "model",
  CONTEXT: "contextDigest",
  INSTRUCTIONS: "instructionManifestDigest",
  EVIDENCE_SOURCE: "evidenceSource",
  ENVIRONMENT: "environmentDigest",
  RUNTIME: "runtimeDigest"
});

export const ProcessTrustReasonCode = Object.freeze({
  INVALID_PROVENANCE: "INVALID_PROVENANCE",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  UNTRUSTED_ISSUER: "UNTRUSTED_ISSUER",
  MISSING_ISSUER_ROLE: "MISSING_ISSUER_ROLE",
  UNTRUSTED_PROCESS_ENVIRONMENT: "UNTRUSTED_PROCESS_ENVIRONMENT",
  BASE_ATTESTATION_UNTRUSTED: "BASE_ATTESTATION_UNTRUSTED",
  STALE_CONTROL_INPUTS: "STALE_CONTROL_INPUTS",
  MISSING_CONTROL_INPUT: "MISSING_CONTROL_INPUT",
  STALE_CONTROL_INPUT: "STALE_CONTROL_INPUT",
  UNTRUSTED_CONTROL_INPUT_AUTHORITY: "UNTRUSTED_CONTROL_INPUT_AUTHORITY",
  UNVERIFIED_CONTROL_INPUT_AUTHORITY: "UNVERIFIED_CONTROL_INPUT_AUTHORITY",
  INSUFFICIENT_INDEPENDENCE: "INSUFFICIENT_INDEPENDENCE",
  UNKNOWN_INDEPENDENCE_DIMENSION: "UNKNOWN_INDEPENDENCE_DIMENSION",
  EXPIRED: "EXPIRED"
});

const knownDimensions = new Set(Object.values(VerificationDomainDimension));

function freeze(value) {
  return Object.freeze(structuredClone(value));
}

function normalizeTextSet(values, label) {
  invariant(Array.isArray(values), `${label} must be an array`);
  return Object.freeze([...new Set(values.map((item) => requireText(item, label)))].sort());
}

export function defineControlInput({
  name,
  kind,
  digest,
  version = null,
  source = null,
  authority = null,
  metadata = null
}) {
  invariant(Object.values(ControlInputKind).includes(kind), "control input kind is invalid");
  return Object.freeze({
    name: requireText(name, "control input name"),
    kind,
    digest: requireText(digest, "control input digest"),
    version: version == null ? null : requireText(version, "control input version"),
    source: source == null ? null : requireText(source, "control input source"),
    authority: authority == null ? null : defineAuthority(authority),
    metadata: metadata == null ? null : freeze(metadata)
  });
}

export function controlInputFromValue(name, value, {
  kind = ControlInputKind.OTHER,
  version = null,
  source = null,
  authority = null,
  metadata = null
} = {}) {
  return defineControlInput({
    name,
    kind,
    digest: digestValue(value),
    version,
    source,
    authority,
    metadata
  });
}

export function createControlInputManifest(inputs = []) {
  invariant(Array.isArray(inputs), "control inputs must be an array");
  const normalized = inputs.map(defineControlInput);
  const names = new Set();
  for (const input of normalized) {
    invariant(!names.has(input.name), `duplicate control input: ${input.name}`);
    names.add(input.name);
  }
  normalized.sort((left, right) => left.name.localeCompare(right.name));
  const body = normalized.map((item) => freeze(item));
  return Object.freeze({
    type: "CONTROL_INPUT_MANIFEST",
    inputs: Object.freeze(body),
    digest: digestValue(body)
  });
}

export function defineVerificationDomain({
  name,
  actor = null,
  model = null,
  contextDigest = null,
  instructionManifestDigest = null,
  evidenceSource = null,
  environmentDigest = null,
  runtimeDigest = null,
  metadata = null
}) {
  return Object.freeze({
    name: requireText(name, "verification domain name"),
    actor: actor == null ? null : defineAuthority(actor),
    model: model == null ? null : requireText(model, "verification domain model"),
    contextDigest: contextDigest == null ? null : requireText(contextDigest, "verification domain contextDigest"),
    instructionManifestDigest: instructionManifestDigest == null
      ? null
      : requireText(instructionManifestDigest, "verification domain instructionManifestDigest"),
    evidenceSource: evidenceSource == null ? null : requireText(evidenceSource, "verification domain evidenceSource"),
    environmentDigest: environmentDigest == null ? null : requireText(environmentDigest, "verification domain environmentDigest"),
    runtimeDigest: runtimeDigest == null ? null : requireText(runtimeDigest, "verification domain runtimeDigest"),
    metadata: metadata == null ? null : freeze(metadata)
  });
}

export function createVerificationDomainManifest(domains = []) {
  invariant(Array.isArray(domains), "verification domains must be an array");
  const normalized = domains.map(defineVerificationDomain);
  const names = new Set();
  for (const domain of normalized) {
    invariant(!names.has(domain.name), `duplicate verification domain: ${domain.name}`);
    names.add(domain.name);
  }
  normalized.sort((left, right) => left.name.localeCompare(right.name));
  const body = normalized.map((item) => freeze(item));
  return Object.freeze({
    type: "VERIFICATION_DOMAIN_MANIFEST",
    domains: Object.freeze(body),
    digest: digestValue(body)
  });
}

export function defineIndependencePolicy({ minimumDomains = 1, dimensions = {} } = {}) {
  invariant(Number.isInteger(minimumDomains) && minimumDomains >= 1, "minimumDomains must be a positive integer");
  invariant(dimensions && typeof dimensions === "object" && !Array.isArray(dimensions), "independence dimensions must be an object");
  const normalized = {};
  for (const [dimension, minimumDistinct] of Object.entries(dimensions)) {
    invariant(knownDimensions.has(dimension), `unsupported independence dimension: ${dimension}`);
    invariant(Number.isInteger(minimumDistinct) && minimumDistinct >= 1, `independence dimension ${dimension} must require a positive integer`);
    normalized[dimension] = minimumDistinct;
  }
  return Object.freeze({ minimumDomains, dimensions: Object.freeze(normalized) });
}

export function assessVerificationIndependence(domains, policy = defineIndependencePolicy()) {
  const manifest = domains?.type === "VERIFICATION_DOMAIN_MANIFEST"
    ? domains
    : createVerificationDomainManifest(domains ?? []);
  const resolved = defineIndependencePolicy(policy);
  const failures = [];
  const distinct = {};

  if (manifest.domains.length < resolved.minimumDomains) {
    failures.push(Object.freeze({
      code: ProcessTrustReasonCode.INSUFFICIENT_INDEPENDENCE,
      dimension: "domains",
      required: resolved.minimumDomains,
      actual: manifest.domains.length
    }));
  }

  for (const [dimension, required] of Object.entries(resolved.dimensions)) {
    const values = manifest.domains.map((domain) => domain[dimension]);
    const unknown = values.filter((value) => value == null).length;
    const count = new Set(values.filter((value) => value != null)).size;
    distinct[dimension] = count;
    if (unknown > 0) {
      failures.push(Object.freeze({
        code: ProcessTrustReasonCode.UNKNOWN_INDEPENDENCE_DIMENSION,
        dimension,
        unknownDomains: unknown
      }));
    }
    if (count < required) {
      failures.push(Object.freeze({
        code: ProcessTrustReasonCode.INSUFFICIENT_INDEPENDENCE,
        dimension,
        required,
        actual: count
      }));
    }
  }

  return Object.freeze({
    satisfied: failures.length === 0,
    manifest,
    distinct: freeze(distinct),
    failures: Object.freeze(failures)
  });
}

function controlManifestIntegrity(manifest) {
  if (!manifest || manifest.type !== "CONTROL_INPUT_MANIFEST" || !Array.isArray(manifest.inputs)) return false;
  try {
    return createControlInputManifest(manifest.inputs).digest === manifest.digest;
  } catch {
    return false;
  }
}

function domainManifestIntegrity(manifest) {
  if (!manifest || manifest.type !== "VERIFICATION_DOMAIN_MANIFEST" || !Array.isArray(manifest.domains)) return false;
  try {
    return createVerificationDomainManifest(manifest.domains).digest === manifest.digest;
  } catch {
    return false;
  }
}

function attestationRef(attestation) {
  invariant(attestation && typeof attestation === "object", "base attestation is required");
  return Object.freeze({
    id: requireText(attestation.id, "base attestation id"),
    digest: requireText(attestation.digest, "base attestation digest"),
    boundary: attestation.boundary == null ? null : requireText(attestation.boundary, "base attestation boundary")
  });
}

function processPayload(attestation) {
  return {
    type: attestation.type,
    baseAttestation: attestation.baseAttestation,
    controlInputManifest: attestation.controlInputManifest,
    verificationDomainManifest: attestation.verificationDomainManifest,
    assumptions: attestation.assumptions,
    issuer: attestation.issuer,
    environment: attestation.environment,
    issuedAt: attestation.issuedAt
  };
}

export function createProcessAttestationIssuer({ identity, version = null, roles = [], sign }) {
  invariant(typeof sign === "function", "process attestation issuer requires sign()");
  const issuer = defineAuthority({ identity, version, roles });
  return Object.freeze({
    issuer,
    async issue({
      baseAttestation,
      controlInputs = [],
      verificationDomains = [],
      assumptions = [],
      environment,
      issuedAt
    }) {
      invariant(Array.isArray(assumptions), "process trust assumptions must be an array");
      const payload = {
        type: "PROCESS_ATTESTATION",
        baseAttestation: attestationRef(baseAttestation),
        controlInputManifest: createControlInputManifest(controlInputs),
        verificationDomainManifest: createVerificationDomainManifest(verificationDomains),
        assumptions: freeze(assumptions),
        issuer,
        environment: defineEnvironmentRef(environment),
        issuedAt: requireText(issuedAt, "process attestation issuedAt")
      };
      const payloadDigest = digestValue(payload);
      const signature = await sign({ payloadDigest, payload: freeze(payload), issuer });
      invariant(signature != null, "process attestation issuer sign() must return a signature");
      const digest = digestValue({ payloadDigest, signature });
      return Object.freeze({
        id: `process-attestation:${digest}`,
        digest,
        payloadDigest,
        ...freeze(payload),
        signature: freeze(signature)
      });
    }
  });
}

export function defineProcessTrustPolicy({
  acceptedIssuers = [],
  requiredIssuerRoles = [],
  acceptedEnvironmentDigests = [],
  requiredControlInputs = [],
  acceptedControlInputAuthorities = [],
  independence = {},
  requireBaseAttestationTrust = true,
  requireSignature = true,
  maxAgeMs = null
} = {}) {
  if (maxAgeMs != null) invariant(Number.isFinite(maxAgeMs) && maxAgeMs >= 0, "process trust maxAgeMs must be non-negative");
  invariant(Array.isArray(requiredControlInputs), "requiredControlInputs must be an array");
  const required = requiredControlInputs.map((item) => {
    invariant(item && typeof item === "object", "required control input must be an object");
    return Object.freeze({
      name: requireText(item.name, "required control input name"),
      digest: item.digest == null ? null : requireText(item.digest, "required control input digest"),
      kind: item.kind == null ? null : requireText(item.kind, "required control input kind")
    });
  });
  return Object.freeze({
    acceptedIssuers: normalizeTextSet(acceptedIssuers, "accepted process issuer"),
    requiredIssuerRoles: normalizeTextSet(requiredIssuerRoles, "required process issuer role"),
    acceptedEnvironmentDigests: normalizeTextSet(acceptedEnvironmentDigests, "accepted process environment digest"),
    requiredControlInputs: Object.freeze(required),
    acceptedControlInputAuthorities: normalizeTextSet(acceptedControlInputAuthorities, "accepted control input authority"),
    independence: defineIndependencePolicy(independence),
    requireBaseAttestationTrust: requireBaseAttestationTrust !== false,
    requireSignature: requireSignature !== false,
    maxAgeMs
  });
}

function checkProcessIntegrity(processAttestation) {
  if (!processAttestation || processAttestation.type !== "PROCESS_ATTESTATION") return false;
  if (!controlManifestIntegrity(processAttestation.controlInputManifest)) return false;
  if (!domainManifestIntegrity(processAttestation.verificationDomainManifest)) return false;
  const payloadDigest = digestValue(processPayload(processAttestation));
  const envelopeDigest = digestValue({ payloadDigest, signature: processAttestation.signature });
  return payloadDigest === processAttestation.payloadDigest &&
    envelopeDigest === processAttestation.digest &&
    processAttestation.id === `process-attestation:${envelopeDigest}`;
}

export async function evaluateProcessAttestationTrust({
  processAttestation,
  currentControlInputs = [],
  policy = {},
  verifySignature = null,
  verifyBaseAttestation = null,
  verifyControlInputAuthority = null,
  now = () => new Date().toISOString()
}) {
  invariant(processAttestation && typeof processAttestation === "object", "process attestation is required");
  const resolved = defineProcessTrustPolicy(policy);
  const reasons = [];

  if (!checkProcessIntegrity(processAttestation)) {
    reasons.push(Object.freeze({ code: ProcessTrustReasonCode.INVALID_PROVENANCE }));
  }

  if (resolved.acceptedIssuers.length > 0 && !resolved.acceptedIssuers.includes(processAttestation.issuer?.identity)) {
    reasons.push(Object.freeze({
      code: ProcessTrustReasonCode.UNTRUSTED_ISSUER,
      issuer: processAttestation.issuer?.identity ?? null
    }));
  }
  const issuerRoles = new Set(processAttestation.issuer?.roles ?? []);
  for (const role of resolved.requiredIssuerRoles) {
    if (!issuerRoles.has(role)) {
      reasons.push(Object.freeze({ code: ProcessTrustReasonCode.MISSING_ISSUER_ROLE, role }));
    }
  }
  if (
    resolved.acceptedEnvironmentDigests.length > 0 &&
    !resolved.acceptedEnvironmentDigests.includes(processAttestation.environment?.digest)
  ) {
    reasons.push(Object.freeze({
      code: ProcessTrustReasonCode.UNTRUSTED_PROCESS_ENVIRONMENT,
      digest: processAttestation.environment?.digest ?? null
    }));
  }

  const currentManifest = createControlInputManifest(currentControlInputs);
  if (currentManifest.digest !== processAttestation.controlInputManifest?.digest) {
    reasons.push(Object.freeze({
      code: ProcessTrustReasonCode.STALE_CONTROL_INPUTS,
      attested: processAttestation.controlInputManifest?.digest ?? null,
      current: currentManifest.digest
    }));
  }

  const attestedInputs = new Map((processAttestation.controlInputManifest?.inputs ?? []).map((item) => [item.name, item]));
  for (const requirement of resolved.requiredControlInputs) {
    const input = attestedInputs.get(requirement.name);
    if (!input) {
      reasons.push(Object.freeze({ code: ProcessTrustReasonCode.MISSING_CONTROL_INPUT, name: requirement.name }));
      continue;
    }
    if (requirement.kind != null && input.kind !== requirement.kind) {
      reasons.push(Object.freeze({
        code: ProcessTrustReasonCode.STALE_CONTROL_INPUT,
        name: requirement.name,
        expectedKind: requirement.kind,
        actualKind: input.kind
      }));
    }
    if (requirement.digest != null && input.digest !== requirement.digest) {
      reasons.push(Object.freeze({
        code: ProcessTrustReasonCode.STALE_CONTROL_INPUT,
        name: requirement.name,
        expectedDigest: requirement.digest,
        actualDigest: input.digest
      }));
    }
  }

  if (resolved.acceptedControlInputAuthorities.length > 0) {
    for (const input of processAttestation.controlInputManifest?.inputs ?? []) {
      const identity = input.authority?.identity ?? null;
      if (!resolved.acceptedControlInputAuthorities.includes(identity)) {
        reasons.push(Object.freeze({
          code: ProcessTrustReasonCode.UNTRUSTED_CONTROL_INPUT_AUTHORITY,
          name: input.name,
          authority: identity
        }));
        continue;
      }
      let verified = false;
      if (typeof verifyControlInputAuthority === "function") {
        verified = await verifyControlInputAuthority({ input, processAttestation, policy: resolved }) === true;
      }
      if (!verified) {
        reasons.push(Object.freeze({
          code: ProcessTrustReasonCode.UNVERIFIED_CONTROL_INPUT_AUTHORITY,
          name: input.name,
          authority: identity,
          detail: typeof verifyControlInputAuthority === "function"
            ? "control input authority verification failed"
            : "control input authority verifier unavailable"
        }));
      }
    }
  }

  const independence = assessVerificationIndependence(processAttestation.verificationDomainManifest, resolved.independence);
  reasons.push(...independence.failures);

  if (resolved.requireBaseAttestationTrust) {
    let result = null;
    if (typeof verifyBaseAttestation === "function") {
      result = await verifyBaseAttestation(processAttestation.baseAttestation);
    }
    const supplied = result?.attestation ?? null;
    const exact = supplied?.id === processAttestation.baseAttestation.id && supplied?.digest === processAttestation.baseAttestation.digest;
    if (result?.trusted !== true || !exact) {
      reasons.push(Object.freeze({
        code: ProcessTrustReasonCode.BASE_ATTESTATION_UNTRUSTED,
        detail: result == null
          ? "base attestation trust verifier unavailable"
          : exact
            ? "base attestation was not trusted"
            : "base trust result does not match referenced attestation"
      }));
    }
  }

  if (resolved.maxAgeMs != null) {
    const issued = Date.parse(processAttestation.issuedAt);
    const current = Date.parse(now());
    if (!Number.isFinite(issued) || !Number.isFinite(current) || issued > current || current - issued > resolved.maxAgeMs) {
      reasons.push(Object.freeze({ code: ProcessTrustReasonCode.EXPIRED }));
    }
  }

  if (resolved.requireSignature) {
    let valid = false;
    if (typeof verifySignature === "function") {
      valid = await verifySignature({
        payloadDigest: processAttestation.payloadDigest,
        signature: processAttestation.signature,
        issuer: processAttestation.issuer,
        processAttestation
      }) === true;
    }
    if (!valid) {
      reasons.push(Object.freeze({
        code: ProcessTrustReasonCode.INVALID_SIGNATURE,
        detail: typeof verifySignature === "function" ? "signature verification failed" : "signature verifier unavailable"
      }));
    }
  }

  return Object.freeze({
    trusted: reasons.length === 0,
    reasons: Object.freeze(reasons),
    baseAttestation: freeze(processAttestation.baseAttestation),
    controlInputManifest: freeze(processAttestation.controlInputManifest),
    verificationDomainManifest: freeze(processAttestation.verificationDomainManifest),
    independence,
    assumptions: freeze(processAttestation.assumptions ?? [])
  });
}
