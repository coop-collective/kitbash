import { createHash, timingSafeEqual } from 'node:crypto';
import { fail } from './errors.mjs';

export const OPERATIONS = ['setup', 'status', 'generate', 'provision-github', 'provision-worker-sync'];
export const TARGETS = ['local', 'staging', 'production'];
export const ALIAS = /^[a-z][a-z0-9-]{0,62}$/;
export const NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const RESERVED = /^(?:INFISICAL_|CLOUDFLARE_|GITHUB_|ACTIONS_|KIT_|NODE_OPTIONS$|PATH$|HOME$)/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const pathPattern = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;

export function httpsOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_request'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('invalid_request');
  return url.origin;
}

/** Only an operator-controlled file configures destinations, credentials, and grants. */
export function validateConfig(config) {
  if (config?.version !== 1 || !object(config.projects) || !Array.isArray(config.principals) || !config.principals.length) fail('invalid_request');
  for (const [alias, project] of Object.entries(config.projects)) {
    if (!ALIAS.test(alias) || !object(project) || !UUID.test(project.projectId) || !ALIAS.test(project.projectSlug) || !object(project.targets) || !object(project.secrets)) fail('invalid_request');
    httpsOrigin(project.domain);
    for (const [name, policy] of Object.entries(project.secrets)) {
      if (!NAME.test(name) || RESERVED.test(name) || !object(policy) || typeof policy.generate !== 'boolean' ||
          (policy.bytes !== undefined && ![32, 48, 64].includes(policy.bytes)) || (policy.required !== undefined && typeof policy.required !== 'boolean') ||
          !['manual', 'migration-required', 'provider'].includes(policy.rotation) || (policy.generate && policy.rotation === 'provider')) fail('invalid_request');
    }
    for (const [target, scope] of Object.entries(project.targets)) {
      if (!TARGETS.includes(target) || !object(scope) || !ALIAS.test(scope.environment) || !pathPattern.test(scope.secretPath) || scope.secretPath === '/') fail('invalid_request');
      if (target === 'local' && (scope.github || scope.cloudflare)) fail('invalid_request');
    }
  }
  const digests = new Set();
  for (const principal of config.principals) {
    if (!ALIAS.test(principal.id) || !/^[a-f0-9]{64}$/.test(principal.tokenSha256) || digests.has(principal.tokenSha256) || !Array.isArray(principal.grants) || !principal.grants.length) fail('invalid_request');
    digests.add(principal.tokenSha256);
    for (const grant of principal.grants) {
      const project = config.projects[grant.project];
      if (!Object.hasOwn(config.projects, grant.project) || !Array.isArray(grant.targets) || !grant.targets.length ||
          grant.targets.some(target => !Object.hasOwn(project.targets, target)) || !Array.isArray(grant.operations) || !grant.operations.length ||
          grant.operations.some(operation => !OPERATIONS.includes(operation))) fail('invalid_request');
    }
  }
  return config;
}

export function validateOperation(input) {
  if (!object(input) || Object.keys(input).some(key => !['operation', 'project', 'target', 'name'].includes(key)) ||
      !OPERATIONS.includes(input.operation) || !ALIAS.test(input.project) || !TARGETS.includes(input.target) ||
      (input.operation === 'generate' ? !NAME.test(input.name ?? '') : input.name !== undefined)) fail('invalid_request');
  return input;
}

export function authorize(config, bearer, input) {
  if (typeof bearer !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(bearer)) fail('forbidden');
  const digest = createHash('sha256').update(bearer).digest();
  const principal = config.principals.find(candidate => timingSafeEqual(digest, Buffer.from(candidate.tokenSha256, 'hex')));
  if (!principal?.grants.some(grant => grant.project === input.project && grant.targets.includes(input.target) && grant.operations.includes(input.operation))) fail('forbidden');
  return principal.id;
}
