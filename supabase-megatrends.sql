-- ════════════════════════════════════════════════════════════════
-- Daglig AI-analys av megatrender / investeringsteman. Kör i Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════

-- En rad per (dag, tema): motorn skriver, appen läser bara.
create table if not exists public.megatrends (
  date         date        not null,
  theme        text        not null,        -- tema-id, t.ex. "ai"
  name         text        not null,        -- visningsnamn
  analysis     text        not null,        -- AI:ns temaanalys
  signal_count integer,                     -- antal signaler som grundade analysen
  model        text,
  created_at   timestamptz not null default now(),
  primary key (date, theme)
);

create index if not exists megatrends_date_idx on public.megatrends (date desc);

-- Publik läsning; endast service-nyckeln kan skriva (kringgår RLS).
alter table public.megatrends enable row level security;

create policy "megatrends – publik läsning"
  on public.megatrends for select
  using (true);
