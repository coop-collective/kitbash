import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * A small stale-while-revalidate cache for component data. Cached data shows at once, a stale entry refreshes in
 * the background, and concurrent loads of the same key share one request. Server rendering reads the cache but
 * never starts a load, so `primeCache` on the server and the same key on the client hydrate without a flash.
 */

export type LoadStatus = "loading" | "ready" | "refreshing" | "error";

export interface CachedState<T> {
  data: T | undefined;
  error: unknown;
  /** loading: nothing to show yet; refreshing: showing cached data while a new copy loads */
  status: LoadStatus;
  /** When the shown data was loaded (ms since epoch), or null before the first load */
  updatedAt: number | null;
  /** Load again now, keeping the current data on screen */
  refresh: () => void;
}

interface Snapshot {
  data: unknown;
  error: unknown;
  updatedAt: number | null;
  inFlight: boolean;
}

interface Entry {
  snapshot: Snapshot;
  promise: Promise<unknown> | null;
  listeners: Set<() => void>;
}

const EMPTY: Snapshot = { data: undefined, error: undefined, updatedAt: null, inFlight: false };
const cache = new Map<string, Entry>();

function entry(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { snapshot: EMPTY, promise: null, listeners: new Set() };
    cache.set(key, e);
  }
  return e;
}

function update(key: string, patch: Partial<Snapshot>): void {
  const e = entry(key);
  e.snapshot = { ...e.snapshot, ...patch };
  e.listeners.forEach((fn) => fn());
}

function start<T>(key: string, load: () => Promise<T>): Promise<T> {
  const e = entry(key);
  if (e.promise) return e.promise as Promise<T>;
  update(key, { inFlight: true });
  const promise = load().then(
    (data) => {
      e.promise = null;
      update(key, { data, error: undefined, updatedAt: Date.now(), inFlight: false });
      return data;
    },
    (error: unknown) => {
      e.promise = null;
      update(key, { error, inFlight: false });
      throw error;
    },
  );
  e.promise = promise;
  // A failed background refresh is shown through `error`; it must not surface as an unhandled rejection
  promise.catch(() => {});
  return promise;
}

/**
 * Seed the cache, e.g. with data rendered on the server or fixtures in a story. It is safe to call during render:
 * it only writes when the key is empty or holds older data, so repeated renders do not notify subscribers again.
 */
export function primeCache<T>(key: string, data: T, updatedAt: number = Date.now()): void {
  const current = entry(key).snapshot;
  if (current.data !== undefined && (current.updatedAt ?? 0) >= updatedAt) return;
  update(key, { data, error: undefined, updatedAt, inFlight: false });
}

/** Mark a key stale so the next reader reloads it; the current data stays on screen meanwhile. */
export function invalidate(key: string): void {
  const e = cache.get(key);
  if (e) update(key, { updatedAt: 0 });
}

/** Load (or reuse) the data for `key`. Pass `null` as the key to wait, e.g. until an id is known. */
export function useCachedLoader<T>(key: string | null, load: () => Promise<T>, { maxAge = 30_000 }: { maxAge?: number } = {}): CachedState<T> {
  const subscribe = useCallback(
    (fn: () => void) => {
      if (!key) return () => {};
      const e = entry(key);
      e.listeners.add(fn);
      return () => {
        e.listeners.delete(fn);
      };
    },
    [key],
  );
  const read = () => (key ? entry(key).snapshot : EMPTY);
  const snap = useSyncExternalStore(subscribe, read, read);

  useEffect(() => {
    if (!key) return;
    const s = entry(key).snapshot;
    const stale = s.updatedAt === null || Date.now() - s.updatedAt > maxAge;
    if (stale && !s.inFlight) start(key, load).catch(() => {});
    // `load` is deliberately not a dependency: callers pass inline functions, and the key names the data
  }, [key, maxAge]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    if (key) start(key, load).catch(() => {});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasData = snap.data !== undefined;
  const status: LoadStatus = snap.inFlight ? (hasData ? "refreshing" : "loading") : snap.error && !hasData ? "error" : hasData ? "ready" : "loading";
  return { data: snap.data as T | undefined, error: snap.error, status, updatedAt: snap.updatedAt || null, refresh };
}

/** The current time, re-read every `ms` so relative labels ("2m ago") stay true. Null during server render. */
export function useNow(ms = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** "just now", "4m ago", "2h ago", then a short date. */
export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "14:02" in the viewer's locale */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
