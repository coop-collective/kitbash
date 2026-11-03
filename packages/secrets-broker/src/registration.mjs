import { createHash } from 'node:crypto';
import { ALIAS, NAME, RESERVED, TARGETS, authenticate, validateConfig } from './config.mjs';
import { fail } from './errors.mjs';

export const REGISTERED_OPERATIONS = ['setup', 'status', 'presence', 'generate'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateRegistration(input) {
  if (!object(input) || Object.keys(input).some(key => !['project', 'target', 'secrets'].includes(key)) ||
      typeof input.project !== 'string' || !ALIAS.test(input.project) || !TARGETS.includes(input.target) ||
      !Array.isArray(input.secrets) || input.secrets.length > 100) fail('invalid_request');
  const names = new Set();
  for (const secret of input.secrets) {
    if (!object(secret) || Object.keys(secret).some(key => !['name', 'generate', 'bytes', 'required'].includes(key)) ||
        typeof secret.name !== 'string' || !NAME.test(secret.name) || RESERVED.test(secret.name) || names.has(secret.name) ||
        typeof secret.generate !== 'boolean' || (secret.bytes !== undefined && (!secret.generate || ![32, 48, 64].includes(secret.bytes))) ||
        (secret.required !== undefined && typeof secret.required !== 'boolean')) fail('invalid_request');
    names.add(secret.name);
  }
  return input;
}

export function registrationAuthority(config, bearer, input) {
  const principal = authenticate(config, bearer);
  if (Object.hasOwn(config.projects, input.project) || !principal.registration?.targets.includes(input.target)) fail('forbidden');
  return principal;
}

export const registrationObjectName = (principal, input) => `registered:${principal.id}:${input.project}:${input.target}`;

function destination(principal, input) {
  const { accountId, storeId, secretPrefix } = principal.registration;
  // Fixed-length, collision-resistant names keep different projects and targets disjoint.
  const suffix = createHash('sha256').update(`${principal.id}:${input.project}:${input.target}`).digest('hex').toUpperCase();
  // 32 hex characters (128 bits) leave room for the operator's namespace prefix.
  return { accountId, storeId, secretPrefix: `${secretPrefix}${suffix.slice(0, 32)}_` };
}

export function checkRecord(record, principal, input) {
  if (record.version !== 1 || record.principal !== principal.id || record.project !== input.project || record.target !== input.target ||
      Object.entries(destination(principal, input)).some(([key, value]) => record[key] !== value)) fail('conflict');
}

/** Add metadata only. Existing generation rules cannot be changed through registration. */
export function registerSecrets(config, bearer, input, existing) {
  validateRegistration(input);
  const principal = registrationAuthority(config, bearer, input);
  if (existing) checkRecord(existing, principal, input);
  const record = existing ? structuredClone(existing) : {
    version: 1, principal: principal.id, project: input.project, target: input.target,
    ...destination(principal, input), secrets: {},
  };
  const added = [];
  for (const secret of input.secrets) {
    const rule = { generate: secret.generate, required: secret.required ?? true,
      ...(secret.generate ? { bytes: secret.bytes ?? 32 } : {}), rotation: secret.generate ? 'migration-required' : 'provider' };
    if (Object.hasOwn(record.secrets, secret.name)) {
      if (JSON.stringify(record.secrets[secret.name]) !== JSON.stringify(rule)) fail('conflict');
    } else { record.secrets[secret.name] = rule; added.push(secret.name); }
  }
  if (Object.keys(record.secrets).length > 100) fail('invalid_request');
  registeredConfig(config, bearer, input, record);
  return { record, output: {
    operation: 'register', project: input.project, target: input.target, status: !existing || added.length ? 'registered' : 'already-registered',
    secrets: Object.keys(record.secrets).map(name => ({ name, status: added.includes(name) ? 'registered' : 'already-registered' })),
    // These are public binding identifiers, never values. Registration does not deploy an app Worker.
    bindings: Object.keys(record.secrets).map(name => ({ binding: name, store_id: record.storeId, secret_name: record.secretPrefix + name })),
  } };
}

export function registeredConfig(config, bearer, input, record) {
  const principal = registrationAuthority(config, bearer, input);
  if (!record) fail('forbidden');
  checkRecord(record, principal, input);
  return validateConfig({ version: 1, projects: {
    [input.project]: { backend: 'cloudflare-secrets-store', accountId: record.accountId, storeId: record.storeId,
      secrets: record.secrets, targets: { [input.target]: { secretPrefix: record.secretPrefix } } },
  }, principals: [{ id: principal.id, tokenSha256: principal.tokenSha256,
    grants: [{ project: input.project, targets: [input.target], operations: REGISTERED_OPERATIONS }] }] });
}
