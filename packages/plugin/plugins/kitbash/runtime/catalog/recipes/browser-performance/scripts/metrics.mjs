// CLS is the largest session window: gaps <1s and total window <5s, excluding recent input.
export function clsSessionMax(entries) {
  let maximum = 0, current = 0, first = 0, previous = 0, active = false;
  for (const entry of [...entries].sort((a, b) => a.startTime - b.startTime)) {
    if (entry.hadRecentInput || !Number.isFinite(entry.value) || entry.value < 0) continue;
    if (active && entry.startTime - previous < 1000 && entry.startTime - first < 5000) current += entry.value;
    else { current = entry.value; first = entry.startTime; active = true; }
    previous = entry.startTime;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}
export function budgetFailures(sample, budgets) {
  for (const key of Object.keys(budgets)) if (!['readyMs', 'lcpMs', 'cls', 'exceptions', 'unknownRequests', 'requests', 'assets'].includes(key)) throw Error('Unknown budget: ' + key);
  const failures = [];
  const check = (name, value, limit) => {
    if (!Number.isFinite(limit) || limit < 0) throw Error(`Invalid budget: ${name}`);
    if (!Number.isFinite(value) || value > limit) failures.push(`${name}: ${value ?? 'missing'} exceeds ${limit}`);
  };
  for (const name of ['readyMs', 'lcpMs', 'cls', 'exceptions', 'unknownRequests']) {
    if (name in budgets) check(name, sample[name], budgets[name]);
  }
  for (const [name, limit] of Object.entries(budgets.requests ?? {})) check(`requests.${name}`, sample.requests[name], limit);
  for (const [name, limit] of Object.entries(budgets.assets ?? {})) {
    const asset = sample.assets[name];
    // Missing entries must not look like a zero-byte cache hit.
    if (!asset?.count) failures.push(`assets.${name}: missing`);
    else check(`assets.${name}`, asset.transferBytes, limit);
  }
  return failures;
}
