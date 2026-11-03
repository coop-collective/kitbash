#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALIAS, NAME, validateConfig } from '../src/config.mjs';
import { integrationConfig } from '../src/github-import.mjs';
import { deploy, privateDirectory, privateWrite, readLocalEnv, repoDir, packageDir, run, writeDeploymentConfig } from './deployment.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const remoteFiles = ['scripts/controller-receiver.mjs', 'src/github-import.mjs', 'src/sealed-delivery.mjs', 'src/errors.mjs', 'src/config.mjs', 'src/api.mjs', 'src/cloudflare-store.mjs'];

export function parseEnrollment(argv) {
  const input = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    if (!argv[i]?.startsWith('--') || !['ssh', 'directory', 'project', 'target', 'integration', 'owner', 'slug', 'kind', 'prefix'].includes(key) || input[key] || !argv[i + 1]) throw new Error('Invalid enrollment arguments.');
    input[key] = argv[i + 1];
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/.test(input.ssh ?? '') || !/^\/[A-Za-z0-9/_-]+$/.test(input.directory ?? '') ||
      input.directory.split('/').includes('..') || !ALIAS.test(input.project ?? '') || !ALIAS.test(input.integration ?? '') ||
      !['staging', 'production'].includes(input.target) || !['repos', 'runners'].includes(input.kind) || !NAME.test(input.prefix ?? '') ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(input.owner ?? '') || (input.slug && !ALIAS.test(input.slug))) throw new Error('Provide SSH host, absolute private directory, integration, project, target, owner, kind and uppercase secret prefix.');
  return input;
}

export async function enrollController(input, { root = repoDir, runner = run } = {}) {
  const env = await readLocalEnv(root);
  const policy = validateConfig(JSON.parse(await readFile(path.resolve(root, env.KIT_BROKER_POLICY_FILE), 'utf8')));
  const principal = policy.principals.find(row => row.id === env.KIT_BROKER_PRINCIPAL);
  if (!principal?.registration?.targets.includes(input.target) || Object.hasOwn(policy.projects, input.project)) throw new Error('The selected principal must have dynamic registration access for this target.');
  const metadataDir = await privateDirectory(root);
  const integrationFile = path.join(metadataDir, 'integrations.json');
  let integrations = {};
  try { integrations = JSON.parse(await readFile(integrationFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const runtime = `${input.directory}/runtime`;
  const receiverDir = `${input.directory}/${input.integration}`;
  const ssh = (command, body) => runner('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', input.ssh, command], { input: body });
  const archive = path.join(metadataDir, 'receiver-code.tar');
  try {
    await runner('tar', ['-cf', archive, '-C', packageDir, ...remoteFiles]);
    await ssh(`umask 077 && mkdir -p ${quote(runtime)} && tar -xf - -C ${quote(runtime)}`, await readFile(archive));
  } finally { await rm(archive, { force: true }); }
  const enrollment = JSON.parse(await ssh(`/usr/local/bin/node ${quote(runtime + '/scripts/controller-receiver.mjs')} enroll ${quote(receiverDir)}`));
  const binding = `KIT_DELIVERY_${digest(input.integration).slice(0, 16).toUpperCase()}`;
  const names = { clientSecret: `${input.prefix}_CLIENT_SECRET`, privateKey: `${input.prefix}_PRIVATE_KEY`, webhookSecret: `${input.prefix}_WEBHOOK_SECRET` };
  const integration = { principal: principal.id, project: input.project, target: input.target, owner: input.owner,
    ...(input.slug ? { slug: input.slug } : {}), names, webhookBinding: binding,
    controller: { ...enrollment, label: `${input.project} ${input.target} controller` } };
  integrationConfig({ KIT_BROKER_INTEGRATIONS: JSON.stringify({ [input.integration]: integration }) });
  if (integrations[input.integration] && JSON.stringify(integrations[input.integration]) !== JSON.stringify(integration)) throw new Error('Existing enrollment differs; migrate it explicitly rather than replacing controller access.');
  integrations[input.integration] = integration;
  const receiver = { integration: input.integration, origin: `https://${env.KIT_BROKER_HOSTNAME}`, project: input.project, target: input.target,
    owner: input.owner, ...(input.slug ? { slug: input.slug } : {}), kind: input.kind, names, outputDirectory: `${receiverDir}/credentials` };
  const installConfig = `const fs=require('node:fs');const p=${JSON.stringify(receiverDir + '/config.json')};let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',()=>{if(fs.existsSync(p)){if(fs.readFileSync(p,'utf8')!==text)throw Error('Enrollment differs');}else fs.writeFileSync(p,text,{mode:0o600,flag:'wx'});});`;
  await ssh(`/usr/local/bin/node -e ${quote(installConfig)}`, JSON.stringify(receiver, null, 2) + '\n');
  const prefix = principal.registration.secretPrefix + digest(`${principal.id}:${input.project}:${input.target}`).slice(0, 32).toUpperCase() + '_';
  const bindings = JSON.parse(env.KIT_BROKER_SECRET_BINDINGS ?? '[]');
  const nextBinding = { binding, store_id: principal.registration.storeId, secret_name: prefix + names.webhookSecret };
  const existing = bindings.find(row => row.binding === binding);
  if (existing && JSON.stringify(existing) !== JSON.stringify(nextBinding)) throw new Error('An existing binding differs.');
  if (!existing) bindings.push(nextBinding);
  env.KIT_BROKER_SECRET_BINDINGS = JSON.stringify(bindings);
  await privateWrite(integrationFile, JSON.stringify(integrations, null, 2) + '\n');
  if (Object.entries(env).some(([name, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || /['\r\n\0]/.test(value))) throw new Error('Invalid local environment format.');
  await privateWrite(path.join(root, '.env'), Object.entries(env).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n');
  if (env.KIT_BROKER_GITHUB_REPOSITORY && env.KIT_BROKER_GITHUB_ENVIRONMENT) {
    await runner('gh', ['variable', 'set', 'KIT_BROKER_SECRET_BINDINGS', '--repo', env.KIT_BROKER_GITHUB_REPOSITORY,
      '--env', env.KIT_BROKER_GITHUB_ENVIRONMENT, '--body', env.KIT_BROKER_SECRET_BINDINGS]);
  }
  const secretsFile = path.join(metadataDir, 'integration-deploy.json');
  await privateWrite(secretsFile, JSON.stringify({ KIT_BROKER_INTEGRATIONS: JSON.stringify(integrations) }));
  try { await deploy({ env, config: await writeDeploymentConfig(env, { root }), secretsFile, runner }); }
  finally { await rm(secretsFile, { force: true }); }
  return { status: 'enrolled', integration: input.integration, project: input.project, target: input.target, receiverDirectory: receiverDir,
    command: `/usr/local/bin/node ${runtime}/scripts/controller-receiver.mjs receive ${receiverDir}`, mcpKey: 'preserved' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) enrollController(parseEnrollment(process.argv.slice(2)))
  .then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
