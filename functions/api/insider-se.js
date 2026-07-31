// Proxy mot Finansinspektionens insynsregister (marknadssok.fi.se) – insynshandel
// för svensknoterade bolag. Yahoos insiderTransactions täcker bara SEC Form 4,
// dvs. US-noterade bolag; nordiska tickers ger noll rader där.
//
// FI:s CSV-export är UTF-16LE med semikolon som separator. Vi filtrerar på
// transaktionsdatum för att hålla nere svaret (osfiltrerat ~500 kB, 1000 rader).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const BAS = 'https://marknadssok.fi.se/publiceringsklient/sv-SE/Search/Search';

// Emittentsökningen är en substrängmatchning: "volvo" träffar både AB Volvo och
// Volvo Car AB. Vi normaliserar bort bolagsform och skiljetecken och kräver sedan
// exakt likhet, så att bara rätt bolag blir kvar ("volvo" ≠ "volvo car").
const FORMER = /\b(ab|aktiebolaget|publ|oyj|abp|asa|a\/s|as|plc|inc|corp|corporation|ltd|holding|group|se)\b/g;
function normalisera(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[.,()\[\]]/g, ' ')
    .replace(FORMER, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Delar en CSV-rad på semikolon. FI citerar inte fält, men vi hanterar citattecken
// för säkerhets skull om de skulle dyka upp.
function delaRad(rad) {
  const ut = [];
  let cur = '', inom = false;
  for (const ch of rad) {
    if (ch === '"') { inom = !inom; continue; }
    if (ch === ';' && !inom) { ut.push(cur); cur = ''; continue; }
    cur += ch;
  }
  ut.push(cur);
  return ut;
}

const num = s => {
  const v = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.'));
  return isFinite(v) ? v : null;
};

export async function onRequest(context) {
  const p = new URL(context.request.url).searchParams;
  const namn = (p.get('q') || '').trim();
  const manader = Math.min(Math.max(parseInt(p.get('months') || '12', 10) || 12, 1), 60);
  if (!namn || namn.length > 80) return json({ error: 'Saknar eller ogiltig q-parameter' }, 400);

  // Sök brett på det normaliserade namnet, filtrera exakt efteråt.
  const sokterm = normalisera(namn) || namn;
  const from = new Date(Date.now() - manader * 31 * 86400 * 1000).toISOString().slice(0, 10);
  const url = `${BAS}?SearchFunctionType=Insyn&Utgivare=${encodeURIComponent(sokterm)}` +
    `&Transaktionsdatum.From=${from}&button=export`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return json({ error: `FI svarade ${res.status}` }, 502);
    // UTF-16LE → text. TextDecoder finns i Workers-runtimen.
    const text = new TextDecoder('utf-16le').decode(await res.arrayBuffer()).replace(/^﻿/, '');
    const rader = text.split(/\r?\n/).filter(r => r.trim());
    if (rader.length < 2) return json({ emittent: null, transaktioner: [], sokterm, from });

    const kol = delaRad(rader[0]).map(k => k.trim());
    const i = namn => kol.indexOf(namn);
    const iEmittent = i('Emittent'), iPerson = i('Person i ledande ställning'), iBefattning = i('Befattning'),
      iKaraktar = i('Karaktär'), iInstrument = i('Instrumentnamn'), iIsin = i('ISIN'),
      iDatum = i('Transaktionsdatum'), iVolym = i('Volym'), iEnhet = i('Volymsenhet'),
      iPris = i('Pris'), iValuta = i('Valuta'), iStatus = i('Status'), iNarstaende = i('Närstående');

    const traffar = [];
    const emittenter = new Set();
    const kandidater = new Set();   // alla bolag sökningen råkade träffa, för felmeddelandet
    for (const rad of rader.slice(1)) {
      const f = delaRad(rad);
      const emittent = (f[iEmittent] || '').trim();
      if (emittent) kandidater.add(emittent);
      if (normalisera(emittent) !== sokterm) continue;   // fel bolag (t.ex. Volvo Car)
      if ((f[iStatus] || '').trim().toLowerCase() === 'makulerad') continue;
      emittenter.add(emittent);
      traffar.push({
        datum: (f[iDatum] || '').trim().slice(0, 10),    // FI skickar med tidsdel
        person: (f[iPerson] || '').trim(),
        befattning: (f[iBefattning] || '').trim(),
        karaktar: (f[iKaraktar] || '').trim(),
        instrument: (f[iInstrument] || '').trim(),
        isin: (f[iIsin] || '').trim(),
        volym: num(f[iVolym]),
        enhet: (f[iEnhet] || '').trim(),
        pris: num(f[iPris]),
        valuta: (f[iValuta] || '').trim(),
        narstaende: (f[iNarstaende] || '').trim().toLowerCase() === 'ja'
      });
    }

    traffar.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
    return json({
      emittent: [...emittenter][0] || null,
      // Tomt resultat trots träffar i registret = namnet stavas annorlunda hos FI.
      kandidater: traffar.length ? [] : [...kandidater].slice(0, 6),
      sokterm, from,
      totalt: traffar.length,          // så klienten vet om listan är kapad
      transaktioner: traffar.slice(0, 200)
    }, 200, 1800);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      // charset behövs: svaret innehåller å/ä/ö och namn med hårt mellanslag.
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store'
    }
  });
}
