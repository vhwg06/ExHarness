import { invariant, requireText } from "./contracts.js";
import { ContextLimitExceededError } from "./errors.js";

export const ContextBlockTrust = Object.freeze({
  TRUSTED: "TRUSTED",
  UNTRUSTED: "UNTRUSTED"
});

export const ContextHistoryOverflow = Object.freeze({
  ERROR: "ERROR",
  TRUNCATE_OLDEST: "TRUNCATE_OLDEST"
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertCloneable(value, label) {
  try {
    return clone(value);
  } catch (error) {
    throw new TypeError(`${label} must be structured-cloneable`, { cause: error });
  }
}

function validatePromptData(value, label, seen = new WeakSet()) {
  if (value == null) return;
  const type = typeof value;
  if (type === "string" || type === "boolean") return;
  if (type === "number") {
    invariant(Number.isFinite(value), `${label} numbers must be finite`);
    return;
  }
  invariant(type === "object", `${label} must contain only JSON-compatible prompt data`);
  invariant(!seen.has(value), `${label} cannot contain cycles`);
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => validatePromptData(item, `${label}[${index}]`, seen));
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  invariant(prototype === Object.prototype || prototype === null, `${label} must contain only plain objects and arrays`);
  invariant(Object.getOwnPropertySymbols(value).length === 0, `${label} cannot contain symbol keys`);
  for (const [key, child] of Object.entries(value)) {
    validatePromptData(child, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function normalizePromptData(value, label) {
  const cloned = assertCloneable(value, label);
  validatePromptData(cloned, label);
  return cloned;
}

function serializedChars(value) {
  try {
    const serialized = JSON.stringify(value);
    return serialized == null ? 0 : serialized.length;
  } catch (error) {
    throw new TypeError("rendered prompt context must be JSON-serializable", { cause: error });
  }
}

function normalizeNames(values, label) {
  invariant(Array.isArray(values), `${label} must be an array`);
  const result = values.map((value) => requireText(value, `${label} entry`));
  invariant(new Set(result).size === result.length, `${label} cannot contain duplicates`);
  return Object.freeze(result);
}

function contextMetadata(callId, judgment, turn) {
  invariant(turn == null || (Number.isInteger(turn) && turn > 0), "context turn must be null or a positive integer");
  return Object.freeze({
    callId: callId ?? null,
    judgment: judgment == null ? null : clone(judgment),
    turn: turn ?? null
  });
}

export function defineContextBlock(definition = {}) {
  invariant(definition && typeof definition === "object", "context block definition is required");
  const {
    name,
    description = null,
    trust = ContextBlockTrust.TRUSTED,
    value,
    resolve
  } = definition;
  const resolvedName = requireText(name, "context block name");
  const resolvedDescription = description == null
    ? null
    : requireText(description, `context block ${resolvedName} description`);
  invariant(Object.values(ContextBlockTrust).includes(trust), `context block ${resolvedName} trust is invalid`);
  const dynamic = resolve != null;
  const fixed = !dynamic && Object.prototype.hasOwnProperty.call(definition, "value");
  invariant(fixed !== dynamic, `context block ${resolvedName} requires exactly one of value or resolve()`);
  if (dynamic) invariant(typeof resolve === "function", `context block ${resolvedName} resolve must be a function`);

  const fixedValue = fixed ? normalizePromptData(value, `context block ${resolvedName} value`) : undefined;

  return Object.freeze({
    name: resolvedName,
    description: resolvedDescription,
    trust,
    dynamic,
    ...(fixed ? { value: fixedValue } : {}),
    resolve: dynamic ? resolve : null
  });
}

export function contextBlockView(block) {
  return Object.freeze({
    name: block.name,
    description: block.description ?? null,
    trust: block.trust,
    dynamic: block.dynamic === true
  });
}

export function defineContextPolicy({
  maxBlocks = 16,
  maxHistoryEvents = 32,
  maxSerializedChars = 32_768,
  historyOverflow = ContextHistoryOverflow.TRUNCATE_OLDEST
} = {}) {
  invariant(Number.isInteger(maxBlocks) && maxBlocks >= 0, "context policy maxBlocks must be a non-negative integer");
  invariant(Number.isInteger(maxHistoryEvents) && maxHistoryEvents >= 0, "context policy maxHistoryEvents must be a non-negative integer");
  invariant(Number.isInteger(maxSerializedChars) && maxSerializedChars > 0, "context policy maxSerializedChars must be a positive integer");
  invariant(Object.values(ContextHistoryOverflow).includes(historyOverflow), "context policy historyOverflow is invalid");

  return Object.freeze({ maxBlocks, maxHistoryEvents, maxSerializedChars, historyOverflow });
}

export function defineContextSelection({
  blocks = [],
  history = false,
  selectHistory = null,
  reduceHistory = null
} = {}) {
  const blockNames = normalizeNames(blocks, "context selection blocks");
  invariant(typeof history === "boolean", "context selection history must be boolean");
  if (selectHistory != null) invariant(typeof selectHistory === "function", "context history selector must be a function");
  if (reduceHistory != null) invariant(typeof reduceHistory === "function", "context history reducer must be a function");
  invariant(history || (selectHistory == null && reduceHistory == null), "history selector/reducer requires history=true");

  return Object.freeze({
    blocks: blockNames,
    history,
    selectHistory,
    reduceHistory
  });
}

function selectCanonicalEvents(canonicalEvents, selectedEvents) {
  invariant(Array.isArray(selectedEvents), "context history selector must return an array");
  const byId = new Map(canonicalEvents.map((event) => [event.id, event]));
  const selectedIds = new Set();

  for (const event of selectedEvents) {
    invariant(event && typeof event === "object", "context history selector entries must be events");
    const id = requireText(event.id, "context history selected event id");
    invariant(byId.has(id), `context history selector cannot fabricate event: ${id}`);
    invariant(!selectedIds.has(id), `context history selector cannot duplicate event: ${id}`);
    selectedIds.add(id);
  }

  const selected = canonicalEvents
    .filter((event) => selectedIds.has(event.id))
    .map((event) => clone(event));
  return normalizePromptData(selected, "context history events");
}

function enforceHistoryCount(events, policy) {
  if (events.length <= policy.maxHistoryEvents) return events;
  if (policy.historyOverflow === ContextHistoryOverflow.ERROR) {
    throw new ContextLimitExceededError({
      limit: "maxHistoryEvents",
      maximum: policy.maxHistoryEvents,
      actual: events.length
    });
  }
  if (policy.maxHistoryEvents === 0) return [];
  return events.slice(-policy.maxHistoryEvents);
}

function enforceSerializedLimit(rendered, policy) {
  let actual = serializedChars(rendered);
  if (actual <= policy.maxSerializedChars) return rendered;

  if (
    policy.historyOverflow === ContextHistoryOverflow.TRUNCATE_OLDEST &&
    rendered.history?.mode === "EVENTS"
  ) {
    const events = [...rendered.history.events];
    while (events.length > 0 && actual > policy.maxSerializedChars) {
      events.shift();
      rendered = {
        ...rendered,
        history: {
          ...rendered.history,
          sourceEventIds: events.map((event) => event.id),
          events
        }
      };
      actual = serializedChars(rendered);
    }
    if (actual <= policy.maxSerializedChars) return rendered;
  }

  throw new ContextLimitExceededError({
    limit: "maxSerializedChars",
    maximum: policy.maxSerializedChars,
    actual
  });
}

export async function renderAgentContext({
  blocks = [],
  selection = defineContextSelection(),
  policy = defineContextPolicy(),
  canonicalEvents = [],
  callId,
  judgment = null,
  turn = null
} = {}) {
  const resolvedSelection = defineContextSelection(selection);
  const resolvedPolicy = defineContextPolicy(policy);
  const metadata = contextMetadata(callId, judgment, turn);
  const registry = new Map();
  for (const definition of blocks) {
    const block = defineContextBlock(definition);
    invariant(!registry.has(block.name), `duplicate context block: ${block.name}`);
    registry.set(block.name, block);
  }

  if (resolvedSelection.blocks.length > resolvedPolicy.maxBlocks) {
    throw new ContextLimitExceededError({
      limit: "maxBlocks",
      maximum: resolvedPolicy.maxBlocks,
      actual: resolvedSelection.blocks.length
    });
  }

  const renderedBlocks = [];
  for (const name of resolvedSelection.blocks) {
    const block = registry.get(name);
    invariant(block, `context block not found: ${name}`);
    const resolvedValue = block.dynamic
      ? await block.resolve(metadata)
      : block.value;
    renderedBlocks.push({
      name: block.name,
      description: block.description ?? null,
      trust: block.trust,
      value: normalizePromptData(resolvedValue, `context block ${block.name} resolved value`)
    });
  }

  let history = {
    enabled: false,
    mode: "NONE",
    sourceEventIds: [],
    events: [],
    summary: null
  };

  if (resolvedSelection.history) {
    const canonicalSnapshot = clone(canonicalEvents);
    let selected;
    if (resolvedSelection.selectHistory) {
      const requested = await resolvedSelection.selectHistory(clone(canonicalSnapshot), metadata);
      selected = selectCanonicalEvents(canonicalSnapshot, requested);
    } else {
      selected = normalizePromptData(canonicalSnapshot, "context history events");
    }
    selected = enforceHistoryCount(selected, resolvedPolicy);

    if (resolvedSelection.reduceHistory) {
      const sourceEventIds = selected.map((event) => event.id);
      const summary = normalizePromptData(
        await resolvedSelection.reduceHistory(clone(selected), metadata),
        "context history summary"
      );
      history = {
        enabled: true,
        mode: "REDUCED",
        sourceEventIds,
        events: [],
        summary
      };
    } else {
      history = {
        enabled: true,
        mode: "EVENTS",
        sourceEventIds: selected.map((event) => event.id),
        events: clone(selected),
        summary: null
      };
    }
  }

  const rendered = enforceSerializedLimit({
    blocks: renderedBlocks,
    history
  }, resolvedPolicy);

  return deepFreeze(clone(rendered));
}
