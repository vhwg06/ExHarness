import { invariant, requireText } from "./contracts.js";

export const DiscoveryMode = Object.freeze({
  CONCISE: "CONCISE",
  FULL: "FULL"
});

export function defineDiscoveryPolicy({
  maxMembers = 24,
  maxChars = 8_192,
  maxDescriptionChars = 512
} = {}) {
  for (const [name, value] of Object.entries({ maxMembers, maxChars, maxDescriptionChars })) {
    invariant(Number.isInteger(value) && value >= 0, `discovery policy ${name} must be a non-negative integer`);
  }
  return Object.freeze({ maxMembers, maxChars, maxDescriptionChars });
}

function normalizeMode(mode) {
  invariant(Object.values(DiscoveryMode).includes(mode), "discovery mode is invalid");
  return mode;
}

function clipText(value, maximum) {
  if (value == null) return null;
  const text = requireText(value, "discovery description");
  if (text.length <= maximum) return Object.freeze({ value: text, truncated: false });
  return Object.freeze({ value: text.slice(0, maximum), truncated: true });
}

function jsonChars(value) {
  return JSON.stringify(value).length;
}

function boundedDocument(base, members, policy) {
  const selected = [];
  let truncatedMembers = false;
  let truncatedChars = false;

  for (const member of members) {
    if (selected.length >= policy.maxMembers) {
      truncatedMembers = true;
      break;
    }
    const candidate = {
      ...base,
      members: [...selected, member],
      truncation: { members: false, chars: false }
    };
    if (jsonChars(candidate) > policy.maxChars) {
      truncatedChars = true;
      break;
    }
    selected.push(member);
  }

  if (selected.length < members.length) truncatedMembers = true;
  const document = Object.freeze({
    ...base,
    members: Object.freeze(selected),
    truncation: Object.freeze({ members: truncatedMembers, chars: truncatedChars })
  });
  invariant(jsonChars(document) <= policy.maxChars || policy.maxChars === 0, "discovery base document exceeds maxChars policy");
  return Object.freeze({
    document,
    metrics: Object.freeze({
      chars: jsonChars(document),
      members: selected.length,
      totalMembers: members.length,
      truncatedMembers,
      truncatedChars
    })
  });
}

function normalizeObjectMember(member, mode, policy) {
  const base = {
    name: requireText(member.name, "object discovery member name"),
    kind: requireText(member.kind, "object discovery member kind")
  };
  if (mode === DiscoveryMode.CONCISE) return Object.freeze(base);
  const description = clipText(member.description ?? null, policy.maxDescriptionChars);
  return Object.freeze({
    ...base,
    description: description?.value ?? null,
    descriptionTruncated: description?.truncated ?? false,
    mutatesCandidate: member.mutatesCandidate === true,
    typedInput: member.typedInput === true,
    typedOutput: member.typedOutput === true
  });
}

function normalizeLiveMethod(member, mode, policy) {
  const base = {
    name: requireText(member.name, "live discovery method name"),
    kind: "METHOD"
  };
  if (mode === DiscoveryMode.CONCISE) return Object.freeze(base);
  const description = clipText(member.description ?? null, policy.maxDescriptionChars);
  return Object.freeze({
    ...base,
    description: description?.value ?? null,
    descriptionTruncated: description?.truncated ?? false,
    mutates: member.mutates === true,
    allowLiveArgs: member.allowLiveArgs === true,
    typedArgs: member.typedArgs === true,
    typedOutput: member.typedOutput === true,
    returnsLive: member.returnsLive === true
  });
}

function normalizeLiveProperty(member, mode, policy) {
  const base = {
    name: requireText(member.name, "live discovery property name"),
    kind: "PROPERTY"
  };
  if (mode === DiscoveryMode.CONCISE) return Object.freeze(base);
  const description = clipText(member.description ?? null, policy.maxDescriptionChars);
  return Object.freeze({
    ...base,
    description: description?.value ?? null,
    descriptionTruncated: description?.truncated ?? false,
    typedOutput: member.typedOutput === true,
    returnsLive: member.returnsLive === true
  });
}

export function renderObjectAgentDoc(surface, {
  mode = DiscoveryMode.CONCISE,
  policy = defineDiscoveryPolicy()
} = {}) {
  invariant(surface && typeof surface === "object", "object agent discovery surface is required");
  invariant(Array.isArray(surface.members), "object agent discovery members must be an array");
  const resolvedMode = normalizeMode(mode);
  const resolvedPolicy = defineDiscoveryPolicy(policy);
  const members = surface.members.map((member) => normalizeObjectMember(member, resolvedMode, resolvedPolicy));
  return boundedDocument(Object.freeze({
    kind: "OBJECT_AGENT_DOC",
    mode: resolvedMode,
    type: requireText(surface.type ?? "ObjectAgent", "object agent discovery type")
  }), members, resolvedPolicy);
}

export function renderLiveObjectDoc(surface, {
  mode = DiscoveryMode.CONCISE,
  policy = defineDiscoveryPolicy()
} = {}) {
  invariant(surface && typeof surface === "object", "live object discovery surface is required");
  invariant(Array.isArray(surface.methods ?? []), "live object discovery methods must be an array");
  invariant(Array.isArray(surface.properties ?? []), "live object discovery properties must be an array");
  const resolvedMode = normalizeMode(mode);
  const resolvedPolicy = defineDiscoveryPolicy(policy);
  const members = [
    ...(surface.methods ?? []).map((member) => normalizeLiveMethod(member, resolvedMode, resolvedPolicy)),
    ...(surface.properties ?? []).map((member) => normalizeLiveProperty(member, resolvedMode, resolvedPolicy))
  ].sort((left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
  return boundedDocument(Object.freeze({
    kind: "LIVE_OBJECT_DOC",
    mode: resolvedMode,
    surfaceId: requireText(surface.id, "live object discovery surface id"),
    type: surface.type == null ? null : requireText(surface.type, "live object discovery type")
  }), members, resolvedPolicy);
}

export async function docLiveObject(runtime, ref, options = {}) {
  invariant(runtime && typeof runtime.describeLiveObject === "function", "docLiveObject requires runtime.describeLiveObject()");
  const described = await runtime.describeLiveObject(ref);
  return renderLiveObjectDoc(described.surface, options);
}
