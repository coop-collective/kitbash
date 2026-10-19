const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
const byId = (id) => document.getElementById(id);
let revision = 0;

async function api(path, init) {
  return fetch(path, { credentials: 'same-origin', ...init });
}

function showApp(user) {
  byId('login-section').hidden = !!user;
  byId('app-section').hidden = !user;
  byId('whoami').textContent = user ? user.email : '';
  if (!user) {
    for (const id of ['profile-status', 'report-status']) $(id).textContent = '';
    byId('upload-status').textContent = '';
    $('upload-download').hidden = true;
    $('upload-download').removeAttribute('href');
    $('upload-file').value = '';
    $('login-password').value = '';
    $('profile-handle').value = $('profile-display-name').value = $('profile-bio').value = '';
  }
}

async function loadProfile() {
  const res = await api('/api/profile');
  if (!res.ok) return;
  const data = await res.json();
  revision = data.revision;
  $('profile-handle').value = data.profile.handle;
  $('profile-display-name').value = data.profile.display_name;
  $('profile-bio').value = data.profile.bio;
}

async function refreshReport() {
  const res = await api('/api/report');
  if (!res.ok) { $('report-status').textContent = 'Report failed'; return; }
  const r = await res.json();
  $('report-status').textContent = `${r.displayName} (revision ${r.revision}, ${r.cacheTier})`;
}

async function boot() {
  const res = await api('/api/session');
  if (!res.ok) return showApp(null);
  showApp((await res.json()).user);
  await loadProfile();
}

byId('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: $('login-email').value, password: $('login-password').value }),
  });
  byId('login-status').textContent = res.ok ? '' : 'Login failed';
  if (res.ok) { showApp((await res.json()).user); await loadProfile(); }
});

byId('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api('/api/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      handle: $('profile-handle').value,
      display_name: $('profile-display-name').value,
      bio: $('profile-bio').value,
      avatar_id: null,
      is_public: false,
      revision,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    revision = data.revision;
    $('profile-status').textContent = `Saved (revision ${data.revision})`;
  } else if (res.status === 409) {
    $('profile-status').textContent = 'Conflict: profile changed elsewhere, reloaded';
    await loadProfile();
  } else {
    $('profile-status').textContent = `Error: ${data.error || res.status}`;
  }
});

byId('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('upload-file').files[0];
  if (!file) { byId('upload-status').textContent = 'Choose a file first'; return; }
  const res = await api('/api/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) { byId('upload-status').textContent = res.status === 413 ? 'File too large (max 1 MiB)' : 'Upload failed'; return; }
  const { id } = await res.json();
  const link = $('upload-download');
  link.href = `/api/uploads/${id}`;
  link.setAttribute('download', file.name || `upload-${id}.bin`);
  link.hidden = false;
  byId('upload-status').textContent = 'Uploaded';
});

$('report-refresh').addEventListener('click', refreshReport);

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showApp(null);
});

boot();
