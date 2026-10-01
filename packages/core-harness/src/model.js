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

export function defineModelAdapter({ name = "model", version = null, generate, asyncResultDelivery = null }) {
  invariant(typeof generate === "function", "model adapter requires generate()");
  return Object.freeze({
    name: requireText(name, "model.name"),
    version: version == null ? null : requireText(version, "model.version"),
    asyncResultDelivery: normalizeAsyncResultDelivery(asyncResultDelivery),
    generate
  });
}

// The serialized view stays byte-compatible with the pre-existing
// { name, version } shape whenever the adapter uses the default synchronous
// delivery: existing synchronous adapters preserve current behavior exactly,
// including route/usage/history bytes. A declared native/handle capability is
// carried explicitly; missing metadata always queries as SYNCHRONOUS.
export function modelAdapterView(model) {
  const name = model.name;
  const version = model.version;
  const delivery = normalizeAsyncResultDelivery(
    model.asyncResultDelivery ?? null,
    "model view asyncResultDelivery"
  );
  if (delivery === AsyncResultDeliveryMode.SYNCHRONOUS) {
    return Object.freeze({ name, version });
  }
  return Object.freeze({ name, version, asyncResultDelivery: delivery });
}

export function modelAsyncResultDelivery(modelOrView) {
  if (modelOrView == null) return AsyncResultDeliveryMode.SYNCHRONOUS;
  return normalizeAsyncResultDelivery(
    modelOrView.asyncResultDelivery ?? null,
    "model asyncResultDelivery"
  );
}
