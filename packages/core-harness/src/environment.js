import { createHash } from "node:crypto";
import { candidateKey, invariant, requireText } from "./contracts.js";

function stableValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "environment action must contain finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(stableValue);

  invariant(value && typeof value === "object", "environment action must be structured serializable data");
  const prototype = Object.getPrototypeOf(value);
  invariant(
    prototype === Object.prototype || prototype === null,
    "environment action objects must be plain objects"
  );

  const output = {};
  for (const key of Object.keys(value).sort()) {
    invariant(value[key] !== undefined, "environment action must not contain undefined values");
    output[key] = stableValue(value[key]);
  }
  return output;
}

export function environmentActionKey({ sessionId, candidate, action }) {
  const canonical = JSON.stringify({
    sessionId: requireText(sessionId, "environment action sessionId"),
    candidate: candidateKey(candidate),
    action: stableValue(action)
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function createIdempotentEnvironment(environment) {
  invariant(environment && typeof environment.observe === "function", "environment requires observe()");
  invariant(environment && typeof environment.act === "function", "environment requires act()");

  return Object.freeze({
    observe(input) {
      return environment.observe(input);
    },

    act(input) {
      const actionKey = environmentActionKey(input);
      return environment.act(Object.freeze({
        ...input,
        actionKey
      }));
    }
  });
}
