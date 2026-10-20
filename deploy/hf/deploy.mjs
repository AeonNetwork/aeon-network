// Deploy Aeon to a Hugging Face Docker Space.
//   node deploy/hf/deploy.mjs            build from the last commit, push, sync secrets
// Needs a Hugging Face "Write" token in .hf-token (gitignored). Secrets are copied from .env
// (plus TUNNEL_TOKEN from the local tunnel config) into the Space settings over the HF API;
// they are never committed or printed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const HF = 'https://huggingface.co';
const SPACE_NAME = process.env.SPACE || 'aeon';
const token = readFileSync(path.join(ROOT, '.hf-token'), 'utf8').trim();
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const hf = async (method, url, body) => {
  const r = await fetch(HF + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok && !(r.status === 409 && url === '/api/repos/create')) throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const me = await hf('GET', '/api/whoami-v2');
const id = `${me.name}/${SPACE_NAME}`;
console.log('account', me.name, '· space', id);

await hf('POST', '/api/repos/create', { type: 'space', name: SPACE_NAME, sdk: 'docker', private: false });

// ---- secrets ----
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
delete env.PORT; // the Space sets its own port
delete env.CACHE_DIR;
const tunnelFile = path.join(homedir(), '.aeon-bin', 'tunnel.json');
if (existsSync(tunnelFile)) env.TUNNEL_TOKEN = JSON.parse(readFileSync(tunnelFile, 'utf8')).token;
let n = 0;
for (const [key, value] of Object.entries(env)) {
  if (!value) continue;
  await hf('POST', `/api/spaces/${id}/secrets`, { key, value });
  n++;
}
console.log('secrets synced:', n);

// ---- code: the last commit + Space files ----
const dir = mkdtempSync(path.join(tmpdir(), 'aeon-hf-'));
const tar = path.join(dir, '..', path.basename(dir) + '.tar');
execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tar, 'HEAD']);
execFileSync('tar', ['-xf', tar, '-C', dir]);
rmSync(tar);
copyFileSync(path.join(ROOT, 'deploy/hf/Dockerfile'), path.join(dir, 'Dockerfile'));
copyFileSync(path.join(ROOT, 'deploy/hf/README.md'), path.join(dir, 'README.md'));
rmSync(path.join(dir, 'brand'), { recursive: true, force: true }); // marketing assets are not needed to run
const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim();
const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'Aeon Network');
git('config', 'user.email', '344883924+AeonNetwork@users.noreply.github.com');
git('add', '-A');
git('commit', '-q', '-m', `Deploy ${sha}`);
git('push', '-q', '--force', `https://${me.name}:${token}@huggingface.co/spaces/${id}`, 'main');
rmSync(dir, { recursive: true, force: true });
console.log(`pushed ${sha} → https://huggingface.co/spaces/${id}`);
console.log(`site → https://${me.name.toLowerCase()}-${SPACE_NAME}.hf.space`);
