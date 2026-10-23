# Provisioning adapters

`src/provision.mjs` runs inside the trusted broker. It accepts owner-controlled policy and injected provider clients; none of its functions return credentials, provider response bodies, or generated identity IDs. Keep its checkpoints and provider credentials outside agent-controlled files and processes.

The broker calls:

```js
await provisionGitHub(scope, { infisical, github, checkpoint: githubCheckpoint });
await connectCloudflare(scope, {
  infisical,
  checkpoint: connectionCheckpoint,
  credentials: { accountId: brokerAccountId, apiToken: brokerApiToken },
});
const connectedScope = {
  ...scope,
  cloudflare: { ...scope.cloudflare, connectionId: connectionCheckpoint.state.connectionId },
};
await provisionWorkerSync(connectedScope, { infisical, checkpoint: syncCheckpoint });
// For a manual sync, if automatic synchronization is disabled:
await requestWorkerSync(connectedScope, { infisical, checkpoint: syncCheckpoint });
```

Clients accept `(path, { method, query, body })` and return parsed JSON. They must bind a fixed provider origin, reject redirects, suppress provider bodies in errors, and represent an HTTP failure with a numeric `status`. Each checkpoint is `{ state: {}, save: async () => persistState() }`, with separate state for GitHub access, the Cloudflare connection, and Worker sync per target. The broker must serialize operations on a target.

A scope has `projectId`, `projectSlug`, `domain` (HTTPS origin), `environment` (Infisical slug), and `secretPath`. GitHub configuration requires `repository`, `environment` (`staging` or `production`), `ref`, `workflow`, `identityName`, and `roleSlug`. Optional `audience` defaults to `kitbash:OWNER/REPO:ENVIRONMENT`. Optional `subject` adds an exact subject restriction if explicitly configured. By default, the adapter leaves the subject restriction empty and binds immutable repository and owner IDs, exact repository, branch ref, workflow path/ref, environment, and `workflow_dispatch` event individually. This works with GitHub's legacy, customized, and immutable subject formats without guessing or changing repository OIDC settings. GitHub introduced immutable default subjects for new/renamed/transferred repositories after July 15, 2026. Tokens expire after 15 minutes.

GitHub setup creates a project-managed Infisical identity and a custom role with only `describeSecret` and `readValue` in the exact selected environment's `/ci` and runtime folder. It creates environment-scoped `INFISICAL_IDENTITY_ID`, `INFISICAL_PROJECT_SLUG`, `INFISICAL_DOMAIN`, `INFISICAL_OIDC_AUDIENCE`, `INFISICAL_ENVIRONMENT_SLUG`, and `INFISICAL_SECRET_PATH` variables. The last two map the GitHub environment to the exact Infisical source scope. The workflow must use that audience and request `id-token: write`. It creates a missing staging environment with an exact branch rule; existing environment protections are preserved. Production must already have required reviewers with self-review disabled. GitHub plan support for deployment protections varies.

The broker credential needs project role creation/read, project identity creation/read, permission to assign the custom role, and identity auth configuration. Infisical custom-role availability depends on the instance's RBAC entitlement; failure never falls back to a project-wide reader or admin role. GitHub access needs repository metadata, Actions read, and Environments write for the configured repository. No GitHub Actions secret is created: OIDC provides the runtime identity.

Cloudflare configuration requires `connectionId` or `connectionName`, `workerName`, and `syncName`. A connection name allows the broker to create a project-scoped Infisical connection directly using its Cloudflare account ID and API token. An explicitly configured connection ID is verified as a project-scoped Cloudflare API-token connection. The account credential must permit the intended Workers secret operations; this adapter does not mint new Cloudflare account credentials. The Infisical broker identity needs app connection create/read/connect and secret sync create/read/sync permissions in the target project.

Worker sync uses an existing Worker script. `autoSync: true` enables Infisical synchronization, including the initial asynchronous job; omitted/false creates a manual sync only. The adapter disables destination secret deletion, nested-folder synchronization, and nonsecret binding updates. It never imports destination values into the vault. Native sync sends the source folder's secrets according to Infisical behavior; dedicate that folder to runtime secrets and do not import deployment credentials into it. A successful configuration response does not prove that an asynchronous sync completed. The explicit sync endpoint returns `pending`, and operators can inspect Infisical's sync job status without exposing its raw messages to the agent.

Cloudflare app connections currently do not support automatic credential rotation. This is distinct from Infisical's separate Cloudflare API-token/R2 secret-rotation providers. Do not claim that creating a connection rotates the broker's provider credential.

Each mutation saves an intent before calling a provider and saves returned resource IDs immediately. If a write or checkpoint cannot be confirmed, subsequent calls stop with `provision_reconciliation_required`. An operator inspects the provider and private checkpoint, restores the matching resource IDs or confirms no resource was created, then clears the pending intent. The adapter does not guess, automatically retry ambiguous writes, adopt conflicting names, overwrite GitHub variables, or silently widen an existing role. This also makes an interrupted multi-provider setup recoverable without regenerating application secrets.

API contracts were checked against the [live Infisical OpenAPI](https://app.infisical.com/api/docs/json), [OIDC guide](https://infisical.com/docs/documentation/platform/identities/oidc-auth/github), [project roles API](https://infisical.com/docs/api-reference/endpoints/project-roles/create), [Cloudflare connection API](https://infisical.com/docs/api-reference/endpoints/app-connections/cloudflare/create), [Workers sync API](https://infisical.com/docs/api-reference/endpoints/secret-syncs/cloudflare-workers/create), [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc), [environment variables API](https://docs.github.com/en/rest/actions/variables#create-an-environment-variable), and [deployment branch policies API](https://docs.github.com/en/rest/deployments/branch-policies).
