'use client';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { subscribeToVitals } from './browser.ts';
import type { Vital } from './vitals.ts';

/** Mount once in a client boundary near the root. The parent must pass a stable callback. */
export function Vitals({ onMetric }: { onMetric: (metric: Vital) => void }) {
  useEffect(() => subscribeToVitals(onMetric), [onMetric]);
  return null;
}

/** StrictMode checks run only in development; this is not a performance benchmark wrapper. */
export function DevelopmentChecks({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}
