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

function assertCloneable(value, label) {
  try {
    return clone(value);
  } catch (error) {
    throw new TypeError(`${label} must be structured-cloneable`, { cause: error });
  }
}

function serializedChars(value) {
  const serialized = JSON.stringify(value);
  return serialized == null ? 0 : serialized.length;
}

function normalizeNames(values, label) {
  invariant(Array.isArray(values), `${label} must be an array`);
  const result = values.map((value) => requireText(value, `${label} entry`));
  invariant(new Set(result).size === result.length, `${label} cannot contain duplicates`);
  return Object.freeze(result);
}

export function defineContextBlock({
  name,
  description = null,
  trust = ContextBlockTrust.TRUSTED,
  value,
  resolve
} = {}) {
  const resolvedName = requireText(name, "context block name");
  invariant(Object.values(ContextBlockTrust).includes(trust), `context block ${resolvedName} trust is invalid`);
  const fixed = Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, "value");
  const dynamic = resolve != null;
  invariant(fixed !== dynamic, `context block ${resolvedName} requires exactly one of value or resolve()`);
  if (dynamic) invariant(typeof resolve === "function", `context block ${resolvedName} resolve must be a function`);

  const fixedValue = fixed ? assertCloneable(value, `context block ${resolvedName} value`) : undefined;

  return Object.freeze({
    name: resolvedName,
    description,
    trust,
    dynamic,
    value: fixed ? fixedValue : undefined,
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

function normalizeSelectedEvents(value) {
  invariant(Array.isArray(value), "context history selector must return an array");
  return clone(value);
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
  judgment = null
} = {}) {
  const resolvedSelection = defineContextSelection(selection);
  const resolvedPolicy = defineContextPolicy(policy);
  const registry = new Map();
  for (const definition of blocks) {
    const block = defineContextBlock(definition);
    invariant(!registry.has(block.name), `duplicate context block: ${block.name}`);
    registry.set(block.name, block);
  }

  invariant(
    resolvedSelection.blocks.length <= resolvedPolicy.maxBlocks,
    `context selection exceeds maxBlocks ${resolvedPolicy.maxBlocks}`
  );

  const renderedBlocks = [];
  for (const name of resolvedSelection.blocks) {
    const block = registry.get(name);
    invariant(block, `context block not found: ${name}`);
    const resolvedValue = block.dynamic
      ? await block.resolve(Object.freeze({
          callId: callId ?? null,
          judgment: judgment == null ? null : clone(judgment)
        }))
      : block.value;
    renderedBlocks.push(Object.freeze({
      name: block.name,
      description: block.description ?? null,
      trust: block.trust,
      value: assertCloneable(resolvedValue, `context block ${block.name} resolved value`)
    }));
  }

  let history = Object.freeze({
    enabled: false,
    mode: "NONE",
    sourceEventIds: Object.freeze([]),
    events: Object.freeze([]),
    summary: null
  });

  if (resolvedSelection.history) {
    let selected = clone(canonicalEvents);
    if (resolvedSelection.selectHistory) {
      selected = normalizeSelectedEvents(await resolvedSelection.selectHistory(clone(selected), Object.freeze({
        callId: callId ?? null,
        judgment: judgment == null ? null : clone(judgment)
      })));
    }
    selected = enforceHistoryCount(selected, resolvedPolicy);

    if (resolvedSelection.reduceHistory) {
      const sourceEventIds = Object.freeze(selected.map((event) => event.id));
      const summary = assertCloneable(
        await resolvedSelection.reduceHistory(clone(selected), Object.freeze({
          callId: callId ?? null,
          judgment: judgment == null ? null : clone(judgment)
        })),
        "context history summary"
      );
      history = Object.freeze({
        enabled: true,
        mode: "REDUCED",
        sourceEventIds,
        events: Object.freeze([]),
        summary
      });
    } else {
      history = Object.freeze({
        enabled: true,
        mode: "EVENTS",
        sourceEventIds: Object.freeze(selected.map((event) => event.id)),
        events: Object.freeze(clone(selected)),
        summary: null
      });
    }
  }

  const rendered = enforceSerializedLimit({
    blocks: renderedBlocks,
    history
  }, resolvedPolicy);

  return Object.freeze(clone(rendered));
}
