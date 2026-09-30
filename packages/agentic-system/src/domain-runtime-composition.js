// Independent FE/BE composition: two separate domain hosts started and stopped with
// Promise.allSettled. There is no shared queue, lock, strategy switch, stage or ordered
// dispatcher, and neither host's failure gates the other.
function invariant(condition, message) { if (!condition) throw new TypeError(message); }

export function createFrontendBackendDomainRuntime({ backendHost, frontendHost }) {
  for (const [name, host] of Object.entries({ backendHost, frontendHost })) {
    invariant(host && typeof host.start === "function" && typeof host.stop === "function", `${name} requires start()/stop()`);
  }
  invariant(backendHost !== frontendHost, "Backend and Frontend require separate hosts");
  invariant(backendHost.owningDomain === "BACKEND", "backendHost must own BACKEND");
  invariant(frontendHost.owningDomain === "FRONTEND", "frontendHost must own FRONTEND");
  const hosts = Object.freeze({ BACKEND: backendHost, FRONTEND: frontendHost });
  const settle = async (method) => {
    const results = await Promise.allSettled(Object.values(hosts).map((host) => host[method]()));
    return Object.freeze(Object.fromEntries(Object.keys(hosts).map((domain, index) => [domain, Object.freeze({ status: results[index].status, ...(results[index].status === "rejected" ? { error: results[index].reason } : {}) })])));
  };
  return Object.freeze({ startAll: () => settle("start"), stopAll: () => settle("stop") });
}
