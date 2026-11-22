/** Document-lifetime values. Never attach URLs, DOM attribution, user IDs or raw entries. */
export type Vital = {
  name: 'CLS' | 'INP' | 'LCP';
  value: number;
  unit: 'score' | 'ms';
  scope: 'document';
};
type Report = (value: Vital) => void;
type Input = { name: string; value: number };

export function safeVital(input: Input): Vital | null {
  if (!['CLS', 'INP', 'LCP'].includes(input.name) || !Number.isFinite(input.value) || input.value < 0) return null;
  return { name: input.name as Vital['name'], value: input.value, unit: input.name === 'CLS' ? 'score' : 'ms', scope: 'document' };
}

/** Register web-vitals once; effect cleanup only removes this consumer, not the shared observers. */
export function createVitalsSubscription(register: (receive: (metric: Input) => void) => void) {
  const listeners = new Map<symbol, Report>();
  let registered = false;
  return (report: Report): (() => void) => {
    const subscription = Symbol();
    listeners.set(subscription, report);
    if (!registered) {
      registered = true;
      try { register((metric) => {
        const value = safeVital(metric);
        if (value) for (const listener of listeners.values()) listener({ ...value });
      }); } catch (error) {
        registered = false;
        listeners.delete(subscription);
        throw error;
      }
    }
    return () => { listeners.delete(subscription); };
  };
}
