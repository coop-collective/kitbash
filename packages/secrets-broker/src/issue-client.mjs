#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, httpsOrigin } from './config.mjs';
import { fail, publicError } from './errors.mjs';

/** Operator only. Issue a scoped broker capability, never a vault/provider credential. */
export function issueClient({ policyFile, principalId, outputFile, brokerUrl }) {
  const url = httpsOrigin(brokerUrl);
  const policyInfo = lstatSync(policyFile);
  const outputParent = lstatSync(path.dirname(path.resolve(outputFile)));
  if (!policyInfo.isFile() || policyInfo.isSymbolicLink() || !outputParent.isDirectory() || outputParent.isSymbolicLink() || (outputParent.mode & 0o077)) fail('invalid_request');
  const config = validateConfig(JSON.parse(readFileSync(policyFile, 'utf8')));
  const principal = config.principals.find(value => value.id === principalId);
  if (!principal) fail('invalid_request');
  const token = randomBytes(32).toString('base64url');
  const temporary = `${policyFile}.${randomUUID()}.tmp`;
  principal.tokenSha256 = createHash('sha256').update(token).digest('hex');
  writeFileSync(outputFile, `KIT_SECRETS_BROKER_URL=${url}\nKIT_SECRETS_BROKER_TOKEN=${token}\n`, { mode: 0o600, flag: 'wx' });
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, policyFile);
  } catch {
    rmSync(outputFile, { force: true });
    fail('unavailable');
  } finally { rmSync(temporary, { force: true }); }
  return { status: 'issued', restartBroker: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const args = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!['--policy', '--principal', '--output', '--url'].includes(argv[i]) || !argv[i + 1] || args[argv[i]]) fail('invalid_request');
      args[argv[i]] = argv[i + 1];
    }
    if (Object.keys(args).length !== 4) fail('invalid_request');
    console.log(JSON.stringify(issueClient({ policyFile: args['--policy'], principalId: args['--principal'], outputFile: args['--output'], brokerUrl: args['--url'] })));
  } catch (error) {
    console.error(JSON.stringify(publicError(error)));
    process.exitCode = 1;
  }
}
