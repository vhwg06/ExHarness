import { invariant, requireText } from "./contracts.js";

export const AsyncResultDeliveryMode = Object.freeze({
  NATIVE_PENDING_CALL: "NATIVE_PENDING_CALL",
  HANDLE_THEN_EVENT: "HANDLE_THEN_EVENT",
  SYNCHRONOUS: "SYNCHRONOUS"
});

export function normalizeAsyncResultDelivery(value, label = "model.asyncResultDelivery") {
  if (value == null) return AsyncResultDeliveryMode.SYNCHRONOUS;
  invariant(
    Object.values(AsyncResultDeliveryMode).includes(value),
    `${label} must be one of ${Object.values(AsyncResultDeliveryMode).join("|")}`
  );
  return value;
}

export const ModelGenerationCancellationMode = Object.freeze({
  ABORT_SIGNAL: "ABORT_SIGNAL",
  FENCE_ONLY: "FENCE_ONLY"
});

export function normalizeGenerationCancellation(value, label = "model.generationCancellation") {
  if (value == null) return ModelGenerationCancellationMode.FENCE_ONLY;
  invariant(
    Object.values(ModelGenerationCancellationMode).includes(value),
    `${label} must be one of ${Object.values(ModelGenerationCancellationMode).join("|")}`
  );
  return value;
}

export function defineModelAdapter({ name = "model", version = null, generate, asyncResultDelivery = null, generationCancellation = null }) {
  invariant(typeof generate === "function", "model adapter requires generate()");
  return Object.freeze({
    name: requireText(name, "model.name"),
    version: version == null ? null : requireText(version, "model.version"),
    asyncResultDelivery: normalizeAsyncResultDelivery(asyncResultDelivery),
    generationCancellation: normalizeGenerationCancellation(generationCancellation),
    generate
  });
}

// The serialized view stays byte-compatible with the pre-existing
// { name, version } shape whenever the adapter uses the default synchronous
// delivery and fence-only cancellation: existing synchronous adapters preserve
// current behavior exactly, including route/usage/history bytes. A declared
// native/handle capability or abort-signal capability is carried explicitly;
// missing metadata always queries as SYNCHRONOUS / FENCE_ONLY.
export function modelAdapterView(model) {
  const name = model.name;
  const version = model.version;
  const delivery = normalizeAsyncResultDelivery(
    model.asyncResultDelivery ?? null,
    "model view asyncResultDelivery"
  );
  const cancellation = normalizeGenerationCancellation(
    model.generationCancellation ?? null,
    "model view generationCancellation"
  );
  if (delivery === AsyncResultDeliveryMode.SYNCHRONOUS && cancellation === ModelGenerationCancellationMode.FENCE_ONLY) {
    return Object.freeze({ name, version });
  }
  const view = { name, version };
  if (delivery !== AsyncResultDeliveryMode.SYNCHRONOUS) view.asyncResultDelivery = delivery;
  if (cancellation !== ModelGenerationCancellationMode.FENCE_ONLY) view.generationCancellation = cancellation;
  return Object.freeze(view);
}

export function modelAsyncResultDelivery(modelOrView) {
  if (modelOrView == null) return AsyncResultDeliveryMode.SYNCHRONOUS;
  return normalizeAsyncResultDelivery(
    modelOrView.asyncResultDelivery ?? null,
    "model asyncResultDelivery"
  );
}

export function modelGenerationCancellation(modelOrView) {
  if (modelOrView == null) return ModelGenerationCancellationMode.FENCE_ONLY;
  return normalizeGenerationCancellation(
    modelOrView.generationCancellation ?? null,
    "model generationCancellation"
  );
}
