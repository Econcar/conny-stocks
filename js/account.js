// conny-stocks · API-nyckel och Supabase-konto/inloggning.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

// ══════════ API KEY MANAGEMENT ══════════
function saveApiKey() {
  const input = document.getElementById('api-key-input');
  const key = input.value.trim();
  if(!key.startsWith('sk-ant-')) {
    document.getElementById('api-key-status').textContent = '⚠ Nyckeln verkar inte vara korrekt – den ska börja med sk-ant-';
    document.getElementById('api-key-status').style.color = 'var(--red)';
    return;
  }
  localStorage.setItem('anthropic_api_key', key);
  input.value = '●'.repeat(20);
  document.getElementById('api-key-status').textContent = '✓ Nyckel sparad – AI-analysen är aktiv!';
  document.getElementById('api-key-status').style.color = 'var(--green)';
  document.getElementById('ai-status-dot').style.background = 'var(--green)';
  const msgs = document.getElementById('ai-messages');
  msgs.innerHTML = '';
  appendMsg('ai', 'Perfekt! Nyckeln är sparad och AI-analysen är nu aktiv.\n\nJag kan analysera enskilda aktier, jämföra bolag, förklara nyckeltal och ge marknadsöversikter.\n\nKlicka på en aktie och tryck **Analysera med AI**, eller skriv din fråga nedan.');
}

function getApiKey() {
  return localStorage.getItem('anthropic_api_key') || '';
}

// ══════════ SUPABASE / KONTO ══════════
// 🔑 Klistra in dina värden från Supabase → Project Settings → API.
//    anon/public-nyckeln är säker att ha i frontend (skyddas av Row-Level Security).
const SUPABASE_URL = 'https://rbilywmxxdlnsxbrqees.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yDCaCtRRrM-Tsqj01KBR2w_I9SR7rCr'; // publishable key (säker i frontend, skyddas av RLS)

const cloudEnabled = /^https:\/\/.+\.supabase\.co/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;
const sb = cloudEnabled ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentUser = null;

function renderAccountBar() {
  const el = document.getElementById('account-bar');
  if(!el) return;
  if(!cloudEnabled) { el.innerHTML = ''; return; }
  if(currentUser) {
    el.innerHTML = `<div class="acct"><span class="acct-email" title="${escHtml(currentUser.email||'')}">${escHtml(currentUser.email||'Inloggad')}</span><button class="acct-link" onclick="signOut()">Logga ut</button></div>`;
  } else {
    el.innerHTML = `<button class="acct-btn" onclick="signInGoogle()"><span>🔵</span> Logga in med Google</button>`;
  }
}

async function signInGoogle() {
  if(!sb) return;
  await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}
async function signOut() {
  if(!sb) return;
  await sb.auth.signOut();
}

// Hämta molnlistan (RLS säkrar att man bara ser sina egna rader)
async function pullCloudWatchlist() {
  if(!sb || !currentUser) return null;
  const { data, error } = await sb.from('watchlist_items')
    .select('item_id,name,label,is_fund').order('created_at', { ascending: true });
  if(error) { console.warn('Supabase pull:', error.message); return null; }
  return data.map(r => ({ id: r.item_id, name: r.name, label: r.label, isFund: r.is_fund }));
}
async function pushItemCloud(w) {
  if(!sb || !currentUser) return;
  const { error } = await sb.from('watchlist_items').upsert(
    { user_id: currentUser.id, item_id: w.id, name: w.name, label: w.label || null, is_fund: !!w.isFund },
    { onConflict: 'user_id,item_id' }
  );
  if(error) console.warn('Supabase push:', error.message);
}
async function deleteItemCloud(id) {
  if(!sb || !currentUser) return;
  const { error } = await sb.from('watchlist_items').delete().eq('item_id', id);
  if(error) console.warn('Supabase delete:', error.message);
}

// Vid inloggning: slå ihop lokal lista med molnet, ladda upp lokala extrarader, visa resultatet.
async function syncWatchlistFromCloud() {
  const cloud = await pullCloudWatchlist();
  if(cloud === null) return; // fel/ej inloggad – behåll lokalt
  const local = getWatchlist();
  const cloudIds = new Set(cloud.map(w => w.id));
  const localOnly = local.filter(w => !cloudIds.has(w.id));
  for(const w of localOnly) await pushItemCloud(w); // migrera lokala till molnet
  const merged = cloud.concat(localOnly);
  saveWatchlist(merged.length ? merged : DEFAULT_WATCHLIST.slice());
  renderWatchlist();
  refreshLivePrices();
}

function initAuth() {
  renderAccountBar();
  if(!sb) return;
  sb.auth.onAuthStateChange((event, session) => {
    currentUser = (session && session.user) ? session.user : null;
    renderAccountBar();
    if(currentUser) { syncWatchlistFromCloud(); loadDecisions(); /* laddar upp lokala AI-beslut */ if(currentSection === 'portfolio') renderPortfolio(); if(currentSection === 'analyses') renderAnalyses(); if(currentSection === 'aifund') renderAIFund(); }
  });
}
