// npm run check — try the whole app before publishing, without touching your data.
//
// Starts a throwaway copy of the Nest on http://127.0.0.1:8799 with its own empty database
// (.wrangler/check-state, wiped each time), runs scripts/check-tests.mjs against it, then stops it.
// Your laptop data (.wrangler/state) and the online site are never used.
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

const PORT = 8799;
const STATE = '.wrangler/check-state';
const VARS = '.wrangler/check.vars';
const SETUP_FILES = ['schema.sql', 'seed/recipes.sql', 'seed/family.sql', 'phase2.sql', 'seed/phase2.sql'];
const READY_TIMEOUT_MS = 90_000;

const say = (s) => console.log(`\n\x1b[32m▶ ${s}\x1b[0m`);
const run = (cmd) => spawnSync(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });

async function main() {
  say('Making a throwaway database…');
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync('.wrangler', { recursive: true });
  for (const f of SETUP_FILES) {
    const r = run(`npx wrangler d1 execute stewart-nest --local --persist-to=${STATE} --yes --file=${f}`);
    if (r.status !== 0) throw new Error(`Setting up ${f} failed:\n${(r.stderr || r.stdout).slice(-800)}`);
  }
  // test-only keys for phone notifications
  const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  writeFileSync(VARS, `VAPID_PUBLIC=${pub}\nVAPID_PRIVATE=${jwk.d}\n`);

  say(`Starting the test copy on port ${PORT}…`);
  const server = spawn(`npx wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to=${STATE} --env-file=${VARS} --var LOCAL_DEV:1 --test-scheduled`, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  const stop = () => {
    if (process.platform === 'win32') spawnSync(`taskkill /pid ${server.pid} /T /F`, { shell: true, stdio: 'ignore' });
    else server.kill('SIGTERM');
  };
  try {
    const t0 = Date.now();
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/api/users`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() - t0 > READY_TIMEOUT_MS) throw new Error('The test copy did not start:\n' + log.slice(-1500));
      await new Promise((r) => setTimeout(r, 1000));
    }
    say('Running the checks…');
    const t = spawnSync(process.execPath, ['scripts/check-tests.mjs'], { stdio: 'inherit', env: { ...process.env, BASE: `http://127.0.0.1:${PORT}` } });
    const errors = log.split('\n').filter((l) => /ERROR|Uncaught/.test(l) && !/push failed/.test(l));
    if (errors.length) { console.log('\nServer errors during the checks:'); errors.slice(0, 15).forEach((l) => console.log('  ' + l)); }
    process.exitCode = t.status || (errors.length ? 1 : 0);
    console.log(process.exitCode ? '\n\x1b[31m✖ Something needs fixing before you publish.\x1b[0m' : '\n\x1b[32m✔ All good. Safe to publish.\x1b[0m');
  } finally { stop(); }
}
main().catch((e) => { console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m`); process.exitCode = 1; });
