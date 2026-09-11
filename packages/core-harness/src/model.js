import { invariant, requireText } from "./contracts.js";

export function defineModelAdapter({ name = "model", version = null, generate }) {
  invariant(typeof generate === "function", "model adapter requires generate()");
  return Object.freeze({
    name: requireText(name, "model.name"),
    version: version == null ? null : requireText(version, "model.version"),
    generate
  });
}

export function modelAdapterView(model) {
  return Object.freeze({
    name: model.name,
    version: model.version
  });
}
