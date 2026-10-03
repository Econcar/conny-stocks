// conny-stocks · Gemensamma hjälpfunktioner: HTML-escaping, Claude-anrop (strömmande),
// AI-kostnad och kostnadslogg samt enkel AI-textformatering. Används av alla flikar.
// Laddas av index.html som vanligt <script> i fast ordning – alla filer delar globalt
// scope. Kod som körs direkt vid laddning får bara använda det som redan definierats
// i tidigare filer; allt annat anropas först från init.js eller vid användning.

function escQuote(s) { return String(s).replace(/'/g, "\\'"); }

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function costUsdOf(model, usage){
  if(!usage) return 0;
  const p = AI_PRICES[model] || { in: 3, out: 15 };
  const inT = usage.input_tokens||0, outT = usage.output_tokens||0, cr = usage.cache_read_input_tokens||0, cc = usage.cache_creation_input_tokens||0;
  const sr = (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
  return (inT*p.in + cc*p.in*1.25 + cr*p.in*0.1 + outT*p.out)/1e6 + sr*0.01;
}

// Loggar ett on-demand-anrop (din nyckel) till ai_usage. Kräver inloggning – RLS
// tillåter bara skrivning i eget namn. Fire-and-forget, fel sväljs.
async function recordAiUsage(context, model, usage){
  if(!sb || !currentUser || !usage) return;
  try {
    await sb.from('ai_usage').insert({
      user_id: currentUser.id, context, model,
      input_tokens: usage.input_tokens||0, output_tokens: usage.output_tokens||0,
      cache_read_tokens: usage.cache_read_input_tokens||0, cache_create_tokens: usage.cache_creation_input_tokens||0,
      web_searches: (usage.server_tool_use && usage.server_tool_use.web_search_requests)||0,
      cost_usd: costUsdOf(model, usage)
    });
  } catch(e){ /* kostnadslogg får aldrig störa själva anropet */ }
}

// Strömmande anrop mot /api/claude (SSE). Undviker Cloudflares 524-timeout på
// långa svar (t.ex. webbsök). Sätter ihop text + usage ur strömmen. onText får
// den löpande texten för progressiv visning. Returnerar {text, usage, stop_reason}
// eller {error}.
async function callClaudeStream(body, onText){
  let res;
  try {
    res = await fetch('/api/claude', { method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':getApiKey() },
      body: JSON.stringify({ ...body, stream:true }) });
  } catch(e){ return { error:{ message:'Nätverksfel: ' + e.message } }; }

  const ct = res.headers.get('content-type') || '';
  if(!ct.includes('text/event-stream')){
    // Fel före strömstart (ogiltig nyckel, credits, 5xx) → JSON eller HTML.
    const raw = await res.text();
    let data; try { data = JSON.parse(raw); } catch(_){
      return { error:{ message:(res.status===524 || /error code: 5\d\d/i.test(raw))
        ? 'Servern hann inte svara i tid (timeout, ~100 s). Prova igen, eller stäng av Webbsök för ett snabbare svar.'
        : ('Ogiltigt svar från servern (' + res.status + ').') } };
    }
    if(data && data.error) return { error: data.error };
    const text = Array.isArray(data.content) ? data.content.filter(b=>b.type==='text').map(b=>b.text).join('').trim() : '';
    return { text, usage:data.usage, stop_reason:data.stop_reason };
  }

  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf='', text='', usage={}, stop_reason=null, errMsg=null;
  while(true){
    const { done, value } = await reader.read(); if(done) break;
    buf += dec.decode(value, { stream:true });
    let nl;
    while((nl = buf.indexOf('\n')) >= 0){
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl+1);
      if(!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if(!payload || payload === '[DONE]') continue;
      let ev; try { ev = JSON.parse(payload); } catch(_){ continue; }
      if(ev.type === 'message_start' && ev.message && ev.message.usage) usage = { ...usage, ...ev.message.usage };
      else if(ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta'){ text += ev.delta.text; if(onText) onText(text); }
      else if(ev.type === 'message_delta'){ if(ev.delta && ev.delta.stop_reason) stop_reason = ev.delta.stop_reason; if(ev.usage) usage = { ...usage, ...ev.usage }; }
      else if(ev.type === 'error'){ errMsg = (ev.error && (ev.error.message || ev.error.type)) || 'okänt streamingfel'; }
    }
  }
  if(errMsg) return { error:{ message: errMsg } };
  return { text, usage, stop_reason };
}

function formatAIText(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<div style="font-size:13px;font-weight:600;color:var(--accent);margin:10px 0 4px">$1</div>')
    .replace(/^## (.+)$/gm, '<div style="font-size:14px;font-weight:600;margin:12px 0 6px">$1</div>')
    .replace(/^- (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">· $1</div>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}
