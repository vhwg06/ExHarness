import { createHash } from "node:crypto";

import { invariant, requireText } from "./contracts.js";
import { deriveDetachedTransitionId } from "./detached-operation-store.js";
import { AsyncResultDeliveryMode, normalizeAsyncResultDelivery } from "./model.js";

export const ASYNC_RESULT_CONTEXT_SCHEMA_VERSION = 1;
export const ASYNC_OPERATION_UPDATE_KIND = "ASYNC_OPERATION_UPDATE/v1";

export const AsyncResultOperationStatus = Object.freeze({
  RUNNING: "RUNNING",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  UNKNOWN: "UNKNOWN"
});

const TERMINAL_STATUSES = Object.freeze([
  AsyncResultOperationStatus.SUCCEEDED,
  AsyncResultOperationStatus.FAILED,
  AsyncResultOperationStatus.CANCELLED,
  AsyncResultOperationStatus.UNKNOWN
]);

export const ASYNC_RESULT_CONTEXT_NON_AUTHORITY = Object.freeze({
  kind: "ASYNC_RESULT_CONTEXT_NON_AUTHORITY/v1",
  statement:
    "Async-result context items are a model-visible projection of delivered detached-operation transitions. " +
    "They cannot confirm EffectOperation truth, accept product results, or authorize external effects."
});

export class AsyncResultContextBindingError extends Error {
  constructor(message, { operationId = null, transitionId = null } = {}) {
    super(message);
    this.name = "AsyncResultContextBindingError";
    this.code = "ASYNC_RESULT_CONTEXT_BINDING_MISMATCH";
    this.operationId = operationId;
    this.transitionId = transitionId;
  }
}

export class AsyncResultContextPrefixError extends Error {
  constructor(message, { expectedDigest = null, actualDigest = null } = {}) {
    super(message);
    this.name = "AsyncResultContextPrefixError";
    this.code = "ASYNC_RESULT_CONTEXT_PREFIX_CORRUPTION";
    this.expectedDigest = expectedDigest;
    this.actualDigest = actualDigest;
  }
}

export class AsyncResultContextPairingError extends Error {
  constructor(message, { providerCallId = null, mode = null } = {}) {
    super(message);
    this.name = "AsyncResultContextPairingError";
    this.code = "ASYNC_RESULT_CONTEXT_PAIRING_VIOLATION";
    this.providerCallId = providerCallId;
    this.mode = mode;
  }
}

export class AsyncResultContextAuthorityError extends Error {
  constructor(message) {
    super(message);
    this.name = "AsyncResultContextAuthorityError";
    this.code = "ASYNC_RESULT_CONTEXT_NON_AUTHORITY";
  }
}

export class AsyncResultDependencyContradictionError extends Error {
  constructor(message, { taskId = null } = {}) {
    super(message);
    this.name = "AsyncResultDependencyContradictionError";
    this.code = "PLAN_INPUT_CONTRADICTION";
    this.taskId = taskId;
  }
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function deepFreeze(value, seen = new Set()) {
  if (value == null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  const kind = typeof value;
  if (kind === "number" || kind === "boolean" || kind === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (kind === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isAsyncTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

function requirePositiveInteger(value, label) {
  invariant(Number.isInteger(value) && value >= 1, `${label} must be a positive integer`);
  return value;
}

function normalizeTransitionInput(transition) {
  invariant(transition && typeof transition === "object" && !Array.isArray(transition), "async-result transition envelope is required");
  const operationId = requireText(transition.operationId, "async-result transition operationId");
  const transitionId = requireText(transition.transitionId, "async-result transition transitionId");
  const generation = requirePositiveInteger(transition.generation, "async-result transition generation");
  const sequence = requirePositiveInteger(transition.sequence, "async-result transition sequence");
  const status = requireText(transition.status, "async-result transition status");
  invariant(
    Object.values(AsyncResultOperationStatus).includes(status),
    `async-result transition status must be one of ${Object.values(AsyncResultOperationStatus).join("|")}`
  );
  const embedded = transition.binding != null ? transition.binding : null;
  if (embedded != null) {
    invariant(typeof embedded === "object" && !Array.isArray(embedded), "async-result transition binding must be an object");
  }
  const callId = embedded?.callId !== undefined ? embedded.callId : transition.callId;
  const effectOperationId = embedded?.effectOperationId !== undefined ? embedded.effectOperationId : transition.effectOperationId;
  invariant(
    callId === null || typeof callId === "string",
    "async-result transition callId must be a string or null"
  );
  if (callId != null) requireText(callId, "async-result transition callId");
  if (effectOperationId == null) {
    throw new AsyncResultContextBindingError(
      `async-result transition ${transitionId} has unresolved effect identity: effectOperationId is required and ambiguity fails closed`,
      { operationId, transitionId }
    );
  }
  requireText(effectOperationId, "async-result transition effectOperationId");
  const expectedTransitionId = deriveDetachedTransitionId({ operationId, generation, sequence, status });
  if (transitionId !== expectedTransitionId) {
    throw new AsyncResultContextBindingError(
      `async-result transitionId ${transitionId} does not derive from its operationId/generation/sequence/status envelope (expected ${expectedTransitionId}): forged or corrupted identity fails closed`,
      { operationId, transitionId }
    );
  }
  return Object.freeze({
    operationId,
    transitionId,
    generation,
    sequence,
    status,
    callId: callId ?? null,
    effectOperationId,
    result: clone(transition.result ?? null),
    error: transition.error == null ? null : clone(transition.error)
  });
}

function bindingKey(normalized) {
  return stableStringify({
    operationId: normalized.operationId,
    callId: normalized.callId,
    effectOperationId: normalized.effectOperationId,
    generation: normalized.generation,
    sequence: normalized.sequence,
    status: normalized.status
  });
}

function serializeItem(item) {
  return stableStringify({
    kind: item.kind,
    schemaVersion: item.schemaVersion,
    itemId: item.itemId,
    operationId: item.operationId,
    callId: item.callId,
    effectOperationId: item.effectOperationId,
    generation: item.generation,
    sequence: item.sequence,
    transitionId: item.transitionId,
    status: item.status,
    terminal: item.terminal,
    result: item.result,
    error: item.error
  });
}

function digestOfBytes(text) {
  return `sha256:${sha256Hex(text)}`;
}

function projectionBytes(items) {
  if (items.length === 0) return "";
  return items.map(serializeItem).join("\n");
}

function refreshDigests(state) {
  const committedText = projectionBytes(state.committedItems);
  const stagedText = projectionBytes(state.stagedItems);
  state.committedPrefixText = committedText;
  state.committedPrefixBytes = Buffer.byteLength(committedText, "utf8");
  state.committedPrefixDigest = digestOfBytes(committedText);
  state.stagedSuffixBytes = Buffer.byteLength(stagedText, "utf8");
  state.stagedSuffixDigest = digestOfBytes(stagedText);
}

function requireCheckpointShape(state) {
  invariant(state && typeof state === "object", "async-result context state is required");
  invariant(state.schemaVersion === ASYNC_RESULT_CONTEXT_SCHEMA_VERSION, "async-result context checkpoint schema is unsupported");
  invariant(Array.isArray(state.committedItems) && Array.isArray(state.stagedItems), "async-result context state has invalid checkpoint shape");
  invariant(state.seenTransitionBindings && typeof state.seenTransitionBindings === "object", "async-result context state has invalid transition registry");
  return state;
}

// Committed items are the trust anchor: recompute their canonical digest on
// every entry and fail closed when the recorded digest no longer matches, so
// a mutated JSON checkpoint or a rewritten committed payload cannot silently
// pass as the submitted prefix.
function verifyCommittedIntegrity(state) {
  requireCheckpointShape(state);
  const text = projectionBytes(state.committedItems);
  const digest = digestOfBytes(text);
  if (digest !== state.committedPrefixDigest) {
    throw new AsyncResultContextPrefixError(
      "committed async-result checkpoint failed integrity verification: recorded prefix digest does not match the committed items",
      { expectedDigest: state.committedPrefixDigest ?? null, actualDigest: digest }
    );
  }
  return text;
}

function operationBindingOf(item) {
  return stableStringify({ callId: item.callId ?? null, effectOperationId: item.effectOperationId });
}

// Registries are derived from accepted items, never trusted from a restored
// checkpoint blindly: conflicting operation bindings across items fail closed.
function rebuildRegistries(state) {
  const seenTransitionBindings = {};
  const seenOperationBindings = {};
  const maxGenerationByOperation = {};
  const lastSequenceByOperation = {};
  for (const item of [...state.committedItems, ...state.stagedItems]) {
    invariant(item && typeof item === "object", "async-result checkpoint item is required");
    invariant(item.kind === ASYNC_OPERATION_UPDATE_KIND, "async-result checkpoint item must be an ASYNC_OPERATION_UPDATE/v1 projection");
    requireText(item.transitionId, "async-result checkpoint item transitionId");
    requireText(item.operationId, "async-result checkpoint item operationId");
    seenTransitionBindings[item.transitionId] = bindingKey({
      operationId: item.operationId,
      callId: item.callId ?? null,
      effectOperationId: item.effectOperationId,
      generation: item.generation,
      sequence: item.sequence,
      status: item.status
    });
    const binding = operationBindingOf(item);
    const known = seenOperationBindings[item.operationId];
    if (known != null && known !== binding) {
      throw new AsyncResultContextBindingError(
        `async-result checkpoint holds conflicting bindings for operation ${item.operationId}: call/effect identity changed without failure`,
        { operationId: item.operationId, transitionId: item.transitionId }
      );
    }
    seenOperationBindings[item.operationId] = binding;
    if (Number.isInteger(item.generation) && (maxGenerationByOperation[item.operationId] ?? 0) < item.generation) {
      maxGenerationByOperation[item.operationId] = item.generation;
    }
    if (Number.isInteger(item.sequence) && (lastSequenceByOperation[item.operationId] ?? 0) < item.sequence) {
      lastSequenceByOperation[item.operationId] = item.sequence;
    }
  }
  state.seenTransitionBindings = seenTransitionBindings;
  state.seenOperationBindings = seenOperationBindings;
  state.maxGenerationByOperation = maxGenerationByOperation;
  state.lastSequenceByOperation = lastSequenceByOperation;
  return state;
}

export function createAsyncResultContextState({ profile = null } = {}) {
  const state = {
    schemaVersion: ASYNC_RESULT_CONTEXT_SCHEMA_VERSION,
    profile: profile == null ? null : clone(profile),
    committedItems: [],
    stagedItems: [],
    seenTransitionBindings: {},
    seenOperationBindings: {},
    maxGenerationByOperation: {},
    lastSequenceByOperation: {},
    committedPrefixDigest: digestOfBytes(""),
    committedPrefixBytes: 0,
    stagedSuffixDigest: digestOfBytes(""),
    stagedSuffixBytes: 0,
    committedPrefixText: "",
    submissionCount: 0,
    lastSubmissionId: null
  };
  return state;
}

export function restoreAsyncResultContextState(checkpoint) {
  invariant(checkpoint && typeof checkpoint === "object", "async-result checkpoint is required");
  invariant(
    checkpoint.schemaVersion === ASYNC_RESULT_CONTEXT_SCHEMA_VERSION,
    "async-result checkpoint schema is unsupported"
  );
  invariant(Array.isArray(checkpoint.committedItems), "async-result checkpoint committedItems must be an array");
  invariant(Array.isArray(checkpoint.stagedItems), "async-result checkpoint stagedItems must be an array");
  const state = {
    schemaVersion: ASYNC_RESULT_CONTEXT_SCHEMA_VERSION,
    profile: clone(checkpoint.profile ?? null),
    committedItems: clone(checkpoint.committedItems),
    stagedItems: clone(checkpoint.stagedItems),
    seenTransitionBindings: {},
    seenOperationBindings: {},
    maxGenerationByOperation: {},
    lastSequenceByOperation: {},
    committedPrefixDigest: checkpoint.committedPrefixDigest ?? null,
    committedPrefixBytes: checkpoint.committedPrefixBytes ?? 0,
    stagedSuffixDigest: checkpoint.stagedSuffixDigest ?? null,
    stagedSuffixBytes: checkpoint.stagedSuffixBytes ?? 0,
    committedPrefixText: "",
    submissionCount: checkpoint.submissionCount ?? 0,
    lastSubmissionId: checkpoint.lastSubmissionId ?? null
  };
  rebuildRegistries(state);
  verifyCommittedIntegrity(state);
  const stagedText = projectionBytes(state.stagedItems);
  if (state.stagedSuffixDigest != null && digestOfBytes(stagedText) !== state.stagedSuffixDigest) {
    throw new AsyncResultContextPrefixError(
      "restored async-result checkpoint failed staged integrity verification: recorded suffix digest does not match the staged items",
      { expectedDigest: state.stagedSuffixDigest, actualDigest: digestOfBytes(stagedText) }
    );
  }
  // Freeze every item deeply so in-memory nested mutation fails loudly; the
  // container arrays stay mutable because stage/commit append through them.
  for (const item of [...state.committedItems, ...state.stagedItems]) deepFreeze(item);
  refreshDigests(state);
  return state;
}

export function stageAsyncResultTransitions({ state, transitions, profile = null } = {}) {
  verifyCommittedIntegrity(state);
  invariant(Array.isArray(transitions), "async-result transitions must be an array");
  if (profile != null) {
    invariant(typeof profile === "object", "async-result context profile must be an object");
  }
  const staged = [];
  const skippedDuplicateIds = [];
  for (const candidate of transitions) {
    const normalized = normalizeTransitionInput(candidate);
    const known = state.seenTransitionBindings[normalized.transitionId];
    if (known != null) {
      if (known !== bindingKey(normalized)) {
        throw new AsyncResultContextBindingError(
          `async-result transitionId reuse with conflicting binding: ${normalized.transitionId}`,
          { operationId: normalized.operationId, transitionId: normalized.transitionId }
        );
      }
      skippedDuplicateIds.push(normalized.transitionId);
      continue;
    }
    // Operation identity is delivered truth, not prompt text: the first staged
    // transition for an operationId fixes its call/effect binding and every
    // later transitionId for the same operation must carry the identical
    // binding. Generation may advance lawfully (BB-078 takeover/recovery) and
    // stale generations may redeliver at-least-once, so generation motion is
    // recorded, never a corruption signal by itself.
    const knownOperation = state.seenOperationBindings[normalized.operationId];
    const operationBinding = stableStringify({
      callId: normalized.callId,
      effectOperationId: normalized.effectOperationId
    });
    if (knownOperation != null && knownOperation !== operationBinding) {
      throw new AsyncResultContextBindingError(
        `async-result operation ${normalized.operationId} changed call/effect binding on a new transitionId ${normalized.transitionId}: corrupted operation identity fails closed`,
        { operationId: normalized.operationId, transitionId: normalized.transitionId }
      );
    }
    const terminal = isAsyncTerminalStatus(normalized.status);
    const item = deepFreeze({
      kind: ASYNC_OPERATION_UPDATE_KIND,
      schemaVersion: ASYNC_RESULT_CONTEXT_SCHEMA_VERSION,
      itemId: `async-result:${normalized.transitionId}`,
      operationId: normalized.operationId,
      callId: normalized.callId,
      effectOperationId: normalized.effectOperationId,
      generation: normalized.generation,
      sequence: normalized.sequence,
      transitionId: normalized.transitionId,
      status: normalized.status,
      terminal,
      result: terminal ? normalized.result : null,
      error: terminal ? normalized.error : null,
      authority: "projection-only; not effect truth"
    });
    state.seenTransitionBindings[normalized.transitionId] = bindingKey(normalized);
    state.seenOperationBindings[normalized.operationId] = operationBinding;
    if ((state.maxGenerationByOperation[normalized.operationId] ?? 0) < normalized.generation) {
      state.maxGenerationByOperation[normalized.operationId] = normalized.generation;
    }
    const previous = state.lastSequenceByOperation[normalized.operationId] ?? 0;
    if (normalized.sequence > previous) {
      state.lastSequenceByOperation[normalized.operationId] = normalized.sequence;
    }
    state.stagedItems.push(item);
    staged.push(item);
  }
  refreshDigests(state);
  return Object.freeze({
    stagedItemIds: Object.freeze(staged.map((item) => item.itemId)),
    skippedDuplicateTransitionIds: Object.freeze(skippedDuplicateIds),
    committedPrefixDigest: state.committedPrefixDigest,
    committedPrefixBytes: state.committedPrefixBytes,
    stagedSuffixDigest: state.stagedSuffixDigest,
    stagedSuffixBytes: state.stagedSuffixBytes
  });
}

export function commitAsyncResultContext({ state, stagedItemIds, submissionId } = {}) {
  verifyCommittedIntegrity(state);
  invariant(Array.isArray(stagedItemIds) && stagedItemIds.length > 0, "commit requires at least one staged item id");
  requireText(submissionId, "async-result commit submissionId");
  for (const itemId of stagedItemIds) requireText(itemId, "async-result commit staged item id");
  const stagedById = new Map(state.stagedItems.map((item) => [item.itemId, item]));
  for (const itemId of stagedItemIds) {
    invariant(stagedById.has(itemId), `async-result commit references unknown or already-committed staged item: ${itemId}`);
  }
  invariant(
    new Set(stagedItemIds).size === stagedItemIds.length,
    "commit staged item ids must be unique: duplicate commit of one staged item is rejected"
  );
  // Commits follow the submitted projection order from the front: the caller
  // may commit a leading prefix of the staged suffix, but never reorder or
  // skip staged items, so the committed prefix stays an exact byte prefix.
  const expectedPrefix = state.stagedItems.slice(0, stagedItemIds.length).map((item) => item.itemId);
  invariant(
    JSON.stringify(expectedPrefix) === JSON.stringify(stagedItemIds),
    "commit must follow staged projection order from the front without reordering or skipping staged items"
  );
  const ordered = stagedItemIds.map((itemId) => stagedById.get(itemId));
  const committedIds = new Set(ordered.map((item) => item.itemId));
  state.stagedItems = state.stagedItems.filter((item) => !committedIds.has(item.itemId));
  for (const item of ordered) {
    state.committedItems.push(item);
  }
  state.submissionCount += 1;
  state.lastSubmissionId = submissionId;
  refreshDigests(state);
  return Object.freeze({
    submissionId,
    committedItemIds: Object.freeze(ordered.map((item) => item.itemId)),
    committedPrefixDigest: state.committedPrefixDigest,
    committedPrefixBytes: state.committedPrefixBytes,
    stagedSuffixDigest: state.stagedSuffixDigest,
    stagedSuffixBytes: state.stagedSuffixBytes,
    itemOrder: Object.freeze(state.committedItems.map((item) => item.itemId))
  });
}

export function projectAsyncResultRequest({ state, providerTelemetry = null } = {}) {
  const committedText = verifyCommittedIntegrity(state);
  refreshDigests(state);
  let providerCachedTokens = null;
  let providerCacheWriteTokens = null;
  let providerTelemetryStatus = "missing";
  if (providerTelemetry != null) {
    invariant(typeof providerTelemetry === "object", "provider telemetry must be an object");
    if (typeof providerTelemetry.cachedTokens === "number") {
      providerCachedTokens = providerTelemetry.cachedTokens;
      providerTelemetryStatus = "reported";
    }
    if (typeof providerTelemetry.cacheWriteTokens === "number") {
      providerCacheWriteTokens = providerTelemetry.cacheWriteTokens;
      providerTelemetryStatus = providerTelemetryStatus === "reported" ? "reported" : "reported";
    }
    if (typeof providerTelemetry.reason === "string" && providerTelemetryStatus === "missing") {
      invariant(
        ["unsupported", "missing", "ambiguous"].includes(providerTelemetry.reason),
        "provider telemetry reason must be unsupported|missing|ambiguous"
      );
      providerTelemetryStatus = providerTelemetry.reason;
    }
  }
  return Object.freeze({
    committedBytes: state.committedPrefixText,
    committedPrefixSha256: state.committedPrefixDigest,
    committedPrefixBytes: state.committedPrefixBytes,
    stagedSuffixSha256: state.stagedSuffixDigest,
    stagedSuffixBytes: state.stagedSuffixBytes,
    itemIds: Object.freeze(state.committedItems.map((item) => item.itemId)),
    stagedItemIds: Object.freeze(state.stagedItems.map((item) => item.itemId)),
    providerCachedTokens,
    providerCacheWriteTokens,
    providerTelemetryStatus
  });
}

export function assertCommittedPrefixStable({ previousCommittedBytes, state } = {}) {
  invariant(typeof previousCommittedBytes === "string", "previous committed bytes are required");
  const current = verifyCommittedIntegrity(state);
  refreshDigests(state);
  if (!current.startsWith(previousCommittedBytes)) {
    throw new AsyncResultContextPrefixError(
      "committed async-result prefix is not byte-stable: prior committed bytes are not an exact prefix of the current request projection",
      { expectedDigest: digestOfBytes(previousCommittedBytes), actualDigest: state.committedPrefixDigest }
    );
  }
  return Object.freeze({
    stable: true,
    committedPrefixDigest: state.committedPrefixDigest,
    committedPrefixBytes: state.committedPrefixBytes
  });
}

export function translateAsyncResultForProvider({
  mode,
  item,
  providerCallId,
  fulfilledProviderCallIds = [],
  deliveredTerminalTransitionIds = []
} = {}) {
  requireText(providerCallId, "async-result provider providerCallId");
  invariant(Array.isArray(fulfilledProviderCallIds), "fulfilled provider call ids must be an array");
  invariant(Array.isArray(deliveredTerminalTransitionIds), "delivered terminal transition ids must be an array");
  invariant(item && typeof item === "object", "async-result item is required");
  invariant(item.kind === ASYNC_OPERATION_UPDATE_KIND, "async-result item must be an ASYNC_OPERATION_UPDATE/v1 projection");
  const resolvedMode = Object.values(AsyncResultDeliveryMode).includes(mode)
    ? mode
    : AsyncResultDeliveryMode.SYNCHRONOUS;
  const alreadyFulfilled = fulfilledProviderCallIds.includes(providerCallId);
  // Late terminal output is delivered once on the original call id: repeating
  // the same terminal transition is a pairing violation in every mode.
  const terminalAlreadyDelivered = item.terminal === true
    && deliveredTerminalTransitionIds.includes(item.transitionId);
  if (terminalAlreadyDelivered) {
    throw new AsyncResultContextPairingError(
      `terminal output for transition ${item.transitionId} was already delivered on ${providerCallId}; repeating it would corrupt one-call pairing`,
      { providerCallId, mode: resolvedMode }
    );
  }
  if (resolvedMode === AsyncResultDeliveryMode.NATIVE_PENDING_CALL) {
    if (!item.terminal) {
      return Object.freeze({
        mode: resolvedMode,
        providerCallId,
        pendingCall: true,
        toolResult: null,
        asyncEvent: null,
        waiting: false
      });
    }
    // Exactly one terminal result may close the original pending call: a
    // different terminal transition for an already-fulfilled call id is a
    // second tool result and fails closed rather than emitting it.
    if (alreadyFulfilled) {
      throw new AsyncResultContextPairingError(
        `native provider route already fulfilled ${providerCallId}; a second terminal tool result is rejected`,
        { providerCallId, mode: resolvedMode }
      );
    }
    return Object.freeze({
      mode: resolvedMode,
      providerCallId,
      pendingCall: false,
      toolResult: Object.freeze({ providerCallId, output: clone(item.result), error: clone(item.error) }),
      asyncEvent: null,
      waiting: false
    });
  }
  if (resolvedMode === AsyncResultDeliveryMode.HANDLE_THEN_EVENT) {
    if (!item.terminal) {
      if (alreadyFulfilled) {
        throw new AsyncResultContextPairingError(
          `strict provider route already fulfilled ${providerCallId}; a second tool result is rejected`,
          { providerCallId, mode: resolvedMode }
        );
      }
      return Object.freeze({
        mode: resolvedMode,
        providerCallId,
        pendingCall: false,
        toolResult: Object.freeze({
          providerCallId,
          handle: Object.freeze({
            operationId: item.operationId,
            transitionId: item.transitionId,
            status: item.status
          })
        }),
        asyncEvent: null,
        waiting: false
      });
    }
    if (alreadyFulfilled) {
      return Object.freeze({
        mode: resolvedMode,
        providerCallId,
        pendingCall: false,
        toolResult: null,
        asyncEvent: item,
        waiting: false
      });
    }
    // Pairing-safe terminal without a prior RUNNING handle: the original
    // strict call was never satisfied, so the terminal output itself becomes
    // the single tool result for that call rather than a second result later.
    return Object.freeze({
      mode: resolvedMode,
      providerCallId,
      pendingCall: false,
      toolResult: Object.freeze({ providerCallId, output: clone(item.result), error: clone(item.error) }),
      asyncEvent: null,
      waiting: false
    });
  }
  if (!item.terminal) {
    return Object.freeze({
      mode: AsyncResultDeliveryMode.SYNCHRONOUS,
      providerCallId,
      pendingCall: false,
      toolResult: null,
      asyncEvent: null,
      waiting: true
    });
  }
  if (alreadyFulfilled) {
    throw new AsyncResultContextPairingError(
      `synchronous provider route already fulfilled ${providerCallId}; one-call/one-result pairing forbids a second tool result`,
      { providerCallId, mode: resolvedMode }
    );
  }
  return Object.freeze({
    mode: AsyncResultDeliveryMode.SYNCHRONOUS,
    providerCallId,
    pendingCall: false,
    toolResult: Object.freeze({ providerCallId, output: clone(item.result), error: clone(item.error) }),
    asyncEvent: null,
    waiting: false
  });
}

export function assertProviderToolResultAllowed({ mode, providerCallId, fulfilledProviderCallIds = [] } = {}) {
  requireText(providerCallId, "async-result provider providerCallId");
  invariant(Array.isArray(fulfilledProviderCallIds), "fulfilled provider call ids must be an array");
  const resolvedMode = Object.values(AsyncResultDeliveryMode).includes(mode)
    ? mode
    : AsyncResultDeliveryMode.SYNCHRONOUS;
  if (fulfilledProviderCallIds.includes(providerCallId)) {
    throw new AsyncResultContextPairingError(
      `provider route ${resolvedMode} already fulfilled ${providerCallId}; another tool result would corrupt pairing`,
      { providerCallId, mode: resolvedMode }
    );
  }
  return Object.freeze({ allowed: true, mode: resolvedMode, providerCallId });
}

export function resolveEffectConfirmationFromProjection() {
  throw new AsyncResultContextAuthorityError(
    "async-result context projection cannot confirm EffectOperation truth: confirmation requires the effect journal/reconciliation authority"
  );
}

export function resolveProductAcceptanceFromProjection() {
  throw new AsyncResultContextAuthorityError(
    "async-result context projection cannot accept a product result: acceptance requires independent evaluation authority"
  );
}

export function getAsyncResultContextDependencyManifest() {
  return Object.freeze({
    schemaVersion: 1,
    contract: "BB-079_DEPENDENCY_MANIFEST_V1",
    requires: Object.freeze([
      Object.freeze({
        taskId: "BB-077",
        status: "DONE",
        implementationResultRef: "docs/blackboard/artifacts/ready-implement-plan/BB-077.implementation-result.json",
        judgmentRef: "docs/blackboard/artifacts/ready-implement-plan/BB-077.candidate-jev-evaluation.json",
        deliveredRef: "docs/blackboard/artifacts/ready-implement-plan/BB-077.delivered-feature.json",
        livingRefs: Object.freeze([
          "docs/living/system/core-harness/state.md",
          "docs/living/system/core-harness/workflow.md"
        ]),
        accountingVocabulary: Object.freeze(["stable-prefix", "dynamic-suffix", "CONFIRMED", "MISS", "ELIGIBLE", "UNKNOWN"]),
        telemetryRule: "missing provider cache fields stay null/unknown, never zero"
      }),
      Object.freeze({
        taskId: "BB-078",
        status: "DONE",
        implementationResultRef: "docs/blackboard/artifacts/ready-implement-plan/BB-078.implementation-result.json",
        judgmentRef: "docs/blackboard/artifacts/ready-implement-plan/BB-078.candidate-jev-evaluation.json",
        deliveredRef: "docs/blackboard/artifacts/ready-implement-plan/BB-078.delivered-feature.json",
        livingRefs: Object.freeze([
          "docs/living/system/core-harness/state.md",
          "docs/living/system/core-harness/workflow.md"
        ]),
        transitionEnvelope: Object.freeze([
          "transitionId",
          "operationId",
          "scopeId",
          "status",
          "generation",
          "sequence",
          "result",
          "error",
          "evidence",
          "reason",
          "at"
        ]),
        storeApi: Object.freeze([
          "createSessionDetachedOperationStore",
          "createInMemoryDetachedOperationStore",
          "createDetachedOperationManager"
        ])
      })
    ])
  });
}

export function assertDependencyContract({ bb077, bb078 } = {}) {
  for (const candidate of [
    { label: "BB-077", value: bb077 },
    { label: "BB-078", value: bb078 }
  ]) {
    if (candidate.value == null || typeof candidate.value !== "object") {
      throw new AsyncResultDependencyContradictionError(
        `${candidate.label} dependency descriptor is missing: worker must bind to the exact DONE implementation-result/judgment/Living refs`,
        { taskId: candidate.label }
      );
    }
    if (candidate.value.status !== "DONE") {
      throw new AsyncResultDependencyContradictionError(
        `${candidate.label} is not DONE (status=${candidate.value.status ?? "unknown"}): BB-079 worker execution requires DONE dependencies`,
        { taskId: candidate.label }
      );
    }
  }
  const manifest = getAsyncResultContextDependencyManifest();
  const expected077 = manifest.requires[0];
  const expected078 = manifest.requires[1];
  for (const field of ["implementationResultRef", "judgmentRef", "deliveredRef"]) {
    if (bb077[field] !== expected077[field]) {
      throw new AsyncResultDependencyContradictionError(
        `BB-077 ${field} mismatch: expected ${expected077[field]}, received ${bb077[field] ?? "missing"}`,
        { taskId: "BB-077" }
      );
    }
  }
  for (const field of ["implementationResultRef", "judgmentRef", "deliveredRef"]) {
    if (bb078[field] !== expected078[field]) {
      throw new AsyncResultDependencyContradictionError(
        `BB-078 ${field} mismatch: expected ${expected078[field]}, received ${bb078[field] ?? "missing"}`,
        { taskId: "BB-078" }
      );
    }
  }
  if (bb078.transitionEnvelope != null) {
    const missing = expected078.transitionEnvelope.filter((field) => !bb078.transitionEnvelope.includes(field));
    if (missing.length > 0) {
      throw new AsyncResultDependencyContradictionError(
        `BB-078 transition envelope is incompatible: missing ${missing.join(", ")}`,
        { taskId: "BB-078" }
      );
    }
  }
  if (bb078.storeApi != null) {
    const missing = expected078.storeApi.filter((name) => !bb078.storeApi.includes(name));
    if (missing.length > 0) {
      throw new AsyncResultDependencyContradictionError(
        `BB-078 store API is incompatible: missing ${missing.join(", ")}`,
        { taskId: "BB-078" }
      );
    }
  }
  if (bb077.accountingVocabulary != null) {
    const missing = expected077.accountingVocabulary.filter((term) => !bb077.accountingVocabulary.includes(term));
    if (missing.length > 0) {
      throw new AsyncResultDependencyContradictionError(
        `BB-077 accounting vocabulary is incompatible: missing ${missing.join(", ")}`,
        { taskId: "BB-077" }
      );
    }
  }
  return Object.freeze({ satisfied: true, contract: manifest.contract });
}

export { AsyncResultDeliveryMode, normalizeAsyncResultDelivery };
