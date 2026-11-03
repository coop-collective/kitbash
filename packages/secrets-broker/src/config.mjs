import { createHash, timingSafeEqual } from 'node:crypto';
import { fail } from './errors.mjs';

export const OPERATIONS = ['setup', 'status', 'presence', 'generate', 'provision-github', 'provision-github-app', 'provision-worker-sync'];
export const TARGETS = ['local', 'staging', 'production'];
export const ALIAS = /^[a-z][a-z0-9-]{0,62}$/;
export const NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const RESERVED = /^(?:INFISICAL_|CLOUDFLARE_|GITHUB_|ACTIONS_|KIT_|NODE_OPTIONS$|PATH$|HOME$)/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const pathPattern = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;
export const APP_FIELDS = ['appId', 'clientId', 'clientSecret', 'privateKey', 'webhookSecret'];

function httpsUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_request'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) fail('invalid_request');
}

function validateGitHubApp(app, secrets) {
  if (!object(app) || Object.keys(app).some(key => !['owner', 'ownerType', 'manifest', 'secrets'].includes(key)) ||
      typeof app.owner !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(app.owner) ||
      !['organization', 'user'].includes(app.ownerType) || !object(app.secrets) ||
      Object.keys(app.secrets).length !== APP_FIELDS.length || new Set(Object.values(app.secrets)).size !== APP_FIELDS.length) fail('invalid_request');
  for (const field of APP_FIELDS) {
    const name = app.secrets[field];
    if (typeof name !== 'string' || !NAME.test(name) || !Object.hasOwn(secrets, name) ||
        secrets[name].generate || secrets[name].rotation !== 'provider') fail('invalid_request');
  }
  const manifest = app.manifest;
  if (!object(manifest) || Object.keys(manifest).some(key => !['name', 'url', 'hook_attributes', 'callback_urls', 'public', 'default_permissions', 'default_events'].includes(key)) ||
      typeof manifest.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(manifest.name) ||
      typeof manifest.public !== 'boolean' || !object(manifest.default_permissions) ||
      Object.entries(manifest.default_permissions).some(([name, level]) => !/^[a-z][a-z_]*$/.test(name) || !['read', 'write'].includes(level)) ||
      !Array.isArray(manifest.default_events) || manifest.default_events.some(event => typeof event !== 'string' || !/^[a-z][a-z_]*$/.test(event)) ||
      !object(manifest.hook_attributes) || Object.keys(manifest.hook_attributes).some(key => !['url', 'active'].includes(key)) ||
      manifest.hook_attributes.active !== true) fail('invalid_request');
  httpsUrl(manifest.url);
  httpsUrl(manifest.hook_attributes.url);
  if (manifest.callback_urls !== undefined) {
    if (!Array.isArray(manifest.callback_urls) || manifest.callback_urls.length > 10) fail('invalid_request');
    manifest.callback_urls.forEach(httpsUrl);
  }
}

export function httpsOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_request'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('invalid_request');
  return url.origin;
}

/** Only the operator configures destinations, credentials, and registration authority. */
export function validateConfig(config) {
  if (config?.version !== 1 || !object(config.projects) || !Array.isArray(config.principals) || !config.principals.length) fail('invalid_request');
  for (const [alias, project] of Object.entries(config.projects)) {
    if (!ALIAS.test(alias) || !object(project) || !object(project.targets) || !object(project.secrets)) fail('invalid_request');
    const cloudflare = project.backend === 'cloudflare-secrets-store';
    if (cloudflare) {
      if (!/^[a-f0-9]{32}$/.test(project.accountId ?? '') || !/^[a-f0-9]{32}$/.test(project.storeId ?? '') || project.domain || project.projectId) fail('invalid_request');
    } else {
      if (project.backend !== undefined && project.backend !== 'infisical') fail('invalid_request');
      if (!UUID.test(project.projectId) || !ALIAS.test(project.projectSlug)) fail('invalid_request');
      httpsOrigin(project.domain);
    }
    const appNames = new Set(Object.values(project.targets).flatMap(scope => object(scope?.githubApp?.secrets) ? Object.values(scope.githubApp.secrets) : []));
    for (const [name, policy] of Object.entries(project.secrets)) {
      if (!NAME.test(name) || !object(policy) || (RESERVED.test(name) && !(name.startsWith('GITHUB_APP_') && appNames.has(name) && !policy.generate && policy.rotation === 'provider')) || typeof policy.generate !== 'boolean' ||
          (policy.bytes !== undefined && ![32, 48, 64].includes(policy.bytes)) || (policy.required !== undefined && typeof policy.required !== 'boolean') ||
          !['manual', 'migration-required', 'provider'].includes(policy.rotation) || (policy.generate && policy.rotation === 'provider')) fail('invalid_request');
    }
    for (const [target, scope] of Object.entries(project.targets)) {
      if (!TARGETS.includes(target) || !object(scope)) fail('invalid_request');
      if (cloudflare) {
        if (!/^[A-Z][A-Z0-9_]{0,79}_$/.test(scope.secretPrefix ?? '') || scope.github || scope.cloudflare || scope.environment || scope.secretPath) fail('invalid_request');
      } else if (!ALIAS.test(scope.environment) || !pathPattern.test(scope.secretPath) || scope.secretPath === '/') fail('invalid_request');
      if (target === 'local' && (scope.github || scope.cloudflare)) fail('invalid_request');
      if (scope.githubApp !== undefined) validateGitHubApp(scope.githubApp, project.secrets);
    }
  }
  const destinations = [];
  for (const project of Object.values(config.projects)) if (project.backend === 'cloudflare-secrets-store') {
    for (const scope of Object.values(project.targets)) {
      const destination = `${project.accountId}:${project.storeId}:${scope.secretPrefix}`;
      if (destinations.some(existing => existing.startsWith(destination) || destination.startsWith(existing))) fail('invalid_request');
      destinations.push(destination);
    }
  }
  const digests = new Set();
  const principalIds = new Set();
  for (const principal of config.principals) {
    if (!ALIAS.test(principal.id) || principalIds.has(principal.id) || !/^[a-f0-9]{64}$/.test(principal.tokenSha256) || digests.has(principal.tokenSha256) || !Array.isArray(principal.grants) || (!principal.grants.length && !principal.registration)) fail('invalid_request');
    principalIds.add(principal.id);
    digests.add(principal.tokenSha256);
    if (principal.registration !== undefined) {
      const registration = principal.registration;
      if (!object(registration) || Object.keys(registration).some(key => !['accountId', 'storeId', 'secretPrefix', 'targets'].includes(key)) ||
          !/^[a-f0-9]{32}$/.test(registration.accountId ?? '') || !/^[a-f0-9]{32}$/.test(registration.storeId ?? '') ||
          !/^[A-Z][A-Z0-9_]{0,30}_$/.test(registration.secretPrefix ?? '') ||
          !Array.isArray(registration.targets) || !registration.targets.length || registration.targets.some(target => !TARGETS.includes(target))) fail('invalid_request');
      const destination = `${registration.accountId}:${registration.storeId}:${registration.secretPrefix}`;
      if (destinations.some(existing => existing.startsWith(destination) || destination.startsWith(existing))) fail('invalid_request');
      destinations.push(destination);
    }
    for (const grant of principal.grants) {
      const project = config.projects[grant.project];
      if (!Object.hasOwn(config.projects, grant.project) || !Array.isArray(grant.targets) || !grant.targets.length ||
          grant.targets.some(target => !Object.hasOwn(project.targets, target)) || !Array.isArray(grant.operations) || !grant.operations.length ||
          grant.operations.some(operation => !OPERATIONS.includes(operation))) fail('invalid_request');
      if (project.backend === 'cloudflare-secrets-store' && grant.operations.some(operation => ['provision-github', 'provision-worker-sync'].includes(operation))) fail('invalid_request');
    }
  }
  return config;
}

export function validateOperation(input) {
  if (!object(input) || Object.keys(input).some(key => !['operation', 'project', 'target', 'name'].includes(key)) ||
      !OPERATIONS.includes(input.operation) || typeof input.project !== 'string' || !ALIAS.test(input.project) || !TARGETS.includes(input.target) ||
      (['generate', 'presence'].includes(input.operation) ? typeof input.name !== 'string' || !NAME.test(input.name) : input.name !== undefined)) fail('invalid_request');
  return input;
}

export function authenticate(config, bearer) {
  if (typeof bearer !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(bearer)) fail('forbidden');
  const digest = createHash('sha256').update(bearer).digest();
  const principal = config.principals.find(candidate => timingSafeEqual(digest, Buffer.from(candidate.tokenSha256, 'hex')));
  if (!principal) fail('forbidden');
  return principal;
}

export function authorize(config, bearer, input) {
  const principal = authenticate(config, bearer);
  if (!principal.grants.some(grant => grant.project === input.project && grant.targets.includes(input.target) && grant.operations.includes(input.operation))) fail('forbidden');
  return principal.id;
}
