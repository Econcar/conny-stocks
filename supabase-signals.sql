-- ════════════════════════════════════════════════════════════════
-- Supabase-uppsättning för signalpipelinen (kör i Supabase → SQL Editor)
-- Se docs/signal-pipeline-spec.md §7 och docs/spec-mall.md §13.
-- ════════════════════════════════════════════════════════════════

-- Tabell: en rad per (källa, dokument, berörd ticker). Global läsdata –
-- inte per användare. Motorn (schemalagt jobb) skriver med service-nyckeln;
-- klienten läser bara.
create table if not exists public.signals (
  id           uuid        primary key default gen_random_uuid(),
  source       text        not null,             -- adapter-id, t.ex. "sec_edgar"
  type         text        not null,             -- signaltyp, t.ex. "filing_8k"
  external_id  text        not null,             -- källans id, för dedup
  url          text,
  published_at timestamptz,
  ticker       text        not null default '',  -- '' = marknads-/makrobred signal
  sector       text,
  sentiment    text,                             -- positiv | neutral | negativ
  impact_score numeric,                          -- 0–1, uppskattad kurspåverkan
  summary      text,
  confidence   numeric,                          -- 0–1
  analysis     text,                             -- fördjupad rationale (djupanalys), annars null
  model        text,                             -- modell som producerade analysen
  created_at   timestamptz not null default now(),
  -- Idempotens: samma dokument + ticker skrivs bara en gång (upsert).
  unique (source, external_id, ticker)
);

-- Frågemönster: "vad rör bolag X" och "senaste signalerna".
create index if not exists signals_ticker_idx       on public.signals (ticker);
create index if not exists signals_published_at_idx  on public.signals (published_at desc);

-- Row-Level Security: publik läsning (icke-känslig marknadsdata), men
-- inga insert/update/delete-policys → endast service-nyckeln kan skriva
-- (service-rollen kringgår RLS).
alter table public.signals enable row level security;

create policy "signals – publik läsning"
  on public.signals for select
  using (true);
