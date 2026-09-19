function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}
function text(value, name) {
  invariant(typeof value === "string" && value.trim(), `${name} must be a non-empty string`);
  return value;
}
function freeze(value) { return Object.freeze(structuredClone(value)); }

export function defineOrganizationWorkContract(raw) {
  invariant(raw && typeof raw === "object" && !Array.isArray(raw), "OrganizationWorkContract must be an object");
  const obligationKeys = raw.obligationKeys ?? [];
  invariant(Array.isArray(obligationKeys) && obligationKeys.length > 0, "OrganizationWorkContract.obligationKeys must be non-empty");
  invariant(new Set(obligationKeys).size === obligationKeys.length, "OrganizationWorkContract.obligationKeys must be unique");
  return freeze({
    id: text(raw.id, "OrganizationWorkContract.id"),
    owningDomain: text(raw.owningDomain, "OrganizationWorkContract.owningDomain"),
    workloadType: text(raw.workloadType, "OrganizationWorkContract.workloadType"),
    obligationKeys: obligationKeys.map((x,i)=>text(x,`OrganizationWorkContract.obligationKeys[${i}]`)),
    inputRefs: (raw.inputRefs ?? []).map((x,i)=>text(x,`OrganizationWorkContract.inputRefs[${i}]`)),
    expectedOutputRefs: (raw.expectedOutputRefs ?? []).map((x,i)=>text(x,`OrganizationWorkContract.expectedOutputRefs[${i}]`))
  });
}

export function createOrganizationWorkClaimController({ authorizationStore, claimReleaseStore }) {
  invariant(authorizationStore && typeof authorizationStore.current === "function", "authorizationStore.current is required");
  invariant(claimReleaseStore && typeof claimReleaseStore.current === "function" && typeof claimReleaseStore.compareAndSwap === "function", "claimReleaseStore current/CAS required");

  return Object.freeze({
    async claim({ contract: raw, principal, expectedReleaseHead }) {
      const contract=defineOrganizationWorkContract(raw);
      const identity=text(principal?.identity, "principal.identity");
      const auth=await authorizationStore.current(identity);
      invariant(auth && Array.isArray(auth.authorizedDomains), "principal authorization is unavailable");
      invariant(auth.authorizedDomains.includes(contract.owningDomain), `principal ${identity} is not authorized for domain ${contract.owningDomain}`);

      const current=await claimReleaseStore.current(contract.id);
      invariant(current?.token === expectedReleaseHead, "claim release head changed");
      invariant(current.state !== "FENCED", "claim release head is fenced");
      const generation=(current.generation ?? 0)+1;
      const next={token:`${contract.id}:g${generation}`,generation,state:"CLAIMED",principal:identity,contractId:contract.id};
      const committed=await claimReleaseStore.compareAndSwap(contract.id,current.token,next);
      invariant(committed === true, "claim release CAS conflict");
      return freeze({...next,contract});
    }
  });
}

export function materializeAuthorizedObligations({ decision, requested }) {
  invariant(decision && Array.isArray(decision.obligationKeys), "accepted decision obligationKeys are required");
  invariant(Array.isArray(requested), "requested obligations must be an array");
  const allowed=new Set(decision.obligationKeys);
  for(const key of requested) invariant(allowed.has(key), `obligation outside accepted scope: ${key}`);
  return freeze(requested);
}
