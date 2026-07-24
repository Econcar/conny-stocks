-- ════════════════════════════════════════════════════════════════
-- Rapportkalender: bolagsuniversum + rapportdatum (kör i Supabase → SQL Editor)
-- Fylls av motorn (engine/lib/earnings.js) en gång per dygn. Se docs/beslutslogg.md.
-- Skriptet är idempotent – går att köra om utan fel.
-- ════════════════════════════════════════════════════════════════

-- En rad per (ticker, rapportdatum). Global läsdata – inte per användare. Motorn
-- skriver med service-nyckeln, klienten läser bara. Varje nattkörning lägger till
-- bolagets nästa datum; när bolaget rapporterat och Yahoo rullar fram till nästa
-- kvartal blir det en NY rad, och den passerade raden lämnas orörd (= ligger kvar).
create table if not exists public.earnings_calendar (
  ticker       text        not null,             -- Yahoo-symbol, t.ex. ERIC-B.ST
  report_date  date        not null,             -- rapportdagen (lokalt datum)
  name         text        not null default '',
  market       text,                             -- se | us | de … (från screenern)
  exchange     text,                             -- STO, NMS, NYQ …
  currency     text,
  market_cap   numeric,                          -- för sortering/urval
  report_at    timestamptz,                      -- exakt tidpunkt när Yahoo har den
  estimate     boolean     not null default false, -- Yahoos datum är en uppskattning
  updated_at   timestamptz not null default now(),
  primary key (ticker, report_date)
);

-- Migrering 2026-07-24: en tidig version hade nyckeln (ticker) enbart, vilket gjorde
-- att nästa kvartals datum SKREV ÖVER det passerade. Byt till (ticker, report_date)
-- UTAN att tappa redan insamlade rader (passerade datum går inte att hämta igen).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.earnings_calendar'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (ticker)'
  ) then
    alter table public.earnings_calendar drop constraint earnings_calendar_pkey;
    alter table public.earnings_calendar add primary key (ticker, report_date);
  end if;
end $$;

-- Frågemönster: "vilka rapporterar mellan X och Y" (både bakåt och framåt).
create index if not exists earnings_calendar_date_idx on public.earnings_calendar (report_date);

-- Row-Level Security: publik läsning (icke-känslig marknadsdata), inga
-- skrivpolicys → bara service-nyckeln kan skriva (service-rollen kringgår RLS).
alter table public.earnings_calendar enable row level security;

drop policy if exists "earnings_calendar – publik läsning" on public.earnings_calendar;
create policy "earnings_calendar – publik läsning"
  on public.earnings_calendar for select
  using (true);
