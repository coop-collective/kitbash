import { spawn } from 'node:child_process';
import { run } from './deployment.mjs';

// Only called from the operator's interactive terminal, before setup creates its readline prompt.
export function loginGitHub({ env }) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--web', '--skip-ssh-key'], {
      env, shell: false, stdio: ['inherit', 2, 2],
    });
    const failed = () => reject(new Error('GitHub login did not complete. Rerun setup to try again.'));
    child.once('error', failed);
    child.once('close', code => code === 0 ? resolve() : failed());
  });
}

export async function ensureGitHubAuth({ env = process.env, runner = run, login, note = () => {} } = {}) {
  try { await runner('gh', ['--version'], { env }); }
  catch { throw new Error('GitHub CLI (gh) is required. Install it, then rerun pnpm run setup.'); }
  const check = () => runner('gh', ['auth', 'status', '--active', '--hostname', 'github.com'], { env });
  try { await check(); }
  catch {
    if (env.GH_TOKEN || env.GITHUB_TOKEN) throw new Error('GitHub authentication failed for the supplied GH_TOKEN/GITHUB_TOKEN. Update or unset it, then rerun setup.');
    if (!login) throw new Error('GitHub login is required. Run pnpm run setup interactively to sign in.');
    note('GitHub is not authenticated. Starting the GitHub login prompt…');
    await login({ env });
    try { await check(); }
    catch { throw new Error('GitHub authentication still failed after login. Check the account and connection, then rerun setup.'); }
  }
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || (await runner('gh', ['auth', 'token', '--hostname', 'github.com'], { env })).trim();
  if (!token) throw new Error('GitHub did not provide an authenticated credential. Rerun setup to check login.');
  return token;
}
