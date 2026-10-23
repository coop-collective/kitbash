import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createService } from '../../secrets-broker/src/service.mjs';
import { createBrokerServer } from '../../secrets-broker/src/server.mjs';
import { runSecrets } from '../plugins/kitbash/scripts/secrets-tool.mjs';

test('plugin → HTTP → isolated broker generates once and returns no secret through success or failure', async t => {
  const token = 'test_only_broker_capability_01234567890123456789';
  const sentinel = 'provider-response-must-never-reach-agent';
  const projectId = '11111111-1111-4111-8111-111111111111';
  const config = {
    version: 1,
    projects: { app: {
      projectId, projectSlug: 'app', domain: 'https://vault.example.test',
      targets: { staging: { environment: 'staging', secretPath: '/app' } },
      secrets: { SESSION_SECRET: { generate: true, rotation: 'migration-required' } },
    } },
    principals: [{ id: 'agent', tokenSha256: createHash('sha256').update(token).digest('hex'),
      grants: [{ project: 'app', targets: ['staging'], operations: ['generate', 'status'] }],
    }],
  };
  const store = { data: { version: 1, entries: {} }, save: async () => {} };
  let generated;
  let writes = 0;
  let fail = false;
  const row = () => ({ secretKey: 'SESSION_SECRET', secretValue: generated, workspace: projectId,
    environment: 'staging', secretPath: '/app', type: 'shared' });
  const infisical = async (_endpoint, options) => {
    if (fail) throw Error(sentinel);
    if (options.method === 'POST') {
      writes++;
      generated = options.body.secretValue;
      return { secret: row(), debug: sentinel };
    }
    assert.equal(options.query.viewSecretValue, 'false');
    return { secrets: generated ? [row()] : [], accessToken: sentinel };
  };
  const service = createService(config, store, { providers: async () => ({ infisical }) });
  const audit = [];
  const server = createBrokerServer(service, { audit: event => audit.push(event) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { KIT_SECRETS_BROKER_URL: `http://127.0.0.1:${server.address().port}`,
    KIT_SECRETS_BROKER_TOKEN: token, KIT_SECRETS_BROKER_ALLOW_LOOPBACK_HTTP: '1' };
  const request = { operation: 'generate', project: 'app', target: 'staging', name: 'SESSION_SECRET' };
  const first = await runSecrets(request, { env });
  const repeated = await runSecrets(request, { env });
  assert.equal(first.status, 'created');
  assert.equal(repeated.status, 'already-exists');
  assert.equal(writes, 1);
  const status = await runSecrets({ operation: 'status', project: 'app', target: 'staging' }, { env });
  assert.deepEqual(status.secrets, [{ name: 'SESSION_SECRET', status: 'present' }]);
  fail = true;
  await assert.rejects(runSecrets(request, { env }), error => error.code === 'provider_failed' && !error.message.includes(sentinel));
  const visible = JSON.stringify({ first, repeated, status, audit, state: store.data });
  for (const value of [token, sentinel, generated]) assert.equal(visible.includes(value), false);
});
