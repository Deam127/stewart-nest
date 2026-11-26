// Build the Android app (APK) for The Stewart Nest — run with "Build Android App.bat" or: node scripts/build-android.mjs
//
// It's a Trusted Web Activity: a small Android app that opens https://stewartza.co.za full-screen in Chrome,
// with its own icon, splash screen, shortcuts and notifications. Built with Google's Bubblewrap tool.
//
// What happens:
//   1. Bubblewrap checks for Java and the Android tools; the first time it offers to download them (asks you first).
//   2. You choose a password for the app's signing key (only the first time) — every update must be signed with
//      the same key, so keep android/nest-release.keystore and that password safe (e.g. Google Drive).
//   3. The Android project is (re)made from android/twa-manifest.json and built: "Stewart Nest.apk" appears here.
//   4. src/assetlinks.json is written with the key's fingerprint. Run "Publish to Cloudflare.bat" afterwards,
//      so the website vouches for the app and it opens without the browser bar.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createInterface } from 'node:readline';

const BUBBLEWRAP = 'npx -y @bubblewrap/cli@1.28.0';
const DIR = resolve('android');
const TWA = join(DIR, 'twa-manifest.json');
const KEYSTORE = join(DIR, 'nest-release.keystore');
const ALIAS = 'nest';
const OUT_APK = resolve('Stewart Nest.apk');
const ASSETLINKS = resolve('src', 'assetlinks.json');
const PUBLIC_APK = resolve('public', 'app', 'stewart-nest.apk'); // the download page: stewartza.co.za/app
const MIN_PASSWORD = 6;

const say = (s) => console.log(`\n\x1b[32m▶ ${s}\x1b[0m`);
const warn = (s) => console.log(`\x1b[33m⚠ ${s}\x1b[0m`);
// Bubblewrap runs "gradlew.bat" from the project folder; make sure Windows looks in the current folder for it
const baseEnv = () => { const e = { ...process.env }; delete e.NoDefaultCurrentDirectoryInExePath; return e; };
const live = (cmd, opts = {}) => spawnSync(cmd, { shell: true, stdio: 'inherit', ...opts, env: { ...baseEnv(), ...(opts.env || {}) } }).status === 0;

// ask without showing what's typed
function askHidden(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else if (s.includes('\n') || s.includes('\r')) rl.output.write('\n'); };
    rl.question(question, (a) => { rl.close(); res(a); });
  });
}
function keytoolPath() {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.bubblewrap', 'config.json'), 'utf8'));
    const k = join(cfg.jdkPath, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
    if (existsSync(k)) return `"${k}"`;
  } catch { /* fall through */ }
  return 'keytool'; // a Java on the PATH
}

async function main() {
  console.log('\n📱  Building the Android app for The Stewart Nest\n');

  // Bubblewrap copies the icons from the live website, so they must be online (Publish to Cloudflare first)
  const cfg = JSON.parse(readFileSync(TWA, 'utf8'));
  for (const u of [cfg.iconUrl, cfg.maskableIconUrl].filter(Boolean)) {
    let type = '';
    try { type = (await fetch(u, { method: 'HEAD' })).headers.get('content-type') || ''; } catch { /* offline */ }
    if (!type.startsWith('image/')) throw new Error(`The app icon ${u} isn't on the website yet. Run "Publish to Cloudflare.bat" first, then this again.`);
  }

  // a new computer: let Bubblewrap install Java and the Android tools first (it needs them for the signing key too)
  if (!existsSync(join(homedir(), '.bubblewrap', 'config.json'))) {
    say('Setting up Java and the Android tools (about 500 MB, only once): answer yes and accept the licences…');
    if (!live(`${BUBBLEWRAP} doctor`, { cwd: DIR })) warn('If Bubblewrap asked questions above, answer them; then run this again if anything failed.');
  }
  const keytool = keytoolPath();

  const first = !existsSync(KEYSTORE);
  say(first ? 'Making the app\'s signing key (only this once)…' : 'Signing key found ✔');
  const pass = await askHidden(first ? `Choose a password for the signing key (at least ${MIN_PASSWORD} characters): ` : 'Signing key password: ');
  if (!pass || pass.length < MIN_PASSWORD) throw new Error(`The password needs at least ${MIN_PASSWORD} characters.`);
  if (first) {
    if ((await askHidden('Type it again: ')) !== pass) throw new Error("The two passwords don't match.");
  }
  // the password goes to the tools through environment variables only (never on the command line or in a file)
  const env = { ...baseEnv(), NEST_KS_PASS: pass, BUBBLEWRAP_KEYSTORE_PASSWORD: pass, BUBBLEWRAP_KEY_PASSWORD: pass };
  if (first) {
    const ok = live(`${keytool} -genkeypair -v -keystore "${KEYSTORE}" -alias ${ALIAS} -keyalg RSA -keysize 2048 -validity 10000 `
      + '-storepass:env NEST_KS_PASS -keypass:env NEST_KS_PASS -dname "CN=The Stewart Nest, O=Stewart family, C=ZA"', { env });
    if (!ok) throw new Error('Could not make the signing key.');
    warn('Back up android\\nest-release.keystore and its password somewhere safe. Without them you cannot update the app.');
  }

  say('Reading the key\'s fingerprint…');
  const list = spawnSync(`${keytool} -list -v -keystore "${KEYSTORE}" -alias ${ALIAS} -storepass:env NEST_KS_PASS`, { shell: true, env, encoding: 'utf8' });
  const fp = (list.stdout || '').match(/SHA256:\s*([0-9A-F:]{95})/i)?.[1]?.toUpperCase();
  if (!fp) throw new Error('Wrong password, or the key could not be read.\n' + (list.stderr || list.stdout || '').slice(-400));
  const twa = JSON.parse(readFileSync(TWA, 'utf8'));
  if (!twa.fingerprints.some((f) => f.value === fp)) { twa.fingerprints = [{ name: 'release', value: fp }]; writeFileSync(TWA, JSON.stringify(twa, null, 2) + '\n'); }

  say('Making the Android project from android/twa-manifest.json…');
  console.log('(The first time, Bubblewrap may offer to download Java and the Android tools, about 500 MB: answer yes and accept the licences.)');
  // first time: version 1.0.0 as in the settings; after that every build gets the next version, so phones accept the update
  const made = existsSync(join(DIR, 'app', 'build.gradle'));
  const nextCode = (JSON.parse(readFileSync(TWA, 'utf8')).appVersionCode || 1) + 1;
  const versionArgs = made ? `--appVersionName=1.0.${nextCode - 1}` : '--skipVersionUpgrade';
  if (!live(`${BUBBLEWRAP} update ${versionArgs}`, { cwd: DIR, env })) {
    warn('Bubblewrap needs to finish setting up (see above). Answer its questions, then run this again.');
    process.exitCode = 1; return;
  }
  // Note: keep "enableSiteSettingsShortcut": true in android/twa-manifest.json. Google's androidbrowserhelper 2.8
  // switches on its "Site settings" screen at every start; with the shortcut off, Bubblewrap leaves that screen out
  // of the app and the app crashes on launch ("Component class …ManageDataLauncherActivity does not exist").
  if (JSON.parse(readFileSync(TWA, 'utf8')).enableSiteSettingsShortcut === false) {
    throw new Error('Set "enableSiteSettingsShortcut": true in android/twa-manifest.json (with false the app crashes on start).');
  }

  say('Building the app (a few minutes the first time)…');
  if (!live(`${BUBBLEWRAP} build --skipPwaValidation`, { cwd: DIR, env })) throw new Error('The build failed (see above).');
  const apk = join(DIR, 'app-release-signed.apk');
  if (!existsSync(apk)) throw new Error('The build finished but no app-release-signed.apk was found.');
  copyFileSync(apk, OUT_APK);
  // also on the download page (goes online with the next "Publish to Cloudflare.bat")
  mkdirSync(dirname(PUBLIC_APK), { recursive: true });
  copyFileSync(apk, PUBLIC_APK);
  const built = JSON.parse(readFileSync(TWA, 'utf8'));
  writeFileSync(join(dirname(PUBLIC_APK), 'version.json'), JSON.stringify({ version: built.appVersionName || built.appVersion, code: built.appVersionCode,
    bytes: statSync(apk).size, built: new Date().toISOString().slice(0, 10) }) + '\n');

  const links = [{ relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: twa.packageId, sha256_cert_fingerprints: [fp] } }];
  writeFileSync(ASSETLINKS, JSON.stringify(links, null, 2) + '\n');

  const v = JSON.parse(readFileSync(TWA, 'utf8'));
  console.log(`\n🎉  Done: "Stewart Nest.apk" (version ${v.appVersionName || v.appVersion}, build ${v.appVersionCode})\n`);
  console.log('Next:');
  console.log('  1. Run "Publish to Cloudflare.bat": the website recognises the app, and stewartza.co.za/app offers this version.');
  console.log('  2. On each Android phone open stewartza.co.za/app and tap Download (or send "Stewart Nest.apk" by WhatsApp/Drive),');
  console.log('     open it and allow "install unknown apps" for that one app when asked.');
  console.log('  3. Open the Nest app, log in, and switch on notifications in More.\n');
}

main().catch((e) => { console.error(`\n\x1b[31m✖ ${e.message}\x1b[0m\n`); process.exitCode = 1; });
