// The Stewart Nest — publish to Cloudflare (run with: node scripts/publish.mjs, or double-click "Publish to Cloudflare.bat")
//
// What it does, step by step (safe to run again any time — it skips what's already done):
//   1. Makes sure you're logged in to Cloudflare (opens the browser the first time)
//   2. Creates the online database (D1) if needed and writes its id into wrangler.jsonc
//   3. Creates the photo storage bucket (R2) if needed
//   4. If the online database is empty: copies your laptop's data up (or starts fresh)
//   5. Publishes the app, and once stewartza.co.za is Active in Cloudflare, puts it on your domain
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const DOMAIN = 'stewartza.co.za';
const DB = 'stewart-nest';
const BUCKET = 'stewart-nest-photos';
const CONFIG = 'wrangler.jsonc';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = 'y') => {
  const a = (await rl.question(`${q} ${def === 'y' ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
  return a ? a.startsWith('y') : def === 'y';
};
const say = (s) => console.log(`\n\x1b[32m▶ ${s}\x1b[0m`);
const warn = (s) => console.log(`\x1b[33m⚠ ${s}\x1b[0m`);
const run = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true, ...opts });
const live = (cmd) => spawnSync(cmd, { stdio: 'inherit', shell: true }).status === 0;
const tryRun = (cmd) => { try { return { ok: true, out: run(cmd) }; } catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` }; } };

async function main() {
  console.log('\n🪺  Publishing The Stewart Nest to Cloudflare\n');

  // 1. login
  say('Checking your Cloudflare login…');
  const who = tryRun('npx wrangler whoami');
  if (!who.ok || /not authenticated|You are not logged in/i.test(who.out)) {
    console.log('A browser window will open — log in to Cloudflare and click "Allow".');
    if (!live('npx wrangler login')) throw new Error('Cloudflare login did not finish.');
  } else console.log('Logged in ✔');

  // 2. database
  say('Online database (D1)…');
  const list = () => JSON.parse(run('npx wrangler d1 list --json'));
  let db = list().find((d) => d.name === DB);
  if (!db) {
    console.log('Creating it…');
    run(`npx wrangler d1 create ${DB}`);
    db = list().find((d) => d.name === DB);
  }
  if (!db) throw new Error('Could not create or find the database.');
  let cfg = readFileSync(CONFIG, 'utf8');
  if (!cfg.includes(db.uuid)) {
    cfg = cfg.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${db.uuid}"`);
    console.log(`Saved database id ${db.uuid} in ${CONFIG} ✔`);
  } else console.log('Ready ✔');
  // The laptop's own data is stored under the original placeholder id — keep using it for local runs and exports
  if (!/"preview_database_id"/.test(cfg)) {
    cfg = cfg.replace(/("database_id":\s*"[^"]*")/, `$1,\n      // the laptop copy of the data (local runs) — keep this line\n      "preview_database_id": "00000000-0000-0000-0000-000000000000"`);
  }
  writeFileSync(CONFIG, cfg);

  // 3. photo storage
  say('Photo storage (R2)…');
  const buckets = tryRun('npx wrangler r2 bucket list');
  if (!buckets.ok || !buckets.out.includes(BUCKET)) {
    const made = tryRun(`npx wrangler r2 bucket create ${BUCKET}`);
    if (!made.ok && !/already exists/i.test(made.out)) {
      warn('Photo storage could not be created. Cloudflare asks you to switch R2 on once:');
      console.log('   Cloudflare dashboard → R2 Object Storage → "Enable R2" (free tier; it asks for a card but the free 10 GB costs nothing).');
      console.log('   Then run this again.');
      if (/R2|enable|10042/i.test(made.out)) throw new Error('R2 not enabled yet.');
      throw new Error(made.out.split('\n').slice(-6).join('\n'));
    }
    console.log('Created ✔');
  } else console.log('Ready ✔');

  // 4. data
  say('Checking the online database…');
  const check = tryRun(`npx wrangler d1 execute ${DB} --remote --json --command "SELECT COUNT(*) AS n FROM users"`);
  const empty = !check.ok || /no such table/i.test(check.out);
  if (empty) {
    const hasLocal = existsSync('.wrangler/state');
    if (hasLocal && await ask('The online database is empty. Copy everything from this laptop (logins, tasks, recipes, events…) up to it?')) {
      if (!existsSync('backups')) mkdirSync('backups');
      const file = `backups/nest-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.sql`;
      console.log('Exporting laptop data…');
      run(`npx wrangler d1 export ${DB} --local --output=${file}`);
      console.log('Uploading it (takes a minute)…');
      if (!live(`npx wrangler d1 execute ${DB} --remote --yes --file=${file}`)) throw new Error('Upload of the data failed. Your laptop data is untouched; the backup is in ' + file);
      const verify = tryRun(`npx wrangler d1 execute ${DB} --remote --json --command "SELECT COUNT(*) AS n FROM users"`);
      if (!verify.ok || /no such table/i.test(verify.out)) throw new Error('The upload finished but the online database still looks empty. Backup file: ' + file);
      console.log(`Copied ✔ (backup kept in ${file})`);
      warn('Photos stay on the laptop: upload your favourite ones again once the app is online.');
    } else {
      console.log('Starting fresh online (recipes, family, chores, schedule)…');
      if (!live('npm run db:remote:reset')) throw new Error('Setting up the online database failed.');
      const verify = tryRun(`npx wrangler d1 execute ${DB} --remote --json --command "SELECT COUNT(*) AS n FROM users"`);
      if (!verify.ok || /no such table/i.test(verify.out)) throw new Error('Setup finished but the online database still looks empty.');
    }
  } else console.log('Already has data ✔ (left as is)');
  if (empty) console.log('Online database ready ✔');

  // 5. publish
  const hasDomain = /"custom_domain":\s*true/.test(readFileSync(CONFIG, 'utf8'));
  if (!hasDomain) {
    const active = await ask(`Is ${DOMAIN} showing "Active" in your Cloudflare dashboard yet?`, 'n');
    if (active) {
      let c = readFileSync(CONFIG, 'utf8');
      c = c.replace(/\n}\s*$/, `,\n  // the family's own address\n  "routes": [\n    { "pattern": "${DOMAIN}", "custom_domain": true },\n    { "pattern": "www.${DOMAIN}", "custom_domain": true }\n  ]\n}\n`);
      writeFileSync(CONFIG, c);
      console.log(`Added ${DOMAIN} and www.${DOMAIN} to ${CONFIG} ✔`);
    } else {
      console.log('No problem — publishing on a temporary workers.dev address for now. Run this again once the domain is Active.');
    }
  }
  say('Publishing the app…');
  console.log('(If Cloudflare asks whether to replace an existing DNS record for the domain, answer y.)\n');
  if (!live('npx wrangler deploy')) throw new Error('Publishing failed (see above).');
  const onDomain = /"custom_domain":\s*true/.test(readFileSync(CONFIG, 'utf8'));
  console.log(`\n🎉  The Stewart Nest is online${onDomain ? ` at https://${DOMAIN}` : ' (see the workers.dev address above)'}`);
  console.log('    Log in with the same passwords as on the laptop (or set them up again if you started fresh).');
  console.log('    On phones: open it in Chrome/Safari → "Add to Home screen".\n');
}

main().catch((e) => { console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m\n`); process.exitCode = 1; }).finally(() => rl.close());
