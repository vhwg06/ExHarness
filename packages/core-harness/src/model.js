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

export function modelAdapterView(model) {
  return Object.freeze({
    name: model.name,
    version: model.version,
    asyncResultDelivery: normalizeAsyncResultDelivery(model.asyncResultDelivery ?? null, "model view asyncResultDelivery")
  });
}
