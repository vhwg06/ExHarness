import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { promises as nodeFs } from "node:fs";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),`${name} must be a non-empty string`);return value;}
function clone(value){return structuredClone(value);}
function freeze(value){return Object.freeze(clone(value));}
function revisionFor(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function artifactRef(kind,value){return `${kind}:sha256:${revisionFor(value)}`;}

async function atomicWrite(fs,path,value){
  await fs.mkdir(dirname(path),{recursive:true});
  const tmp=`${path}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp,`${JSON.stringify(value,null,2)}\n`,"utf8");
  await fs.rename(tmp,path);
}

export function createJsonImmutableArtifactStore({path,fs=nodeFs}){
  requireText(path,"immutable artifact store path");
  const lockPath=`${path}.lock`;
  async function load(){
    try{
      const raw=JSON.parse(await fs.readFile(path,"utf8"));
      invariant(raw?.version===1&&raw.artifacts&&typeof raw.artifacts==="object"&&!Array.isArray(raw.artifacts),"immutable artifact store is invalid");
      return raw;
    }catch(error){
      if(error?.code==="ENOENT") return {version:1,artifacts:{}};
      throw error;
    }
  }
  async function withLock(action){
    await fs.mkdir(dirname(path),{recursive:true});
    let handle;
    try{handle=await fs.open(lockPath,"wx");}
    catch(error){if(error?.code==="EEXIST") throw new Error("immutable artifact store mutation already in progress");throw error;}
    try{return await action();}finally{
      await handle.close();
      try{await fs.unlink(lockPath);}catch(error){if(error?.code!=="ENOENT") throw error;}
    }
  }
  return Object.freeze({
    async put(kind,value){
      requireText(kind,"artifact kind");
      invariant(value&&typeof value==="object"&&!Array.isArray(value),"artifact value must be an object");
      const normalized=clone(value);
      const ref=artifactRef(kind,normalized);
      await withLock(async()=>{
        const state=await load();
        const existing=state.artifacts[ref];
        if(existing!=null){
          invariant(JSON.stringify(existing)===JSON.stringify(normalized),`immutable artifact conflict: ${ref}`);
          return;
        }
        state.artifacts[ref]=normalized;
        await atomicWrite(fs,path,state);
      });
      return ref;
    },
    async get(ref){
      requireText(ref,"artifact ref");
      const state=await load();
      const value=state.artifacts[ref];
      invariant(value!=null,`immutable artifact not found: ${ref}`);
      return freeze(value);
    }
  });
}

export function createJsonCasHeadStore({path,fs=nodeFs}){
  requireText(path,"CAS head store path");
  const lockPath=`${path}.lock`;
  async function loadUnlocked(){
    try{
      const raw=JSON.parse(await fs.readFile(path,"utf8"));
      invariant(raw?.version===1&&raw.heads&&typeof raw.heads==="object"&&!Array.isArray(raw.heads),"CAS head store is invalid");
      return raw;
    }catch(error){
      if(error?.code==="ENOENT") return {version:1,heads:{}};
      throw error;
    }
  }
  async function withLock(action){
    await fs.mkdir(dirname(path),{recursive:true});
    let handle;
    try{handle=await fs.open(lockPath,"wx");}
    catch(error){if(error?.code==="EEXIST") throw new Error("CAS head store mutation already in progress"); throw error;}
    try{return await action();}
    finally{
      await handle.close();
      try{await fs.unlink(lockPath);}catch(error){if(error?.code!=="ENOENT") throw error;}
    }
  }
  return Object.freeze({
    async current(key){
      requireText(key,"head key");
      const state=await loadUnlocked();
      const entry=state.heads[key]??null;
      return entry==null?null:freeze(entry);
    },
    async compareAndSwap(key,expectedRevision,nextValue){
      requireText(key,"head key");
      invariant(expectedRevision==null||typeof expectedRevision==="string","expectedRevision must be null or string");
      invariant(nextValue&&typeof nextValue==="object"&&!Array.isArray(nextValue),"nextValue must be an object");
      return withLock(async()=>{
        const state=await loadUnlocked();
        const current=state.heads[key]??null;
        if((current?.revision??null)!==expectedRevision) return false;
        const value=clone(nextValue);
        state.heads[key]={revision:revisionFor(value),value};
        await atomicWrite(fs,path,state);
        return true;
      });
    }
  });
}

export const AuthorityHeadStatus=Object.freeze({ACTIVE:"ACTIVE",REVOKED:"REVOKED"});
export const ClaimReleaseStatus=Object.freeze({RELEASED:"RELEASED",FENCED:"FENCED"});

function createAuthorityPublisher({headStore,artifactStore,authority,kind,verifyMethod,idField}){
  invariant(authority&&typeof authority[verifyMethod]==="function",`authority must implement ${verifyMethod}`);
  return Object.freeze({
    async publish({publisher,artifact,expectedRevision=null}){
      const id=requireText(artifact?.[idField],idField);
      const verified=await authority[verifyMethod]({publisher,artifact:freeze(artifact)});
      invariant(verified===true,`${kind} publisher is not trusted`);
      const ref=await artifactStore.put(kind,artifact);
      const next={...clone(artifact),artifactRef:ref};
      const ok=await headStore.compareAndSwap(id,expectedRevision,next);
      invariant(ok,`${kind} head CAS conflict`);
      return freeze((await headStore.current(id)));
    }
  });
}

export function createOrganizationAuthorityPublishers({
  materializationAuthorizationStore,
  executionAuthorityPolicyStore,
  artifactStore,
  organizationAuthority
}){
  invariant(artifactStore&&typeof artifactStore.put==="function"&&typeof artifactStore.get==="function","artifactStore is required");
  return Object.freeze({
    materialization:createAuthorityPublisher({
      headStore:materializationAuthorizationStore,artifactStore,authority:organizationAuthority,
      kind:"materialization-authorization",verifyMethod:"verifyMaterializationAuthorizationIssuer",idField:"authorizationId"
    }),
    execution:createAuthorityPublisher({
      headStore:executionAuthorityPolicyStore,artifactStore,authority:organizationAuthority,
      kind:"execution-authority-policy",verifyMethod:"verifyExecutionAuthorityPolicyPublisher",idField:"policyId"
    })
  });
}

export function createJsonMaterializationAuthorizationStore(options){return createJsonCasHeadStore(options);}
export function createJsonExecutionAuthorityPolicyStore(options){return createJsonCasHeadStore(options);}
export function createJsonClaimReleaseStore(options){return createJsonCasHeadStore(options);}
