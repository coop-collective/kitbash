import { onCLS, onINP, onLCP } from 'web-vitals';
import { createVitalsSubscription } from './vitals.ts';

// Module singleton: development Strict Mode's setup/cleanup/setup must not add duplicate observers.
// Use the library's CLS session windows and INP algorithm instead of summing raw browser entries.
export const subscribeToVitals = createVitalsSubscription((receive) => {
  onCLS(receive, { reportAllChanges: true });
  onINP(receive, { reportAllChanges: true });
  onLCP(receive, { reportAllChanges: true });
});
