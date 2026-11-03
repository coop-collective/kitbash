import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ALIAS, NAME, TARGETS } from './config.mjs';
import { fail } from './errors.mjs';

export const UPLOAD_BYTES = 262144;
export const UPLOAD_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateUpload(input) {
  if (!object(input) || Object.keys(input).some(key => !['operation', 'project', 'target', 'names', 'uploadId', 'delivery', 'metadata'].includes(key)) ||
      typeof input.project !== 'string' || !ALIAS.test(input.project) || !TARGETS.includes(input.target) || !['begin', 'status'].includes(input.operation)) fail('invalid_request');
  if (input.operation === 'status') {
    if (typeof input.uploadId !== 'string' || !UPLOAD_ID.test(input.uploadId) || ['names', 'delivery', 'metadata'].some(key => key in input)) fail('invalid_request');
  } else if ('uploadId' in input || !Array.isArray(input.names) || input.names.length < 1 || input.names.length > 10 ||
      input.names.some(name => typeof name !== 'string' || !NAME.test(name)) || new Set(input.names).size !== input.names.length ||
      (input.delivery !== undefined && (typeof input.delivery !== 'string' || !ALIAS.test(input.delivery) || !object(input.metadata) || Object.keys(input.metadata).join(',') !== 'clientId' ||
        typeof input.metadata.clientId !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(input.metadata.clientId))) ||
      (input.delivery === undefined && input.metadata !== undefined)) fail('invalid_request');
  return input;
}

export function validateDeliveryQuery(input) {
  if (!object(input) || Object.keys(input).some(key => key !== 'integration') ||
      (input.integration !== undefined && (typeof input.integration !== 'string' || !ALIAS.test(input.integration)))) fail('invalid_request');
  return input;
}

/** The caller serializes this with registration, generation and delivery in the same project DO. */
export function createUploadFlow({ principal, project, target, epoch, rules, state, save, storage, prepare = async () => undefined, now = Date.now }) {
  const persist = save;
  save = async (next, prepared) => { await persist(next, prepared); state = next; };
  const base = { operation: 'upload', project, target };
  const output = row => ({ ...base, uploadId: row.id, status: row.phase === 'stored' ? 'stored' : row.phase === 'saving' ? 'pending' : row.expires <= now() ? 'expired' : 'awaiting-upload',
    names: row.names, ...(row.delivery ? { delivery: row.delivery } : {}) });
  const get = id => {
    if (!UPLOAD_ID.test(id ?? '') || !Object.hasOwn(state, id)) fail('forbidden');
    const row = state[id];
    if (row.names.some(name => rules[name]?.generate !== false)) fail('forbidden');
    return row;
  };
  async function reconcile(row) {
    if (row.phase === 'saving' && row.names.every(name => rules[name]?.generate === false)) {
      const present = await storage.listNames();
      if (row.names.every(name => present.has(name))) {
        row = { ...row, phase: 'stored' };
        await save({ ...state, [row.id]: row });
      }
    }
    return row;
  }
  return {
    async begin(input) {
      validateUpload(input);
      if (input.names.some(name => rules[name]?.generate !== false)) fail('forbidden');
      // Keep uncertain writes; an expired, unused ticket can safely be replaced.
      const retained = Object.fromEntries(Object.entries(state).filter(([, row]) => row.phase === 'saving' || row.phase === 'stored' || row.expires > now()));
      if (Object.keys(retained).length >= 100 || Object.values(retained).some(row => row.phase !== 'stored' && row.names.some(name => input.names.includes(name)))) fail('conflict');
      const present = await storage.listNames();
      if (input.names.some(name => present.has(name))) fail('conflict');
      const id = randomUUID(), capability = randomBytes(32).toString('base64url');
      const row = { id, phase: 'awaiting', names: [...input.names].sort(), capabilityHash: hash(capability), epoch, expires: now() + 15 * 60 * 1000,
        ...(input.delivery ? { delivery: input.delivery, metadata: input.metadata } : {}) };
      await save({ ...retained, [id]: row });
      return { ...output(row), expiresAt: new Date(row.expires).toISOString(),
        path: `/v1/uploads/${principal}/${project}/${target}/${id}/${capability}`, maxBytes: UPLOAD_BYTES };
    },
    async status(id) { return output(await reconcile(get(id))); },
    async submit(id, capability, body) {
      let row = get(id);
      if (row.epoch !== epoch || row.expires <= now() || !/^[A-Za-z0-9_-]{43}$/.test(capability ?? '') ||
          !timingSafeEqual(Buffer.from(hash(capability), 'hex'), Buffer.from(row.capabilityHash, 'hex'))) fail('forbidden');
      if (row.phase !== 'awaiting') return output(await reconcile(row));
      if (!object(body) || Object.keys(body).join(',') !== 'secrets' || !object(body.secrets) ||
          Object.keys(body.secrets).sort().join(',') !== row.names.join(',') ||
          Object.values(body.secrets).some(value => typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.byteLength(value) > 65536) ||
          Buffer.byteLength(JSON.stringify(body)) > UPLOAD_BYTES) fail('invalid_request');
      const present = await storage.listNames();
      if (row.names.some(name => present.has(name))) fail('conflict');
      const prepared = await prepare(row, body.secrets, present);
      row = { ...row, phase: 'saving' };
      // Save intent and any controller ciphertext together before the provider write. No plaintext or value hashes are saved.
      await save({ ...state, [id]: row }, prepared);
      try { await storage.createMany(row.names.map(name => ({ name, value: body.secrets[name] }))); }
      catch { return output(row); } // Ambiguous writes are reconciled by metadata, never uploaded again.
      return output(await reconcile(row));
    },
  };
}
