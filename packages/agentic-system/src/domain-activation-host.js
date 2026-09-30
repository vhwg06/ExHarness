import { activationKey } from "./domain-activation-source.js";
import { ActivationOutcome, ActivationReason } from "./domain-activation.js";

// A durable host may run activation, but it is never a source of truth or a scheduler:
// start() runs an immediate then periodic canonical scan, notify() accepts only a
// same-domain exact-key hint, and stop() cancels/drains only this host. There is no
// priority, next-role, next-domain or stage API.
function invariant(condition, message) { if (!condition) throw new TypeError(message); }
function requireText(value, name) { invariant(typeof value === "string" && value.trim(), `${name} must be a non-empty string`); return value; }
const defaultTimer = Object.freeze({ setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (handle) => clearInterval(handle) });

export function createDomainActivationHost({ owningDomain, discovery, activation, scanIntervalMs = 1000, timer = defaultTimer, onError = null }) {
  const domain = requireText(owningDomain, "host owningDomain");
  invariant(discovery && typeof discovery.scan === "function", "host requires activation source scan()");
  invariant(activation && typeof activation.reconcile === "function", "host requires domain activation reconcile()");
  invariant(activation.owningDomain === undefined || activation.owningDomain === domain, "host and activation owning domains differ");
  invariant(Number.isInteger(scanIntervalMs) && scanIntervalMs > 0, "scanIntervalMs must be a positive integer");
  invariant(timer && typeof timer.setInterval === "function" && typeof timer.clearInterval === "function", "timer requires setInterval/clearInterval");
  let handle = null;
  let started = false;
  let stopped = false;
  const pending = new Set();

  function track(promise) {
    pending.add(promise);
    promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  }

  async function scanOnce() {
    const keys = await discovery.scan({ owningDomain: domain });
    const settled = await Promise.allSettled(keys.map((key) => activation.reconcile(key)));
    return Object.freeze(settled.map((entry, index) => Object.freeze(entry.status === "fulfilled"
      ? { key: keys[index], status: "fulfilled", value: entry.value }
      : { key: keys[index], status: "rejected", error: entry.reason })));
  }

  function guardedScan() {
    if (stopped) return Promise.resolve(Object.freeze([]));
    return track(scanOnce().catch((error) => { if (onError) onError(error); return Object.freeze([]); }));
  }

  return Object.freeze({
    owningDomain: domain,
    async start() {
      if (started) return;
      started = true; stopped = false;
      handle = timer.setInterval(() => guardedScan(), scanIntervalMs);
      await guardedScan();
    },
    scanOnce: () => track(scanOnce()),
    async notify(hint) {
      const key = activationKey(hint);
      if (key.owningDomain !== domain) return Object.freeze({ state: ActivationOutcome.REJECTED, reason: ActivationReason.DOMAIN_MISMATCH, key });
      return track(activation.reconcile(key));
    },
    async stop() {
      stopped = true;
      if (handle != null) { timer.clearInterval(handle); handle = null; }
      started = false;
      await Promise.allSettled([...pending]);
    }
  });
}
