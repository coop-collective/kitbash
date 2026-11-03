import { useEffect, useRef, useState } from "react";

/** True when the person asked the OS for reduced motion. Components skip timers-driven flourishes when set. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Calls `callback` every `ms` while `ms` is not null. The latest callback is always used. */
export function useInterval(callback: () => void, ms: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (ms === null) return;
    const id = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/** Seconds elapsed since mount (or since `running` turned true), ticking every 100ms while running. */
export function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const start = useRef<number | null>(null);
  useInterval(() => {
    if (start.current === null) start.current = performance.now() - elapsed * 1000;
    setElapsed((performance.now() - start.current) / 1000);
  }, running ? 100 : null);
  useEffect(() => {
    if (!running) start.current = null;
  }, [running]);
  return elapsed;
}

/** Format seconds as 4.2s / 1m 05s. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
