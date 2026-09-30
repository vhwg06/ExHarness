import { createHash } from "node:crypto";

// DomainExecutionInput is the immutable, content-addressed WHAT payload a WorkContract
// references through requiredArtifactRefs. It carries no principal, policy, strategy,
// runtime or obligation authority; those stay with claim/controller/lineage owners.
export const DOMAIN_EXECUTION_INPUT_KIND = "DOMAIN_EXECUTION_INPUT";
export const DOMAIN_EXECUTION_INPUT_REF_PREFIX = "domain-execution-input:sha256:";
const FORBIDDEN_FIELDS = new Set(["principal", "principalRef", "owner", "strategy", "strategyRef", "executionStrategy", "policy", "policyRef", "executionPolicy", "runtime", "runtimeRef", "adapterRef", "nextRole", "nextDomain", "priority", "stage", "obligation", "obligationRef", "crossDomainObligationRef"]);

function invariant(condition, message) { if (!condition) throw new TypeError(message); }
function requireText(value, name) { invariant(typeof value === "string" && value.trim(), `${name} must be a non-empty string`); return value; }
function jsonSafe(value, label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { invariant(Number.isFinite(value), `${label} must be JSON-safe`); return; }
  invariant(typeof value === "object", `${label} must be JSON-safe`);
  if (Array.isArray(value)) { value.forEach((entry, i) => jsonSafe(entry, `${label}[${i}]`)); return; }
  invariant(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, `${label} must be JSON-safe`);
  for (const [key, entry] of Object.entries(value)) { invariant(entry !== undefined, `${label}.${key} must be JSON-safe`); jsonSafe(entry, `${label}.${key}`); }
}
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

function inputBody(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "DomainExecutionInput must be an object");
  for (const key of Object.keys(raw)) {
    invariant(!FORBIDDEN_FIELDS.has(key), `DomainExecutionInput field ${key} is authority/HOW, not execution input`);
    invariant(["kind", "version", "projectId", "owningDomain", "workloadType", "objective", "inputRef"].includes(key), `DomainExecutionInput field ${key} is not supported`);
  }
  if (raw.kind != null) invariant(raw.kind === DOMAIN_EXECUTION_INPUT_KIND, "DomainExecutionInput kind mismatch");
  if (raw.version != null) invariant(raw.version === 1, "DomainExecutionInput version mismatch");
  invariant(raw.objective && typeof raw.objective === "object" && !Array.isArray(raw.objective), "DomainExecutionInput.objective must be an object");
  jsonSafe(raw.objective, "DomainExecutionInput.objective");
  return {
    kind: DOMAIN_EXECUTION_INPUT_KIND,
    version: 1,
    projectId: requireText(raw.projectId, "DomainExecutionInput.projectId"),
    owningDomain: requireText(raw.owningDomain, "DomainExecutionInput.owningDomain"),
    workloadType: requireText(raw.workloadType, "DomainExecutionInput.workloadType"),
    objective: structuredClone(raw.objective)
  };
}

export function domainExecutionInputRef(raw) { return DOMAIN_EXECUTION_INPUT_REF_PREFIX + digest(inputBody(raw)); }

export function createDomainExecutionInput(raw) {
  const body = inputBody(raw);
  const inputRef = DOMAIN_EXECUTION_INPUT_REF_PREFIX + digest(body);
  if (raw.inputRef != null) invariant(raw.inputRef === inputRef, "DomainExecutionInput inputRef mismatch");
  return freeze({ ...body, inputRef });
}

export const isDomainExecutionInputRef = (ref) => typeof ref === "string" && ref.startsWith(DOMAIN_EXECUTION_INPUT_REF_PREFIX);

// Registry wiring used by the organization artifact registry: content-addressed put/resolve.
export function createDomainExecutionInputRegistry({ store }) {
  invariant(store && typeof store.put === "function" && typeof store.resolve === "function", "DomainExecutionInput registry requires immutable artifact store");
  return Object.freeze({
    async putDomainExecutionInput(raw) {
      const input = createDomainExecutionInput(raw);
      const { inputRef, ...body } = input;
      const ref = await store.put("domain-execution-input", structuredClone(body));
      invariant(ref === inputRef, "persisted DomainExecutionInput ref mismatch");
      return ref;
    },
    async resolveDomainExecutionInput(ref) {
      invariant(isDomainExecutionInputRef(ref), "DomainExecutionInput ref must be content addressed");
      const raw = await store.resolve(ref);
      if (raw == null) return null;
      const input = createDomainExecutionInput(raw);
      invariant(input.inputRef === ref, "DomainExecutionInput content does not match its ref");
      return input;
    }
  });
}

// Execution requires exactly one DomainExecutionInput among the WorkContract's
// requiredArtifactRefs, matching its project, owning domain and workload type.
// Zero, multiple, missing or mismatched inputs fail before any runtime dispatch.
export async function resolveContractExecutionInput({ contract, resolveDomainExecutionInput }) {
  invariant(contract && typeof contract === "object", "WorkContract is required");
  invariant(typeof resolveDomainExecutionInput === "function", "resolveDomainExecutionInput is required");
  const refs = (contract.requiredArtifactRefs ?? []).filter(isDomainExecutionInputRef);
  invariant(refs.length === 1, `WorkContract must reference exactly one DomainExecutionInput (found ${refs.length})`);
  const input = await resolveDomainExecutionInput(refs[0]);
  invariant(input, `DomainExecutionInput is unavailable: ${refs[0]}`);
  invariant(input.projectId === contract.projectId, "DomainExecutionInput project mismatch");
  invariant(input.owningDomain === contract.owningDomain, "DomainExecutionInput owning domain mismatch");
  invariant(input.workloadType === contract.workloadType, "DomainExecutionInput workload type mismatch");
  return freeze({ ref: refs[0], input });
}
