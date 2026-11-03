import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureGitHubAuth } from '../scripts/github-auth.mjs';

const credential = 'fixture-private-gh-credential';

test('setup reuses an authenticated GitHub CLI account without starting login', async () => {
  const calls = [];
  const result = await ensureGitHubAuth({ env: {}, runner: async (command, args) => {
    calls.push({ command, args });
    return args[1] === 'token' ? credential : '';
  }, login: async () => assert.fail('Already authenticated; must not log in again') });
  assert.equal(result, credential);
  assert.deepEqual(calls.map(call => call.args), [
    ['--version'], ['auth', 'status', '--active', '--hostname', 'github.com'], ['auth', 'token', '--hostname', 'github.com'],
  ]);
  assert.equal(JSON.stringify(calls).includes(credential), false);
});

test('missing authentication starts the interactive login and checks it before proceeding', async () => {
  let signedIn = false;
  const calls = [], notes = [];
  const result = await ensureGitHubAuth({ env: {}, note: message => notes.push(message), runner: async (_command, args) => {
    calls.push(args[1] ?? args[0]);
    if (args[1] === 'status' && !signedIn) throw new Error('not signed in');
    return args[1] === 'token' ? credential : '';
  }, login: async () => { calls.push('login'); signedIn = true; } });
  assert.equal(result, credential);
  assert.deepEqual(calls, ['--version', 'status', 'login', 'status', 'token']);
  assert.match(notes.join(' '), /Starting the GitHub login prompt/);
  assert.equal(JSON.stringify(notes).includes(credential), false);
});

test('an authenticated environment token is reused without reading or replacing CLI credentials', async () => {
  const calls = [];
  assert.equal(await ensureGitHubAuth({ env: { GH_TOKEN: credential }, runner: async (_command, args) => calls.push(args), login: async () => assert.fail() }), credential);
  assert.equal(calls.some(args => args[1] === 'token'), false);
});

test('invalid supplied tokens do not launch a login that the environment would override', async () => {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    await assert.rejects(ensureGitHubAuth({ env: { [name]: credential }, runner: async (_command, args) => {
      if (args[1] === 'status') throw new Error(credential);
    }, login: async () => assert.fail('Environment token requires correction') }), error => {
      assert.match(error.message, /Update or unset/);
      assert.equal(error.message.includes(credential), false);
      return true;
    });
  }
});

test('unattended setup stops on missing authentication; failed login never proceeds to token retrieval', async () => {
  const runner = async (_command, args) => {
    if (args[1] === 'status') throw new Error('unauthenticated');
    if (args[1] === 'token') assert.fail('Cannot retrieve a token without authenticating');
  };
  await assert.rejects(ensureGitHubAuth({ env: {}, runner }), /interactively/);
  await assert.rejects(ensureGitHubAuth({ env: {}, runner, login: async () => {} }), /still failed after login/);
});

test('missing CLI and empty credential are actionable errors, not login success', async () => {
  await assert.rejects(ensureGitHubAuth({ env: {}, runner: async () => { throw new Error('ENOENT'); }, login: async () => assert.fail() }), /Install it/);
  await assert.rejects(ensureGitHubAuth({ env: {}, runner: async () => '' }), /did not provide/);
});
