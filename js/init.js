// conny-stocks · Start: körs sist när alla andra filer laddats.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ INIT ══════════
// Versionsnummer i sidomenyn + koll mot servern: var 5:e minut och när fliken får fokus
// läses js/version.js om; är den nyare än sidan visas en ruta med "Ladda om".
document.getElementById('app-version').textContent = `Version ${APP_VERSION.number} · ${APP_VERSION.date}`;
async function checkForNewVersion() {
  try {
    const txt = await (await fetch('js/version.js?t=' + Date.now(), { cache: 'no-store' })).text();
    const m = txt.match(/number:\s*(\d+)/);
    if(!m || Number(m[1]) <= APP_VERSION.number || document.getElementById('new-version')) return;
    const div = document.createElement('div');
    div.id = 'new-version';
    div.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--accent);color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.4);display:flex;gap:12px;align-items:center';
    div.innerHTML = `Ny version (${Number(m[1])}) finns <button class="ghost-btn" style="color:#fff;border-color:rgba(255,255,255,.6);padding:4px 10px" onclick="location.reload()">Ladda om</button>`;
    document.body.appendChild(div);
  } catch(e) { /* offline e.d. – försök igen nästa gång */ }
}
setInterval(checkForNewVersion, 5 * 60 * 1000);
window.addEventListener('focus', checkForNewVersion);

document.querySelectorAll('.ai-guide[data-here]').forEach(el => el.innerHTML = aiGuideHtml(el.dataset.here));
renderDashboard();
renderWatchlist();
initAuth();
// Screenern laddas först när man öppnar fliken (showSection('screener') → renderScreener)

// Hämta live-priser direkt och uppdatera listorna var 60:e sekund
refreshLivePrices();
refreshMarketKpis();
setInterval(() => { refreshLivePrices(); refreshMarketKpis(); }, 60000);

// Kolla om nyckel redan finns sparad sedan tidigare
const savedKey = getApiKey();
if(savedKey) {
  document.getElementById('api-key-input').value = '●'.repeat(20);
  document.getElementById('api-key-status').textContent = '✓ Nyckel sparad – AI-analysen är aktiv!';
  document.getElementById('api-key-status').style.color = 'var(--green)';
  document.getElementById('ai-status-dot').style.background = 'var(--green)';
  const msgs = document.getElementById('ai-messages');
  msgs.innerHTML = '';
  appendMsg('ai', 'Välkommen tillbaka! Din API-nyckel är sparad och AI-analysen är aktiv.\n\nKlicka på en aktie och tryck **Analysera med AI**, eller skriv din fråga nedan.');
}
