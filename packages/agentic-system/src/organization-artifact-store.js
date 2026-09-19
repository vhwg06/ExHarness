import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { promises as nodeFs } from "node:fs";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),`${name} must be a non-empty string`);return value;}
function clone(value){return structuredClone(value);}
function freeze(value){return Object.freeze(clone(value));}
function digest(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}

export function createJsonImmutableArtifactStore({path,fs=nodeFs}){
  requireText(path,"artifact store path");
  const lockPath=`${path}.lock`;
  async function loadUnlocked(){
    try{
      const raw=JSON.parse(await fs.readFile(path,"utf8"));
      invariant(raw?.version===1&&raw.artifacts&&typeof raw.artifacts==="object"&&!Array.isArray(raw.artifacts),"artifact store is invalid");
      return raw;
    }catch(error){if(error?.code==="ENOENT") return {version:1,artifacts:{}};throw error;}
  }
  async function saveUnlocked(state){
    await fs.mkdir(dirname(path),{recursive:true});
    const tmp=`${path}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp,`${JSON.stringify(state,null,2)}\n`,"utf8");
    await fs.rename(tmp,path);
  }
  async function withLock(action){
    await fs.mkdir(dirname(path),{recursive:true});
    let handle;
    try{handle=await fs.open(lockPath,"wx");}
    catch(error){if(error?.code==="EEXIST") throw new Error("artifact store mutation already in progress");throw error;}
    try{return await action();}finally{await handle.close();try{await fs.unlink(lockPath);}catch(error){if(error?.code!=="ENOENT") throw error;}}
  }
  return Object.freeze({
    async put(kind,value){
      const normalizedKind=requireText(kind,"artifact kind");
      invariant(value&&typeof value==="object"&&!Array.isArray(value),"artifact value must be an object");
      const artifact=clone(value);
      const ref=`${normalizedKind}:sha256:${digest(artifact)}`;
      await withLock(async()=>{
        const state=await loadUnlocked();
        const existing=state.artifacts[ref];
        if(existing!=null){invariant(JSON.stringify(existing)===JSON.stringify(artifact),`immutable artifact conflict: ${ref}`);return;}
        state.artifacts[ref]=artifact;
        await saveUnlocked(state);
      });
      return ref;
    },
    async resolve(ref){
      requireText(ref,"artifact ref");
      const state=await loadUnlocked();
      const artifact=state.artifacts[ref]??null;
      return artifact==null?null:freeze(artifact);
    }
  });
}

export function createOrganizationArtifactRegistry({store}){
  invariant(store&&typeof store.put==="function"&&typeof store.resolve==="function","artifact registry requires immutable artifact store");
  return Object.freeze({
    async putWorkContract(value){
      const artifact=structuredClone(value);
      delete artifact.contractRef;
      return store.put("organization-work-contract",artifact);
    },
    resolveWorkContract:(ref)=>store.resolve(ref),
    putMaterializationAuthorization:(value)=>store.put("materialization-authorization",value),
    resolveMaterializationAuthorization:(ref)=>store.resolve(ref),
    putExecutionAuthorityPolicy:(value)=>store.put("execution-authority-policy",value),
    resolveExecutionAuthorityPolicy:(ref)=>store.resolve(ref),
    putClaimReleaseReceipt:(value)=>store.put("claim-release-receipt",value),
    resolveClaimReleaseReceipt:(ref)=>store.resolve(ref),
    putClaimAuthorityInvalidation:(value)=>store.put("claim-authority-invalidation",value),
    resolveClaimAuthorityInvalidation:(ref)=>store.resolve(ref)
  });
}
