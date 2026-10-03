-- ════════════════════════════════════════════════════════════════
-- AI:ns beslutslogg – varje rekommendation från AI-triagen, portföljgenomlysningen och
-- den institutionella djupanalysen, med kurs och jämförelseindex när den gavs. Vyn
-- "AI:ns träffsäkerhet" räknar fram hur det gick (1/3/6 mån mot index) ur Yahoos
-- kurshistorik. Kör i Supabase → SQL Editor. Utan tabellen sparas loggen bara lokalt.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.ai_decisions (
  id          uuid        primary key,                 -- sätts av appen (samma id lokalt och i molnet)
  user_id     uuid        not null default auth.uid(),
  created_at  timestamptz not null default now(),
  source      text        not null,                    -- 'triage' | 'portfolio_review' | 'deep_analysis'
  title       text,                                    -- analysen beslutet kom från
  ticker      text        not null,
  name        text,
  action      text        not null,                    -- KÖP, ÖKA, KANDIDAT, BEHÅLL, AVVAKTA, MINSKA, SÄLJ
  direction   smallint    not null,                    -- +1 positiv syn, -1 negativ, 0 neutral
  price       numeric,                                 -- aktiens kurs när beslutet gavs
  currency    text,
  benchmark   text,                                    -- jämförelseindex (Yahoo-symbol)
  bench_price numeric,                                 -- indexets nivå när beslutet gavs
  note        text                                     -- AI:ns motivering
);

create index if not exists ai_decisions_user_idx on public.ai_decisions (user_id, created_at desc);

alter table public.ai_decisions enable row level security;

drop policy if exists "ai_decisions – läs egna" on public.ai_decisions;
create policy "ai_decisions – läs egna" on public.ai_decisions for select using (auth.uid() = user_id);
drop policy if exists "ai_decisions – skriv egna" on public.ai_decisions;
create policy "ai_decisions – skriv egna" on public.ai_decisions for insert with check (auth.uid() = user_id);
drop policy if exists "ai_decisions – ta bort egna" on public.ai_decisions;
create policy "ai_decisions – ta bort egna" on public.ai_decisions for delete using (auth.uid() = user_id);

-- Läs om API:ts schema direkt (annars kan det dröja innan tabellen syns för appen).
notify pgrst, 'reload schema';
