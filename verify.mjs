// Pre-deploy-kontroll: syntaxkollar all JS + index.html:s inline-script, kör
// enhetstesterna, och avslutar med kod ≠ 0 om något fallerar. deploy.ps1 kör
// detta före push och avbryter vid fel. Kör manuellt med:  node verify.mjs
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
const files = [...jsFiles('engine'), ...jsFiles('functions'), 'server.js', 'verify.mjs'];
for (const f of files) {
  step(f, () => execSync(`node --check "${f}"`, { stdio: 'pipe' }));
}

console.log('\n2) Syntaxkoll av inline-script i index.html');
step('index.html <script>-block', () => {
  const html = readFileSync('index.html', 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) throw new Error('inga inline-script hittades (regex-fel?)');
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

console.log('');
if (failed) {
  console.error(`✖ ${failed} kontroll(er) misslyckades – deploy avbryts.`);
  process.exit(1);
}
console.log('✔ Alla kontroller gröna.');
