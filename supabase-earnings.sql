-- ════════════════════════════════════════════════════════════════
-- Rapportkalender: bolagsuniversum + nästa rapportdatum (kör i Supabase → SQL Editor)
-- Fylls av motorn (engine/lib/earnings.js) en gång per dygn. Se docs/beslutslogg.md.
-- ════════════════════════════════════════════════════════════════

-- En rad per ticker. Global läsdata – inte per användare. Motorn skriver med
-- service-nyckeln, klienten läser bara.
create table if not exists public.earnings_calendar (
  ticker       text        primary key,          -- Yahoo-symbol, t.ex. ERIC-B.ST
  name         text        not null default '',
  market       text,                             -- se | us | de … (från screenern)
  exchange     text,                             -- STO, NMS, NYQ …
  currency     text,
  market_cap   numeric,                          -- för sortering/urval
  report_date  date        not null,             -- rapportdagen (lokalt datum)
  report_at    timestamptz,                      -- exakt tidpunkt när Yahoo har den
  estimate     boolean     not null default false, -- Yahoos datum är en uppskattning
  updated_at   timestamptz not null default now()
);

-- Frågemönster: "vilka rapporterar mellan X och Y".
create index if not exists earnings_calendar_date_idx on public.earnings_calendar (report_date);

-- Row-Level Security: publik läsning (icke-känslig marknadsdata), inga
-- skrivpolicys → bara service-nyckeln kan skriva (service-rollen kringgår RLS).
alter table public.earnings_calendar enable row level security;

create policy "earnings_calendar – publik läsning"
  on public.earnings_calendar for select
  using (true);
