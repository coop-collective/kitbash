import { readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const policy = JSON.parse(readFileSync(new URL('./policy.github-app.example.json', import.meta.url), 'utf8'));
const project = policy.projects['engine-box-runners'];
project.domain = 'https://vault.example.test';
project.secrets.SESSION_SECRET = { generate: true, rotation: 'manual' };
project.targets.production = { environment: 'production', secretPath: '/app' };
policy.principals[0].grants[0].operations.push('generate');
policy.principals[0].grants[0].targets.push('production');
policy.projects['cloudflare-app'] = {
  backend: 'cloudflare-secrets-store', accountId: 'a'.repeat(32), storeId: 'b'.repeat(32),
  secrets: { SESSION_SECRET: { generate: true, rotation: 'manual' } },
  targets: { staging: { secretPrefix: 'CLOUDFLARE_APP_STAGING_' } },
};
policy.principals[0].grants.push({ project: 'cloudflare-app', targets: ['staging'], operations: ['status', 'presence', 'generate', 'setup'] });
const token = 'test-worker-capability-012345678901234567890';
policy.principals[0].registration = { accountId: 'a'.repeat(32), storeId: 'b'.repeat(32), secretPrefix: 'MCP_GROK_', targets: ['staging', 'production'] };
const readerToken = 'test-reader-capability-012345678901234567890';
const deliveryKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const deliveryToken = 'd'.repeat(43);
const integrations = { 'enginebox-runners': {
  principal: 'grok-bot', project: 'enginebox', target: 'production', owner: 'your-org', slug: 'enginebox-runners',
  webhookBinding: 'KIT_DELIVERY_AAAAAAAAAAAAAAAA',
  names: { clientSecret: 'APP_CLIENT_SECRET', privateKey: 'APP_PRIVATE_KEY', webhookSecret: 'APP_WEBHOOK_SECRET' },
  controller: { label: 'test-controller', publicKey: deliveryKeys.publicKey.export({ format: 'jwk' }), tokenSha256: createHash('sha256').update(deliveryToken).digest('hex') },
} };
policy.principals.push({ id: 'reader', tokenSha256: createHash('sha256').update(readerToken).digest('hex'),
  grants: [{ project: 'cloudflare-app', targets: ['staging'], operations: ['status'] }] });

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      // Match the installed workerd test runtime; production config uses the creation date.
      compatibilityDate: '2026-08-22',
      bindings: {
        KIT_BROKER_POLICY: JSON.stringify(policy), KIT_BROKER_PRINCIPAL: 'grok-bot',
        KIT_BROKER_TOKEN_SHA256: createHash('sha256').update(token).digest('hex'),
        KIT_BROKER_PUBLIC_ORIGIN: 'https://broker.example.test', INFISICAL_TOKEN: 'fixture.vault.token',
        TEST_TOKEN: token, TEST_READER_TOKEN: readerToken,
        KIT_BROKER_INTEGRATIONS: JSON.stringify(integrations), TEST_DELIVERY_TOKEN: deliveryToken,
        TEST_DELIVERY_KEY: JSON.stringify(deliveryKeys.privateKey.export({ format: 'jwk' })),
        KIT_BROKER_SECRETS_API_TOKEN: 'cfat_fixture_runtime_store_token',
        TEST_PEM: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }),
      },
    },
  })],
  test: { include: ['test/worker.test.js'] },
});
