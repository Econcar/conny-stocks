-- ════════════════════════════════════════════════════════════════
-- Motorns schema – pausa automatiska analyser och ställ in hur ofta de körs.
-- Ställs in i appen under AI-kostnader → Automatiska analyser. Motorn (GitHub Actions,
-- dagligen 06:00 UTC) läser tabellen och kör bara de jobb som är på och "dags", och
-- noterar last_run_at efter varje lyckad körning. Utan tabellen gäller standardvärdena.
-- Kör i Supabase → SQL Editor. Går att köra igen – befintliga inställningar ändras inte.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.engine_settings (
  id          text        primary key,                 -- jobbet: 'all' (hela motorn), 'news', 'risk', …
  enabled     boolean     not null default true,       -- false = pausat
  every_days  integer     check (every_days is null or every_days between 1 and 365), -- null = eget intervall saknas
  last_run_at timestamptz,                             -- senaste lyckade körning (skrivs av motorn)
  updated_at  timestamptz not null default now()
);

-- Publik läsning; inloggad användare får ändra (enanvändar-app – bara ägaren loggar in).
-- Motorn skriver med service-nyckeln (kringgår RLS).
alter table public.engine_settings enable row level security;

drop policy if exists "engine_settings – publik läsning" on public.engine_settings;
create policy "engine_settings – publik läsning" on public.engine_settings for select using (true);
drop policy if exists "engine_settings – auth insert" on public.engine_settings;
create policy "engine_settings – auth insert" on public.engine_settings for insert to authenticated with check (true);
drop policy if exists "engine_settings – auth update" on public.engine_settings;
create policy "engine_settings – auth update" on public.engine_settings for update to authenticated using (true) with check (true);

-- En rad per jobb med standardintervallen (samma som ENGINE_JOBS i shared/engine-schedule.js).
insert into public.engine_settings (id, every_days) values
  ('all', null), ('news', 1), ('deep', null), ('earnings', 1), ('risk', 1),
  ('megatrends', 7), ('cio', 1), ('aifunds', null), ('discovery', 7)
on conflict (id) do nothing;

-- Läs om API:ts schema direkt (annars kan det dröja innan tabellen syns för appen).
notify pgrst, 'reload schema';
