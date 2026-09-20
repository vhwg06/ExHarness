import fs from "node:fs";
import crypto from "node:crypto";
import { assertWorkContext, requiredRefs } from "./blackboard-context-contract.mjs";

export function resolveContext(spec, { root = "." } = {}) {
  assertWorkContext(spec);
  const resolved = requiredRefs(spec).map(ref => {
    const path = `${root}/${ref}`;
    if (!fs.existsSync(path)) throw new Error(`CONTEXT_REF_MISSING: ${ref}`);
    const body = fs.readFileSync(path);
    return { ref, sha256: crypto.createHash("sha256").update(body).digest("hex"), bytes: body.length };
  });
  return { itemId: spec.itemId, action: spec.action.kind, resolved };
}
