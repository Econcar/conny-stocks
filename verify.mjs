// Pre-deploy-kontroll: syntaxkollar all JS + index.html:s inline-script, kör
// enhetstesterna och ett webbläsartest (test/e2e/smoke.mjs, ~40 s, hoppas över om
// Chrome/Edge saknas eller med SKIP_E2E=1), och avslutar med kod ≠ 0 om något
// fallerar. deploy.ps1 kör detta före push och avbryter vid fel.
// Kör manuellt med:  node verify.mjs
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const step = (name, fn) => {
  try { fn(); console.log(`  ✔ ${name}`); }
  catch (e) { failed++; console.error(`  ✖ ${name}\n    ${String(e.message || e).split('\n')[0]}`); }
};

// Alla .js under en katalog (rekursivt), hoppar node_modules.
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...jsFiles(p));
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(p);
  }
  return out;
}

console.log('1) Syntaxkoll (node --check) på all JS');
const files = [...jsFiles('engine'), ...jsFiles('functions'), ...jsFiles('shared'), ...jsFiles('js'), 'server.js', 'verify.mjs'];
for (const f of files) {
  step(f, () => execSync(`node --check "${f}"`, { stdio: 'pipe' }));
}

console.log('\n2) index.html: skriptfiler och ev. inline-script');
step('alla js/-filer är inlänkade (och tvärtom)', () => {
  const html = readFileSync('index.html', 'utf8');
  const linked = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
  const onDisk = readdirSync('js').filter(f => f.endsWith('.js')).map(f => 'js/' + f);
  const missing = linked.filter(f => !onDisk.includes(f)), unlinked = onDisk.filter(f => !linked.includes(f));
  if (missing.length) throw new Error('länkas men finns inte: ' + missing.join(', '));
  if (unlinked.length) throw new Error('finns men länkas inte i index.html: ' + unlinked.join(', '));
  if (linked[linked.length - 1] !== 'js/init.js') throw new Error('js/init.js måste laddas sist');
});
step('index.html inline-script', () => {
  const html = readFileSync('index.html', 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  // eslint-disable-next-line no-new-func
  blocks.forEach((b, i) => { try { new Function(b); } catch (e) { throw new Error(`block ${i}: ${e.message}`); } });
});

console.log('\n3) Enhetstester (node --test)');
step('test/', () => {
  // Räkna upp testfilerna själv – glob-expansion sker inte i cmd.exe (deploy.ps1).
  const testFiles = readdirSync('test').filter(f => f.endsWith('.test.mjs')).map(f => `test/${f}`);
  if (!testFiles.length) throw new Error('inga testfiler hittades i test/');
  execSync(`node --test ${testFiles.map(f => `"${f}"`).join(' ')}`, {
    stdio: 'pipe', env: { ...process.env, NODE_NO_WARNINGS: '1' }
  });
});

console.log('\n4) Webbläsartest (Chrome headless, lokal kod mot riktiga /api)');
step('test/e2e/smoke.mjs', () => {
  try { process.stdout.write(execSync('node test/e2e/smoke.mjs', { stdio: 'pipe', timeout: 240000 }).toString()); }
  catch (e) { process.stdout.write(String(e.stdout || '')); throw new Error(String(e.stderr || e.message).trim().split('\n').slice(-3).join(' · ')); }
});

console.log('');
if (failed) {
  console.error(`✖ ${failed} kontroll(er) misslyckades – deploy avbryts.`);
  process.exit(1);
}
console.log('✔ Alla kontroller gröna.');
