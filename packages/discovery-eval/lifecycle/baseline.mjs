import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, sourceFiles } from './snapshots.mjs';

// Keep the original measured v2 artifact immutable. This one common correction
// is applied before any lifecycle arm receives its starting application.
export const originalHomepageSha256 = 'eb4397c8e6e1611d660f244043cf05a2781e648696b08055c2f4927d94fadba2';

export function fixBaselineHomepage(source) {
  if (sha256(source) !== originalHomepageSha256) throw new Error('Lifecycle baseline homepage differs from the frozen v2 source');
  return source.replace(
    `async function loadProfile() {
  const r = await api('/api/profile');
  if (!r.ok) return;
  const d = await r.json();
  revision = d.revision;
  $('profile-handle').value = d.profile.handle;
  $('profile-display-name').value = d.profile.display_name;
  $('profile-bio').value = d.profile.bio;
}`,
    `// A delayed profile response must not overwrite an edit made while loading.
function setProfileBusy(busy) {
  for (const id of ['profile-handle', 'profile-display-name', 'profile-bio', 'profile-save']) $(id).disabled = busy;
}

async function loadProfile() {
  setProfileBusy(true);
  try {
    const r = await api('/api/profile');
    if (!r.ok) return;
    const d = await r.json();
    revision = d.revision;
    $('profile-handle').value = d.profile.handle;
    $('profile-display-name').value = d.profile.display_name;
    $('profile-bio').value = d.profile.bio;
  } finally {
    setProfileBusy(false);
  }
}`,
  ).replace(
    `  if (r.ok) {
    show((await r.json()).user);
    await loadProfile();`,
    `  if (r.ok) {
    setProfileBusy(true);
    const user = (await r.json()).user;
    await loadProfile();
    show(user);`,
  );
}

/** Copy the common source into a fresh directory, correcting only the known UI race. */
export async function copyLifecycleBaseline(source, destination) {
  const originalFiles = await sourceFiles(source);
  const homepage = originalFiles.find((file) => file.path === 'public/index.html');
  if (homepage?.sha256 !== originalHomepageSha256) throw new Error('Unexpected lifecycle baseline homepage');
  await mkdir(destination, { recursive: false });
  for (const file of originalFiles) {
    const body = await readFile(path.join(source, file.path));
    if (sha256(body) !== file.sha256) throw new Error(`Baseline changed while copying: ${file.path}`);
    const target = path.join(destination, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.path === 'public/index.html' ? fixBaselineHomepage(body.toString('utf8')) : body, { flag: 'wx' });
  }
  const files = await sourceFiles(destination);
  return { sourceSha256: sha256(JSON.stringify(originalFiles)), sha256: sha256(JSON.stringify(files)), files };
}
