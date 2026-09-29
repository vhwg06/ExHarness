import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { defineContextResolution } from './context-contract.js';
import { defineContextResolutionReceipt } from './resolution-durability.js';

const fail = (m) => { throw new TypeError(m); };
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
function hash(v) { return createHash('sha256').update(canonical(v)).digest('hex'); }

export class ResolutionStoreError extends Error {
  constructor({ reason, detail }) {
    if (!['CONFLICT', 'CORRUPT', 'MISSING'].includes(reason)) fail('store reason invalid');
    if (typeof detail !== 'string' || !detail.trim()) fail('store detail required');
    super(detail);
    this.name = 'ResolutionStoreError';
    this.reason = reason;
  }
}

function fileDigestFor(kind, value) {
  if (kind === 'resolution') return hash(defineContextResolution(value, value.__requirement ?? value.requirement ?? {}));
  return hash(value);
}

export function createResolutionStore({ path: root, fs: injected = null } = {}) {
  if (typeof root !== 'string' || !root.trim()) fail('store path required');
  const f = injected ?? fs;
  const join = (...parts) => path.join(root, ...parts);
  const resolutionName = (digest) => `resolution-${digest}.json`;
  const receiptName = (digest) => `receipt-${digest}.json`;

  async function writeImmutable(filename, value, expectedDigest) {
    await f.mkdir(root, { recursive: true });
    await f.mkdir(join('reuse'), { recursive: true });
    const body = `${canonical(value)}\n`;
    const finalPath = join(filename);
    try {
      const existing = await f.readFile(finalPath, 'utf8');
      const existingValue = JSON.parse(existing);
      if (hash(existingValue) !== expectedDigest && !(existingValue.receiptId === expectedDigest)) throw new ResolutionStoreError({ reason: 'CORRUPT', detail: `digest/content mismatch: ${filename}` });
      return { digest: expectedDigest, ref: filename };
    } catch (e) {
      if (e?.code !== 'ENOENT' && e?.name !== 'ResolutionStoreError' && !(e instanceof SyntaxError)) throw e;
      if (e?.name === 'ResolutionStoreError') throw e;
      if (e instanceof SyntaxError) throw new ResolutionStoreError({ reason: 'CORRUPT', detail: `invalid JSON: ${filename}` });
    }
    const tmp = join(`.${filename}.${randomUUID()}.tmp`);
    const handle = await f.open(tmp, 'wx');
    try {
      await handle.writeFile(body);
      await handle.sync();
      await handle.close();
    } catch (e) {
      try { await handle.close(); } catch {}
      try { await f.unlink(tmp); } catch {}
      throw e;
    }
    try {
      await f.link(tmp, finalPath);
    } catch (e) {
      if (e?.code === 'EEXIST') {
        const existing = JSON.parse(await f.readFile(finalPath, 'utf8'));
        if (hash(existing) === expectedDigest || existing.receiptId === expectedDigest) return { digest: expectedDigest, ref: filename };
        throw new ResolutionStoreError({ reason: 'CORRUPT', detail: `concurrent digest/content mismatch: ${filename}` });
      } else throw e;
    } finally {
      try { await f.unlink(tmp); } catch {}
    }
    return { digest: expectedDigest, ref: filename };
  }

  async function readImmutable(filename, kind, expectedDigest) {
    const m = filename.match(/^(resolution|receipt)-([a-f0-9]{64})\.json$/);
    if (!m || m[1] !== kind) throw new ResolutionStoreError({ reason: 'MISSING', detail: `unknown ${kind} ref: ${filename}` });
    if (m[2] !== expectedDigest) throw new ResolutionStoreError({ reason: 'MISSING', detail: `unknown ${kind} ref: ${filename}` });
    let body;
    try { body = await f.readFile(join(filename), 'utf8'); }
    catch (e) { if (e?.code === 'ENOENT') throw new ResolutionStoreError({ reason: 'MISSING', detail: `${kind} missing: ${filename}` }); throw e; }
    let value;
    try { value = JSON.parse(body); }
    catch { throw new ResolutionStoreError({ reason: 'CORRUPT', detail: `${kind} invalid JSON: ${filename}` }); }
    if (kind === 'receipt') {
      const parsed = defineContextResolutionReceipt(value);
      if (parsed.receiptId !== expectedDigest) throw new ResolutionStoreError({ reason: 'CORRUPT', detail: `${kind} digest mismatch: ${filename}` });
      return parsed;
    }
    if (hash(value) !== expectedDigest) throw new ResolutionStoreError({ reason: 'CORRUPT', detail: `${kind} digest mismatch: ${filename}` });
    return value;
  }

  async function putResolution(resolution) {
    const digest = hash(resolution);
    await writeImmutable(resolutionName(digest), resolution, digest);
    void fileDigestFor;
    return `resolution://${digest}`;
  }

  async function putReceipt(receipt) {
    const parsed = defineContextResolutionReceipt(receipt);
    await writeImmutable(receiptName(parsed.receiptId), parsed, parsed.receiptId);
    return `receipt://${parsed.receiptId}`;
  }

  function slotPath(reuseKey) {
    if (!/^[a-f0-9]{64}$/.test(reuseKey)) fail('reuseKey must be sha256 hex');
    return join('reuse', `${reuseKey}.json`);
  }

  async function publishReuseSlot(reuseKey, resolutionId, receiptRef) {
    if (!/^[a-f0-9]{64}$/.test(reuseKey)) fail('reuseKey must be sha256 hex');
    if (typeof resolutionId !== 'string' || !resolutionId.trim()) fail('resolutionId required');
    if (typeof receiptRef !== 'string' || !receiptRef.trim()) fail('receiptRef required');
    const value = { reuseKey, resolutionId, receiptRef };
    const body = `${canonical(value)}\n`;
    const finalPath = slotPath(reuseKey);
    try {
      const existing = JSON.parse(await f.readFile(finalPath, 'utf8'));
      if (existing.reuseKey !== reuseKey) throw new ResolutionStoreError({ reason: 'CORRUPT', detail: 'reuse slot key mismatch' });
      if (existing.resolutionId === resolutionId && existing.receiptRef === receiptRef) return { reused: true, ...existing };
      throw new ResolutionStoreError({ reason: 'CONFLICT', detail: `NONDETERMINISTIC_RESOLUTION_CONFLICT for ${reuseKey}` });
    } catch (e) {
      if (e?.name === 'ResolutionStoreError') throw e;
      if (e?.code !== 'ENOENT') throw e;
    }
    const tmp = `${finalPath}.${randomUUID()}.tmp`;
    const handle = await f.open(tmp, 'wx');
    try {
      await handle.writeFile(body);
      await handle.sync();
      await handle.close();
    } catch (e) {
      try { await handle.close(); } catch {}
      try { await f.unlink(tmp); } catch {}
      throw e;
    }
    try {
      await f.link(tmp, finalPath);
    } catch (e) {
      if (e?.code === 'EEXIST') {
        const existing = JSON.parse(await f.readFile(finalPath, 'utf8'));
        if (existing.resolutionId === resolutionId && existing.receiptRef === receiptRef) return { reused: true, ...existing };
        throw new ResolutionStoreError({ reason: 'CONFLICT', detail: `NONDETERMINISTIC_RESOLUTION_CONFLICT for ${reuseKey}` });
      }
      throw e;
    } finally {
      try { await f.unlink(tmp); } catch {}
    }
    return { reused: false, ...value };
  }

  async function readReuseSlot(reuseKey) {
    try {
      const raw = await f.readFile(slotPath(reuseKey), 'utf8');
      const v = JSON.parse(raw);
      if (v.reuseKey !== reuseKey || typeof v.resolutionId !== 'string' || typeof v.receiptRef !== 'string') throw new ResolutionStoreError({ reason: 'CORRUPT', detail: `corrupted reuse slot: ${reuseKey}` });
      return v;
    } catch (e) {
      if (e?.code === 'ENOENT') return null;
      if (e?.name === 'ResolutionStoreError') throw e;
      throw new ResolutionStoreError({ reason: 'CORRUPT', detail: `corrupted reuse slot: ${reuseKey}` });
    }
  }

  async function readResolution(ref) {
    const m = String(ref).match(/^resolution:\/\/([a-f0-9]{64})$/);
    if (!m) throw new ResolutionStoreError({ reason: 'MISSING', detail: `unknown resolution ref: ${ref}` });
    return readImmutable(resolutionName(m[1]), 'resolution', m[1]);
  }

  async function readReceipt(ref) {
    const m = String(ref).match(/^receipt:\/\/([a-f0-9]{64})$/);
    if (!m) throw new ResolutionStoreError({ reason: 'MISSING', detail: `unknown receipt ref: ${ref}` });
    return readImmutable(receiptName(m[1]), 'receipt', m[1]);
  }

  return Object.freeze({ putResolution, putReceipt, publishReuseSlot, readReuseSlot, readResolution, readReceipt });
}
