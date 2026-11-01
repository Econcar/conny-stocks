// conny-stocks · Motorns schema på AI-kostnader: pausa automatiska analyser och ställ in hur
// ofta de körs. Sparas i engine_settings (supabase-engine-settings.sql), som motorn läser vid
// varje körning. Jobben och reglerna för "dags att köra" delas med motorn: shared/engine-schedule.js.

const ENGINE_WORKFLOW_URL = 'https://github.com/Econcar/conny-stocks/actions/workflows/engine.yml';
let engineSched = null; // { settings, fallback: {jobb: iso}, missing, error }

function engineEveryText(n){
  return ({ 1: 'varje dag', 2: 'varannan dag', 7: 'en gång i veckan', 14: 'varannan vecka', 30: 'en gång i månaden' })[n] || `var ${n}:e dag`;
}

// Hur ofta ett jobb körs, i ord – till "Vad kostar"-tabellen.
function engineFreqText(id){
  const s = engineSched ? engineSched.settings : engineSettingsMerge([]);
  if(!s[id]) return '';
  if(!s.all.enabled || !s[id].enabled || (id === 'deep' && !s.news.enabled)) return 'pausad';
  if(id === 'deep') return 'med nyhetstriagen';
  if(id === 'aifunds') return 'enligt fondens intervall';
  return engineEveryText(s[id].every_days);
}

// "i morgon ca 07:00", "fre 7 nov ca 07:00" …
function engineNextText(at, now){
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(at) - day(now)) / 86400000);
  const time = at.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const when = diff === 0 ? 'i dag' : diff === 1 ? 'i morgon' : at.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${when} ca ${time}`;
}

async function loadEngineSched(){
  const base = { settings: engineSettingsMerge([]), fallback: {}, missing: false, error: null };
  if(!cloudEnabled || !sb) return { ...base, error: 'Molnet är inte konfigurerat.' };
  const { data, error } = await sb.from('engine_settings').select('id,enabled,every_days,last_run_at');
  if(error){
    const missing = /PGRST205|42P01/.test(error.code || '') || /engine_settings/.test(error.message || '');
    return { ...base, missing, error: missing ? null : error.message };
  }
  const settings = engineSettingsMerge(data);
  // Som motorn: utan sparad körtid räknas senaste AI-anropet för jobbet (kräver inloggning).
  const fallback = {};
  await Promise.all(ENGINE_JOBS.filter(j => j.ctx && !settings[j.id].last_run_at).map(async j => {
    try {
      const r = await sb.from('ai_usage').select('created_at').eq('context', j.ctx).order('created_at', { ascending: false }).limit(1);
      if(!r.error && r.data && r.data[0]) fallback[j.id] = r.data[0].created_at;
    } catch(e){}
  }));
  return { ...base, settings, fallback };
}

async function renderEngineSchedule(){
  const el = document.getElementById('aicost-schedule');
  try { engineSched = await loadEngineSched(); }
  catch(e){ engineSched = { settings: engineSettingsMerge([]), fallback: {}, missing: false, error: e.message }; }
  if(!el) return;
  const { settings: s, fallback, missing, error } = engineSched;
  const canEdit = !!currentUser && !missing && !error;
  const dis = canEdit ? '' : ' disabled';
  const now = new Date();
  const paused = !s.all.enabled;

  const rows = ENGINE_JOBS.map(j => {
    const st = s[j.id];
    const last = st.last_run_at || fallback[j.id];
    const next = engineNextRun(s, j.id, now, fallback[j.id]);
    const opts = [...new Set([...ENGINE_EVERY_OPTIONS, st.every_days])].sort((a, b) => a - b)
      .map(n => `<option value="${n}"${n === st.every_days ? ' selected' : ''}>${engineEveryText(n)}</option>`).join('');
    const freq = j.every == null
      ? `<span class="muted">${j.id === 'deep' ? 'med nyhetstriagen' : 'enligt fondens intervall'}</span>`
      : `<select class="filter-input" style="width:auto" data-job="${j.id}" onchange="setEngineJob('${j.id}',{every_days:+this.value})"${dis}>${opts}</select>`;
    return `<tr data-job="${j.id}"${st.enabled && !paused ? '' : ' style="opacity:0.6"'}>
      <td><div style="font-weight:600">${escHtml(j.label)}</div><div style="font-size:11px;color:var(--text3)">${escHtml(j.desc)}</div></td>
      <td><label style="display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap"><input type="checkbox" data-job="${j.id}"${st.enabled ? ' checked' : ''} onchange="setEngineJob('${j.id}',{enabled:this.checked})"${dis}> ${st.enabled ? 'På' : 'Pausad'}</label></td>
      <td>${freq}</td>
      <td style="font-size:12px;white-space:nowrap">${last ? fmtWhen(last) : '<span class="muted">–</span>'}</td>
      <td style="font-size:12px;white-space:nowrap" class="engine-next">${next ? engineNextText(next, now) : '<span style="color:var(--amber)">pausad</span>'}</td>
    </tr>`;
  }).join('');

  const notes = [];
  if(missing) notes.push('Kör <b>supabase-engine-settings.sql</b> i Supabase → SQL Editor för att kunna pausa och ändra intervallen. Till dess kör motorn standardschemat nedan.');
  else if(error) notes.push('Kunde inte läsa schemat: ' + escHtml(error));
  else if(!currentUser) notes.push('Logga in för att pausa eller ändra intervallen.');
  const note = notes.map(n => `<div class="info-msg" style="margin:10px 0 0">${n}</div>`).join('');

  el.innerHTML = `<div class="card" style="margin:14px 0">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px"><div class="card-title" style="margin-bottom:4px">Automatiska analyser (motorn)</div>
        <div style="font-size:13px" id="engine-status">${paused
          ? '<span style="color:var(--red)"><b>Pausad</b> – inga automatiska analyser körs förrän du startar motorn igen.</span>'
          : `Motorn startar en gång per dygn, ca ${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), ENGINE_CRON_UTC_HOUR)).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })} svensk tid, och kör de jobb som är på och dags.`}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="ghost-btn" id="engine-pause-all" onclick="setEngineJob('all',{enabled:${paused}})"${dis}>${paused ? '▶ Starta motorn igen' : '⏸ Pausa hela motorn'}</button>
        <a class="ghost-btn" href="${ENGINE_WORKFLOW_URL}" target="_blank" rel="noopener" style="text-decoration:none;white-space:nowrap" title="Run workflow kör de jobb som är på och dags enligt schemat">Kör nu i GitHub ↗</a>
      </div>
    </div>${note}
    <div class="table-wrap" style="margin-top:12px"><table id="engine-jobs">
      <thead><tr><th>Jobb</th><th>På/av</th><th>Hur ofta</th><th>Senast</th><th>Nästa</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div style="font-size:11px;color:var(--text3);margin-top:8px">Ändringar gäller från motorns nästa körning. Intervallet räknas från senaste lyckade körningen, så en körning som missas (t.ex. slut på krediter) görs om dagen efter. Glest körda jobb sparar mest: kostnaden per körning syns i "Vad kostar" nedan.</div>
  </div>`;
}

async function setEngineJob(id, patch){
  if(!currentUser || !sb || !engineSched) return;
  const cur = engineSched.settings[id];
  const row = { id, enabled: patch.enabled != null ? !!patch.enabled : cur.enabled,
    every_days: patch.every_days !== undefined ? patch.every_days : cur.every_days, updated_at: new Date().toISOString() };
  const { error } = await sb.from('engine_settings').upsert(row);
  if(error) showToast('Kunde inte spara schemat: ' + error.message);
  await renderEngineSchedule();
  if(typeof aiCostLastRows !== 'undefined' && aiCostLastRows) renderAiCostBody(aiCostLastRows); // "Hur ofta" i tabellen
}
