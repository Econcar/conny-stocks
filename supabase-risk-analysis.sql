-- ════════════════════════════════════════════════════════════════
-- Daglig AI-sammanvägning av riskbarometern. Kör i Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════

-- En rad per dag: motorn (schemalagt jobb) skriver, appen läser bara.
create table if not exists public.risk_analysis (
  date       date        primary key,        -- en analys per dag (upsert)
  analysis   text        not null,           -- AI:ns sammanvägda bedömning
  snapshot   jsonb,                          -- indikatorvärdena som användes
  model      text,                           -- modell som producerade analysen
  created_at timestamptz not null default now()
);

-- Publik läsning (icke-känslig marknadsdata); inga insert/update/delete-policys
-- → endast service-nyckeln kan skriva (service-rollen kringgår RLS).
alter table public.risk_analysis enable row level security;

create policy "risk_analysis – publik läsning"
  on public.risk_analysis for select
  using (true);
