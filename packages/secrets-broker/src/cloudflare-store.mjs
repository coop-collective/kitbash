import { requestJson } from './api.mjs';
import { fail } from './errors.mjs';
import { NAME } from './config.mjs';

const ID = /^[a-f0-9]{32}$/;

/** Write-only values, metadata-only reads. Destinations come exclusively from
 * the operator policy; the agent cannot select an account, store, or prefix. */
export function cloudflareSecretStore(scope, { token, request = fetch } = {}) {
  if (!ID.test(scope.accountId ?? '') || !ID.test(scope.storeId ?? '') ||
      !/^[A-Z][A-Z0-9_]{0,79}_$/.test(scope.secretPrefix ?? '')) fail('invalid_request');
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) fail('unavailable');
  const base = `https://api.cloudflare.com/client/v4/accounts/${scope.accountId}/secrets_store/stores/${scope.storeId}/secrets`;
  const call = async (method, query, body) => {
    const url = new URL(base);
    if (query) url.search = new URLSearchParams(query).toString();
    const response = await requestJson(url, { method, body, request, headers: { authorization: `Bearer ${token}` } });
    if (response.success !== true || !Array.isArray(response.result)) fail('provider_failed');
    return response;
  };
  function check(row) {
    if (!row || !ID.test(row.id ?? '') || row.store_id !== scope.storeId || typeof row.name !== 'string' ||
        !['active', 'pending', 'deleted'].includes(row.status)) fail('provider_failed');
  }
  const storage = {
    async listNames() {
      const names = new Set();
      for (let page = 1; page <= 100; page++) {
        const response = await call('GET', { page: String(page), per_page: '100', search: scope.secretPrefix });
        for (const row of response.result) {
          check(row);
          // Cloudflare's search is a substring search over name AND comment.
          if (!row.name.startsWith(scope.secretPrefix) || row.status === 'deleted') continue;
          const name = row.name.slice(scope.secretPrefix.length);
          if (!NAME.test(name) || names.has(name)) fail('provider_failed');
          names.add(name);
        }
        const pages = response.result_info?.total_pages;
        if (pages !== undefined && (!Number.isInteger(pages) || pages < 0 || pages > 100)) fail('provider_failed');
        if (pages !== undefined ? page >= pages : response.result.length < 100) return names;
      }
      fail('provider_failed');
    },
    async createMany(entries) {
      if (!entries.length || entries.some(entry => !NAME.test(entry.name) || typeof entry.value !== 'string') ||
          new Set(entries.map(entry => entry.name)).size !== entries.length) fail('invalid_request');
      const response = await call('POST', undefined, entries.map(entry => ({
        name: scope.secretPrefix + entry.name, value: entry.value, scopes: ['workers'],
      })));
      if (response.result.length !== entries.length) fail('provider_failed');
      const expected = new Set(entries.map(entry => scope.secretPrefix + entry.name));
      for (const row of response.result) {
        check(row);
        // Cloudflare accepts writes as pending while they propagate. They already
        // reserve the name; the service verifies metadata before reporting creation.
        if (row.status === 'deleted' || !expected.delete(row.name)) fail('provider_failed');
      }
    },
  };
  return storage;
}
