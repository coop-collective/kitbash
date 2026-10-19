export function validateProjects(projects) {
  if (!Array.isArray(projects) || projects.length === 0) throw new Error("projects must be non-empty");
  const names = new Set();
  const paths = new Set();
  for (const project of projects) {
    if (typeof project.name !== "string" || !project.name || names.has(project.name)) throw new Error("project names must be unique");
    if (typeof project.path !== "string" || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(project.path)
      || project.path.split("/").some(part => part === "." || part === "..") || paths.has(project.path)) throw new Error("invalid project path");
    if (!Array.isArray(project.dependsOn) || project.dependsOn.some(name => typeof name !== "string")) throw new Error("dependsOn must list project names");
    names.add(project.name); paths.add(project.path);
  }
  for (const project of projects) {
    if (project.dependsOn.some(name => !names.has(name))) throw new Error("unknown project dependency");
  }
  return projects;
}

// null means no trustworthy diff: fail open to a complete check, never silently skip.
export function selectProjects(projects, changed) {
  validateProjects(projects);
  if (changed === null) return projects;
  const selected = new Set();
  for (const file of changed) {
    const owners = projects.filter(project => file.startsWith(`${project.path}/`));
    if (owners.length === 0) return projects;
    for (const project of owners) selected.add(project.name);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const project of projects) {
      if (!selected.has(project.name) && project.dependsOn.some(name => selected.has(name))) {
        selected.add(project.name); grew = true;
      }
    }
  }
  return projects.filter(project => selected.has(project.name));
}

export async function runBounded(items, concurrency, run) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error("concurrency must be 1..32");
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await run(items[index]); }
      catch { results[index] = 1; }
    }
  }));
  return results;
}
