// conny-stocks · Start: körs sist när alla andra filer laddats.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ INIT ══════════
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
