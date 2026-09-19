import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { promises as nodeFs } from "node:fs";

function invariant(condition,message){if(!condition) throw new TypeError(message);}
function requireText(value,name){invariant(typeof value==="string"&&value.trim(),`${name} must be a non-empty string`);return value;}
function clone(value){return structuredClone(value);}
function freeze(value){return Object.freeze(clone(value));}
function revisionFor(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}

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
        await saveUnlocked(state);
        return true;
      });
    }
  });
}

export const AuthorityHeadStatus=Object.freeze({ACTIVE:"ACTIVE",REVOKED:"REVOKED"});
export const ClaimReleaseStatus=Object.freeze({RELEASED:"RELEASED",FENCED:"FENCED"});

export function createJsonMaterializationAuthorizationStore(options){return createJsonCasHeadStore(options);}
export function createJsonExecutionAuthorityPolicyStore(options){return createJsonCasHeadStore(options);}
export function createJsonClaimReleaseStore(options){return createJsonCasHeadStore(options);}
