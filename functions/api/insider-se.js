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

  // Sök brett på FÖRSTA ordet och filtrera exakt efteråt. Yahoos bolagsnamn stämmer
  // inte alltid med FI:s (ERIC-B.ST saknar longName helt och ger "Ericsson, Telefonab.
  // L M ser. B", medan FI säger "Telefonaktiebolaget LM Ericsson") – ett brett sökord
  // plus exakt filtrering träffar rätt oftare än att söka på hela namnet.
  const helaNamnet = normalisera(namn) || namn.toLowerCase();
  const sokterm = helaNamnet.split(' ')[0] || helaNamnet;
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

    // Gruppera per emittent så vi kan skilja "AB Volvo" från "Volvo Car AB".
    const grupper = new Map();        // normaliserat namn → { namn, rader: [] }
    for (const rad of rader.slice(1)) {
      const f = delaRad(rad);
      const emittent = (f[iEmittent] || '').trim();
      if (!emittent) continue;
      if ((f[iStatus] || '').trim().toLowerCase() === 'makulerad') continue;
      const nyckel = normalisera(emittent);
      if (!grupper.has(nyckel)) grupper.set(nyckel, { namn: emittent, rader: [] });
      grupper.get(nyckel).rader.push({
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

    // 1) Exakt namnmatchning. 2) Annars: om sökordet bara gav ETT bolag är svaret
    //    entydigt och vi tar det (räddar bolag vars namn vi stavar annorlunda).
    //    Är det flera (Volvo → AB Volvo + Volvo Car AB) vägrar vi gissa.
    let vald = grupper.get(helaNamnet) || null;
    if (!vald && grupper.size === 1) vald = [...grupper.values()][0];

    const traffar = vald ? vald.rader : [];
    traffar.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
    return json({
      emittent: vald ? vald.namn : null,
      // Tomt resultat trots träffar i registret = namnet stavas annorlunda hos FI.
      kandidater: vald ? [] : [...grupper.values()].map(g => g.namn).slice(0, 6),
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
