import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createUploadFlow, validateUpload, validateDeliveryQuery } from '../src/uploads.mjs';
import { uploadHelper } from '../src/upload-helper.mjs';

const input = { operation: 'begin', project: 'example', target: 'production', names: ['API_TOKEN', 'APP_PEM'] };
const body = { secrets: { API_TOKEN: 'fixture-upload-token', APP_PEM: 'fixture-pem\nwith-newlines\n' } };
function fixture() {
  let state = {}, time = 1000000, writes = 0;
  const values = new Map(), mode = {}, rules = { API_TOKEN: { generate: false }, APP_PEM: { generate: false }, RANDOM_SECRET: { generate: true } };
  const flow = () => createUploadFlow({ principal: 'grok-bot', project: 'example', target: 'production', epoch: mode.epoch ?? 'epoch',
    rules, state, now: () => time, save: async next => { if (mode.saveError) throw Error('disk'); state = structuredClone(next); },
    prepare: async () => { if (mode.prepareError) throw Error('adapter'); },
    storage: { listNames: async () => new Set(values.keys()), createMany: async entries => {
      writes++;
      for (const [i, entry] of entries.entries()) if (!mode.partial || i === 0) values.set(entry.name, entry.value);
      if (mode.lost || mode.partial) throw Error('sensitive-provider-response');
    } },
  });
  const begin = async () => { const ticket = await flow().begin(input); return { ...ticket, capability: ticket.path.split('/').at(-1) }; };
  return { flow, begin, values, mode, rules, state: () => state, writes: () => writes, expire: () => { time += 900001; } };
}

test('generic upload writes exact registered values, preserves PEM newlines and returns no values', async () => {
  const f = fixture(), ticket = await f.begin();
  const result = await f.flow().submit(ticket.uploadId, ticket.capability, body);
  assert.equal(result.status, 'stored');
  assert.deepEqual(Object.fromEntries(f.values), body.secrets);
  for (const value of [...Object.values(body.secrets), ticket.capability]) assert.equal(JSON.stringify({ result, state: f.state() }).includes(JSON.stringify(value).slice(1, -1)), false);
  const replay = await f.flow().submit(ticket.uploadId, ticket.capability, { secrets: { API_TOKEN: 'replacement' } });
  assert.equal(replay.status, 'stored'); assert.equal(f.writes(), 1);
  assert.equal((await f.flow().status(ticket.uploadId)).status, 'stored');
});

test('tickets enforce capability, expiry, key rotation, registration and exact names before writing', async () => {
  const f = fixture(), ticket = await f.begin();
  await assert.rejects(f.flow().submit(ticket.uploadId, 'x'.repeat(43), body), /forbidden/);
  for (const bad of [{ secrets: { API_TOKEN: 'only-one' } }, { secrets: { ...body.secrets, EXTRA: 'value' } }, { secrets: { ...body.secrets, API_TOKEN: 'a'.repeat(65537) } }, { secrets: { ...body.secrets, API_TOKEN: '\0' } }]) {
    await assert.rejects(f.flow().submit(ticket.uploadId, ticket.capability, bad), /invalid_request/);
  }
  f.mode.epoch = 'rotated';
  await assert.rejects(f.flow().submit(ticket.uploadId, ticket.capability, body), /forbidden/);
  delete f.mode.epoch;
  f.rules.API_TOKEN.generate = true;
  await assert.rejects(f.flow().submit(ticket.uploadId, ticket.capability, body), /forbidden/);
  f.rules.API_TOKEN.generate = false; f.expire();
  await assert.rejects(f.flow().submit(ticket.uploadId, ticket.capability, body), /forbidden/);
  assert.equal((await f.flow().status(ticket.uploadId)).status, 'expired');
  assert.equal(f.writes(), 0);
});

test('conflicting sessions and pre-existing values never overwrite; unused expired tickets can restart', async () => {
  const f = fixture(), ticket = await f.begin();
  await assert.rejects(f.begin(), /conflict/);
  f.values.set('API_TOKEN', 'existing');
  await assert.rejects(f.flow().submit(ticket.uploadId, ticket.capability, body), /conflict/);
  assert.equal(f.values.get('API_TOKEN'), 'existing'); assert.equal(f.writes(), 0);
  f.values.clear(); f.expire(); assert.notEqual((await f.begin()).uploadId, ticket.uploadId);
  await assert.rejects(f.flow().begin({ ...input, names: ['RANDOM_SECRET'] }), /forbidden/);
  await assert.rejects(f.flow().begin({ ...input, names: ['UNREGISTERED'] }), /forbidden/);
});

test('lost acknowledgements reconcile without rewriting; partial writes stay reserved and pending', async () => {
  for (const mode of ['lost', 'partial']) {
    const f = fixture(), ticket = await f.begin(); f.mode[mode] = true;
    assert.equal((await f.flow().submit(ticket.uploadId, ticket.capability, body)).status, 'pending');
    assert.equal((await f.flow().status(ticket.uploadId)).status, mode === 'lost' ? 'stored' : 'pending');
    await f.flow().submit(ticket.uploadId, ticket.capability, body);
    f.expire(); await assert.rejects(f.begin(), /conflict/);
    assert.equal(f.writes(), 1);
  }
});

test('failed preparation or checkpoint cannot write values; MCP accepts only scoped metadata', async () => {
  for (const mode of ['saveError', 'prepareError']) {
    const f = fixture(), ticket = await f.begin(); f.mode[mode] = true;
    await assert.rejects(f.flow().submit(ticket.uploadId, ticket.capability, body));
    assert.equal(f.writes(), 0);
  }
  for (const bad of [{ ...input, value: 'secret' }, { ...input, names: ['API_TOKEN', 'API_TOKEN'] }, { ...input, metadata: { clientSecret: 'value' } },
    { ...input, delivery: 'demo', metadata: { clientId: 'id', privateKey: 'value' } }, { ...input, operation: 'status' }, { ...input, names: ['../../KEY'] }]) assert.throws(() => validateUpload(bad), /invalid_request/);
  assert.throws(() => validateDeliveryQuery({ integration: 'demo', token: 'value' }), /invalid_request/);
});

test('standalone Python helper uploads private files exactly and refuses symlinks, unsafe URLs, redirects and leaked replies', async () => {
  const code = uploadHelper.replace("if __name__ == '__main__':", "if False:") + String.raw`
import tempfile
from pathlib import Path
from unittest.mock import patch
with tempfile.TemporaryDirectory() as directory:
    file = Path(directory) / 'token'
    file.write_text('helper-fixture-value\n'); file.chmod(0o600)
    ticket = {'project': 'example', 'target': 'production', 'uploadId': '12345678-1234-4234-8234-123456789012', 'names': ['API_TOKEN'], 'uploadUrl': 'https://broker.example.test/v1/uploads/grok-bot/example/production/12345678-1234-4234-8234-123456789012/' + 'x' * 43}
    def post(url, body):
        assert json.loads(body)['secrets']['API_TOKEN'] == 'helper-fixture-value\n'
        return dict(ticket, status='stored', values='must-not-print')
    result = upload(ticket, ['API_TOKEN=' + str(file)], post)
    assert 'values' not in result and 'helper-fixture-value' not in json.dumps(result)
    def rejected(work):
        try: work()
        except Exception: return
        raise AssertionError('Expected rejection')
    file.chmod(0o644); rejected(lambda: upload(ticket, ['API_TOKEN=' + str(file)], post)); file.chmod(0o600)
    link = Path(directory) / 'link'; link.symlink_to(file)
    rejected(lambda: upload(ticket, ['API_TOKEN=' + str(link)], post))
    for url in ['http://broker.example.test/x', ticket['uploadUrl'] + '?token=x', ticket['uploadUrl'].replace('/example/', '/another/')]:
        rejected(lambda: upload(dict(ticket, uploadUrl=url), ['API_TOKEN=' + str(file)], post))
    rejected(lambda: upload(ticket, ['API_TOKEN=' + str(file)], lambda *args: {'status': 'stored', 'value': 'secret'}))
    assert NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere.test') is None
    with patch.object(sys, 'argv', ['helper', '--ticket', str(file), '--secret', 'API_TOKEN=' + str(file)]):
        assert main() == 1
print('helper checks passed')
`;
  const result = await new Promise(resolve => {
    const child = spawn('python3', ['-c', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
    child.on('close', code => resolve({ code, output }));
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /helper checks passed/);
  assert.equal(result.output.includes('helper-fixture-value'), false);
  assert.equal(result.output.includes('must-not-print'), false);
});
