import { createHash } from 'node:crypto';
import { DurableObject } from 'cloudflare:workers';
import { authenticate, authorize, validateConfig, validateOperation, ALIAS, TARGETS } from './config.mjs';
import { BrokerError, fail, publicError } from './errors.mjs';
import { createService } from './service.mjs';
import { createBrokerHandler, errorResponse } from './http.mjs';
import { REGISTERED_OPERATIONS, validateRegistration, registrationAuthority, registrationObjectName, registerSecrets, registeredConfig, checkRecord } from './registration.mjs';
import { createDeliveryFlow, integrationConfig, prepareGitHubDelivery } from './github-import.mjs';
import { createUploadFlow, validateUpload, validateDeliveryQuery, UPLOAD_BYTES } from './uploads.mjs';
import { uploadHelper } from './upload-helper.mjs';
import { cloudflareSecretStore } from './cloudflare-store.mjs';

function policy(env) {
  let config;
  try { config = JSON.parse(env.KIT_BROKER_POLICY); } catch { fail('unavailable'); }
  const principal = config.principals?.find(row => row.id === env.KIT_BROKER_PRINCIPAL);
  if (!principal || !/^[a-f0-9]{64}$/.test(env.KIT_BROKER_TOKEN_SHA256 ?? '')) fail('unavailable');
  principal.tokenSha256 = env.KIT_BROKER_TOKEN_SHA256;
  return validateConfig(config);
}

const prefix = (project, target) => `/github-app/${project}/${target}`;
async function unwrap(promise) {
  try {
    const result = await promise;
    try {
      if (result.error) throw new BrokerError(result.error.code);
      return result.value;
    } finally { result[Symbol.dispose]?.(); }
  } finally { promise[Symbol.dispose]?.(); }
}

async function rpc(env, project, target, method, args, objectName = `${project}:${target}`) {
  const stub = env.BROKER_STATE.getByName(objectName);
  return unwrap(stub[method](...args));
}

/** One coordinator per project/target. Durable storage holds metadata and controller-encrypted deliveries. */
export class BrokerState extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.queue = Promise.resolve();
    this.queued = 0;
    ctx.blockConcurrencyWhile(async () => {
      this.store = { data: await ctx.storage.get('checkpoints') ?? { version: 1, entries: {} }, save: () => ctx.storage.put('checkpoints', this.store.data) };
      this.registration = await ctx.storage.get('registration');
      this.imports = await ctx.storage.get('imports') ?? {};
      this.uploads = await ctx.storage.get('uploads') ?? {};
      const handoffs = await ctx.storage.get('handoffs');
      this.flows = {
        data: handoffs?.epoch === env.KIT_BROKER_TOKEN_SHA256 ? handoffs.flows : [],
        save: () => ctx.storage.put('handoffs', { epoch: env.KIT_BROKER_TOKEN_SHA256, flows: this.flows.data }),
      };
    });
  }

  async enqueue(work) {
    if (this.queued >= 32) fail('unavailable');
    this.queued++;
    const job = this.queue.then(work);
    this.queue = job.catch(() => {});
    try { return await job; } finally { this.queued--; }
  }

  serviceFor(project, target, bearer) {
    const config = policy(this.env);
    const dynamic = !Object.hasOwn(config.projects, project);
    const principal = dynamic ? registrationAuthority(config, bearer, { project, target }) : null;
    const objectName = dynamic ? registrationObjectName(principal, { project, target }) : `${project}:${target}`;
    if (!ALIAS.test(project) || !TARGETS.includes(target) ||
        !this.ctx.id.equals(this.env.BROKER_STATE.idFromName(objectName))) fail('forbidden');
    const effective = dynamic ? registeredConfig(config, bearer, { project, target }, this.registration) : config;
    if (!this.service) this.service = createService(effective, this.store, {
      env: this.env,
      githubAppOptions: { pathPrefix: prefix(project, target), flowStorage: this.flows },
    });
    return this.service;
  }

  async operation(input, bearer) {
    try {
      validateOperation(input);
      return { value: await this.enqueue(() => this.serviceFor(input.project, input.target, bearer).execute(input, bearer)) };
    } catch (error) {
      if (error instanceof BrokerError && error.code === 'provider_failed') console.warn(JSON.stringify({
        event: 'broker_provider_failed', status: Number.isInteger(error.status) ? error.status : null,
        phase: ['transport', 'response', 'decode', 'shape'].includes(error.phase) ? error.phase : 'adapter',
      }));
      return publicError(error);
    }
  }

  async register(input, bearer) {
    try {
      validateRegistration(input);
      const config = policy(this.env);
      const principal = registrationAuthority(config, bearer, input);
      if (!this.ctx.id.equals(this.env.BROKER_STATE.idFromName(registrationObjectName(principal, input)))) fail('forbidden');
      return { value: await this.enqueue(async () => {
        const { record, output } = registerSecrets(config, bearer, input, this.registration);
        await this.ctx.storage.put('registration', record);
        this.registration = record;
        this.service = undefined;
        return output;
      }) };
    } catch (error) { return publicError(error); }
  }

  async browser(project, target, action, args) {
    try {
      const service = this.serviceFor(project, target);
      if (!['previewGitHubApp', 'openGitHubApp', 'completeGitHubApp'].includes(action)) fail('forbidden');
      return { value: await service[action](...args) };
    } catch (error) { return publicError(error); }
  }

  uploadFlow(principal, input) {
    const record = this.registration;
    if (!record || !principal?.registration?.targets.includes(input.target) ||
        !this.ctx.id.equals(this.env.BROKER_STATE.idFromName(registrationObjectName(principal, input)))) fail('forbidden');
    checkRecord(record, principal, input);
    return createUploadFlow({ principal: principal.id, project: input.project, target: input.target, epoch: principal.tokenSha256,
      rules: record.secrets, state: this.uploads,
      storage: cloudflareSecretStore(record, { token: this.env.KIT_BROKER_SECRETS_API_TOKEN }),
      save: async (next, prepared) => {
        const imports = prepared ? { ...this.imports, [prepared.id]: prepared.state } : this.imports;
        await this.ctx.storage.put({ uploads: next, imports });
        this.uploads = next; this.imports = imports;
      },
      prepare: async (row, values, present) => {
        if (!row.delivery) return;
        const integration = this.uploadIntegration(principal, { ...input, ...row });
        if (!present.has(integration.names.webhookSecret)) fail('conflict');
        const binding = this.env[integration.webhookBinding];
        if (!binding?.get) fail('unavailable');
        const state = await prepareGitHubDelivery({ id: row.delivery, config: integration, metadata: row.metadata, values, readWebhook: () => binding.get() });
        return { id: row.delivery, state };
      },
    });
  }

  uploadIntegration(principal, input) {
    const entries = integrationConfig(this.env);
    const integration = Object.hasOwn(entries, input.delivery) ? entries[input.delivery] : undefined;
    if (!integration || integration.principal !== principal.id || integration.project !== input.project || integration.target !== input.target ||
        input.names.slice().sort().join(',') !== [integration.names.clientSecret, integration.names.privateKey].sort().join(',') ||
        ['saving', 'ready', 'delivered'].includes(this.imports[input.delivery]?.phase)) fail('conflict');
    return integration;
  }

  async uploadOperation(input, bearer) {
    try {
      validateUpload(input);
      const principal = registrationAuthority(policy(this.env), bearer, input);
      return { value: await this.enqueue(async () => {
        if (input.delivery) this.uploadIntegration(principal, input);
        const flow = this.uploadFlow(principal, input);
        return input.operation === 'begin' ? flow.begin(input) : flow.status(input.uploadId);
      }) };
    } catch (error) { return publicError(error); }
  }

  async uploadBytes(principalId, input, id, capability, body) {
    try {
      const config = policy(this.env);
      const principal = config.principals.find(row => row.id === principalId);
      if (Object.hasOwn(config.projects, input.project)) fail('forbidden');
      return { value: await this.enqueue(() => this.uploadFlow(principal, input).submit(id, capability, body)) };
    } catch (error) { return publicError(error); }
  }

  async deliveryAction(id, action, args, bearer) {
    try {
      const integrations = integrationConfig(this.env);
      const integration = Object.hasOwn(integrations, id) ? integrations[id] : undefined;
      if (!integration || !['status', 'delivery', 'acknowledge'].includes(action)) fail('forbidden');
      const config = policy(this.env);
      const principal = config.principals.find(row => row.id === integration.principal);
      if (!principal?.registration || !principal.registration.targets.includes(integration.target) || Object.hasOwn(config.projects, integration.project) ||
          !this.ctx.id.equals(this.env.BROKER_STATE.idFromName(registrationObjectName(principal, integration)))) fail('forbidden');
      if (action === 'status' && authenticate(config, bearer).id !== integration.principal) fail('forbidden');
      return { value: await this.enqueue(async () => {
        const record = this.registration;
        if (!record || record.principal !== integration.principal || record.project !== integration.project || record.target !== integration.target ||
            record.accountId !== principal.registration.accountId || record.storeId !== principal.registration.storeId ||
            record.secrets[integration.names.clientSecret]?.generate !== false || record.secrets[integration.names.privateKey]?.generate !== false ||
            !record.secrets[integration.names.webhookSecret]) fail('forbidden');
        checkRecord(record, principal, integration);
        const flow = createDeliveryFlow({ id, config: integration,
          state: this.imports[id] ?? {},
          save: async state => {
            const next = { ...this.imports, [id]: state };
            await this.ctx.storage.put('imports', next);
            this.imports = next;
          },
          storage: cloudflareSecretStore(record, { token: this.env.KIT_BROKER_SECRETS_API_TOKEN }),

        });
        return flow[action](...args);
      }) };
    } catch (error) { return publicError(error); }
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.origin !== env.KIT_BROKER_PUBLIC_ORIGIN) fail('forbidden');
      const config = policy(env);
      const integrations = integrationConfig(env);
      const deliveryRpc = (id, action, args, bearer) => {
        const integration = Object.hasOwn(integrations, id) ? integrations[id] : undefined;
        if (!integration) fail('forbidden');
        return rpc(env, integration.project, integration.target, 'deliveryAction', [id, action, args, bearer],
          registrationObjectName({ id: integration.principal }, integration));
      };
      if (url.pathname === '/client/upload-secrets.py' && request.method === 'GET') {
        return new Response(uploadHelper, { headers: { 'content-type': 'text/x-python; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
      }
      if (url.pathname.startsWith('/import/')) return Response.json({ error: { code: 'gone', message: 'Use kitbash_upload_secrets from MCP.' } }, { status: 410, headers: browserHeaders });
      if (url.pathname.startsWith('/v1/uploads/')) {
        if (request.method !== 'POST' || request.headers.has('origin') || url.search || request.headers.get('content-type') !== 'application/json') fail('forbidden');
        const match = /^\/v1\/uploads\/([a-z][a-z0-9-]{0,62})\/([a-z][a-z0-9-]{0,62})\/(local|staging|production)\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
        if (!match) fail('invalid_request');
        let body;
        try { body = JSON.parse((await limitedBody(request, UPLOAD_BYTES)).toString('utf8')); } catch { fail('invalid_request'); }
        const [, principalId, project, target, id, capability] = match;
        const result = await rpc(env, project, target, 'uploadBytes', [principalId, { project, target }, id, capability, body],
          registrationObjectName({ id: principalId }, { project, target }));
        return Response.json(result, { headers: browserHeaders });
      }
      if (url.pathname.startsWith('/v1/deliveries/')) return await deliveryHttp(request, url, deliveryRpc);
      const browser = /^\/github-app\/([a-z][a-z0-9-]{0,62})\/(local|staging|production)\//.exec(url.pathname);
      const scoped = browser && config.projects[browser[1]]?.targets[browser[2]]?.githubApp;
      const invokeBrowser = (action, args) => {
        if (!scoped) fail('forbidden');
        return rpc(env, browser[1], browser[2], 'browser', [browser[1], browser[2], action, args]);
      };
      const handler = createBrokerHandler({
        authenticate: bearer => authenticate(config, bearer).id,
        execute(input, bearer) {
          validateOperation(input);
          if (!Object.hasOwn(config.projects, input.project)) {
            const principal = registrationAuthority(config, bearer, input);
            if (!REGISTERED_OPERATIONS.includes(input.operation)) fail('forbidden');
            return rpc(env, input.project, input.target, 'operation', [input, bearer], registrationObjectName(principal, input));
          }
          authorize(config, bearer, input);
          return rpc(env, input.project, input.target, 'operation', [input, bearer]);
        },
        register(input, bearer) {
          validateRegistration(input);
          const principal = registrationAuthority(config, bearer, input);
          return rpc(env, input.project, input.target, 'register', [input, bearer], registrationObjectName(principal, input));
        },
        async upload(input, bearer) {
          validateUpload(input);
          const principal = registrationAuthority(config, bearer, input);
          const output = await rpc(env, input.project, input.target, 'uploadOperation', [input, bearer], registrationObjectName(principal, input));
          if (!output.path) return output;
          const { path, ...metadata } = output;
          return { ...metadata, uploadUrl: env.KIT_BROKER_PUBLIC_ORIGIN + path,
            helperUrl: env.KIT_BROKER_PUBLIC_ORIGIN + '/client/upload-secrets.py',
            helperSha256: createHash('sha256').update(uploadHelper).digest('hex'),
            instructions: 'Save this result as private ticket.json on your computer. Download the helper and verify helperSha256. Run python3 upload-secrets.py --ticket /absolute/ticket.json --secret NAME=/absolute/private/file for every name. The helper uploads file contents directly and prints metadata only. Do not print file contents or put them in tool arguments. Check status with uploadId after an uncertain response.' };
        },
        async deliveries(input, bearer) {
          validateDeliveryQuery(input);
          const principal = authenticate(config, bearer);
          const ids = Object.keys(integrations).filter(id => integrations[id].principal === principal.id && (!input.integration || id === input.integration));
          if (input.integration && !ids.length) fail('forbidden');
          const deliveries = [];
          for (const id of ids) deliveries.push(await deliveryRpc(id, 'status', [], bearer));
          return { operation: 'deliveries', status: 'ready', deliveries };
        },
        previewGitHubApp: (...args) => invokeBrowser('previewGitHubApp', args),
        openGitHubApp: (...args) => invokeBrowser('openGitHubApp', args),
        completeGitHubApp: (...args) => invokeBrowser('completeGitHubApp', args),
      }, { githubAppPrefix: browser ? prefix(browser[1], browser[2]) : '/github-app' });
      const response = await handler.fetch(request);
      if (!response.body) { await handler.close(); return response; }
      const reader = response.body.getReader();
      // Legacy MCP can stream its result. Keep the handler alive until the response is consumed.
      return new Response(new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) { await handler.close(); controller.close(); }
            else controller.enqueue(value);
          } catch { await handler.close(); controller.error(new Error('Broker response unavailable.')); }
        },
        async cancel() { await reader.cancel(); await handler.close(); },
      }), { status: response.status, headers: response.headers });
    } catch (error) { return errorResponse(error); }
  },
};

const browserHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
async function limitedBody(request, max = 32768) {
  if (!request.body) fail('invalid_request');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length; if (size > max) fail('invalid_request');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function deliveryHttp(request, url, invoke) {
  if (url.search) fail('invalid_request');
  const delivery = /^\/v1\/deliveries\/([a-z][a-z0-9-]{0,62})$/.exec(url.pathname);
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!delivery || !token || request.headers.has('origin')) fail('forbidden');
  if (request.method === 'GET') return Response.json(await invoke(delivery[1], 'delivery', [token]), { headers: browserHeaders });
  if (request.method !== 'POST' || request.headers.get('content-type') !== 'application/json') fail('invalid_request');
  let body; try { body = JSON.parse((await limitedBody(request, 1024)).toString('utf8')); } catch { fail('invalid_request'); }
  if (!body || Object.keys(body).length !== 1 || typeof body.deliveryId !== 'string') fail('invalid_request');
  return Response.json(await invoke(delivery[1], 'acknowledge', [token, body.deliveryId]), { headers: browserHeaders });
}
