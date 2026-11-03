// The browser DOM lib and Wrangler runtime types declare the same global names.
// TypeScript selects the DOM interfaces for these two APIs in a fullstack app;
// merge the Workers extensions emitted by `wrangler types` back into those names.
// These APIs are server-only: do not call them from a client component.
interface CacheStorage {
  readonly default: Cache;
}

interface SubtleCrypto {
  timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
}
