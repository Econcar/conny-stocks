-- ════════════════════════════════════════════════════════════════
-- Daglig CIO-analys (taktisk tillgångsallokering). Kör i Supabase → SQL Editor.
-- Motorn skriver (engine/lib/cio.js), appen visar senaste raden på Översikt.
-- ════════════════════════════════════════════════════════════════

-- En rad per dag: motorn (schemalagt jobb) skriver, appen läser bara.
create table if not exists public.cio_analysis (
  date       date        primary key,        -- en analys per dag (upsert)
  analysis   text        not null,           -- promemorian (markdown)
  snapshot   jsonb,                          -- underlaget som skickades till modellen
  model      text,                           -- modell som producerade analysen
  created_at timestamptz not null default now()
);

-- Publik läsning (icke-känslig marknadsdata); inga insert/update/delete-policys
-- → endast service-nyckeln kan skriva (service-rollen kringgår RLS).
alter table public.cio_analysis enable row level security;

drop policy if exists "cio_analysis – publik läsning" on public.cio_analysis;
create policy "cio_analysis – publik läsning"
  on public.cio_analysis for select
  using (true);
