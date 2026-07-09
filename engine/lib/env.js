// Laddar engine/.env (om den finns) in i process.env för lokal körning.
// Dependency-fri. Redan satta variabler skrivs INTE över – så i GitHub Actions
// vinner repo-secrets, och filen behövs inte där. Kräver:s först i run.js.

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');
try {
  const text = fs.readFileSync(envPath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Ta bort omgivande citattecken.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
  console.error('[env] laddade engine/.env');
} catch (e) {
  if (e.code !== 'ENOENT') console.error('[env] kunde inte läsa engine/.env:', e.message);
}
