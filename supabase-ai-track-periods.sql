-- ════════════════════════════════════════════════════════════════
-- AI:ns träffsäkerhet – avslutade perioder. "↻ Starta ny period" i vyn sparar här
-- periodens start/slut, en sammanfattning (träffprocent per horisont, AI-alfa, per källa)
-- och en ögonblicksbild av alla beslut med utfall när perioden avslutades. Själva besluten
-- ligger kvar i ai_decisions och följs fortfarande upp. Kör i Supabase → SQL Editor.
-- Utan tabellen sparas perioderna bara lokalt (och laddas upp när tabellen finns).
-- Går att köra igen (t.ex. för att lägga till uppdateringsrätten) – inget data försvinner.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.ai_track_periods (
  id          uuid        primary key,                 -- sätts av appen (samma id lokalt och i molnet)
  user_id     uuid        not null default auth.uid(),
  created_at  timestamptz not null default now(),
  started_at  timestamptz,                             -- periodens början (föregående periods slut)
  ended_at    timestamptz not null,                    -- när perioden avslutades – nästa period börjar här
  label       text,                                    -- t.ex. "Period 1"
  summary     jsonb,                                   -- { all: {n, alpha, h:{1m:{done,hits},…}}, by_source: {…} }
  rows        jsonb                                    -- ögonblicksbild: beslut + utfall vid avslutet
);

create index if not exists ai_track_periods_user_idx on public.ai_track_periods (user_id, ended_at);

alter table public.ai_track_periods enable row level security;

drop policy if exists "ai_track_periods – läs egna" on public.ai_track_periods;
create policy "ai_track_periods – läs egna" on public.ai_track_periods for select using (auth.uid() = user_id);
drop policy if exists "ai_track_periods – skriv egna" on public.ai_track_periods;
create policy "ai_track_periods – skriv egna" on public.ai_track_periods for insert with check (auth.uid() = user_id);
-- Uppdatera: sammanfattningen fylls på i efterhand när 1/3/6 mån-utfallen nåtts.
drop policy if exists "ai_track_periods – uppdatera egna" on public.ai_track_periods;
create policy "ai_track_periods – uppdatera egna" on public.ai_track_periods for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "ai_track_periods – ta bort egna" on public.ai_track_periods;
create policy "ai_track_periods – ta bort egna" on public.ai_track_periods for delete using (auth.uid() = user_id);

-- Läs om API:ts schema direkt (annars kan det dröja innan tabellen syns för appen).
notify pgrst, 'reload schema';
