-- ════════════════════════════════════════════════════════════════
-- Megatrend-teman i databasen (så de kan ändras/växa utan kodändring).
-- Kör i Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.themes (
  id         text        primary key,          -- slug, t.ex. "ai"
  name       text        not null,             -- visningsnamn
  keywords   text[]      not null default '{}',-- matchnings-nyckelord (gemener)
  status     text        not null default 'active', -- 'active' | 'suggested' | 'dismissed'
  rationale  text,                             -- AI:ns motivering (för förslag)
  origin     text        not null default 'ai',    -- 'seed' | 'ai'
  created_at timestamptz not null default now()
);

-- Publik läsning; inloggad användare får hantera teman (aktivera/avfärda förslag).
-- Enanvändar-app: bara ägaren loggar in. Motorn skriver med service-nyckeln (kringgår RLS).
alter table public.themes enable row level security;

create policy "themes – publik läsning"
  on public.themes for select using (true);
create policy "themes – auth insert"
  on public.themes for insert to authenticated with check (true);
create policy "themes – auth update"
  on public.themes for update to authenticated using (true) with check (true);
create policy "themes – auth delete"
  on public.themes for delete to authenticated using (true);

-- Seed: de fem ursprungliga temana (aktiva).
insert into public.themes (id, name, keywords, status, origin) values
  ('ai', 'AI & halvledare',
   array['ai','artificial intelligence','halvledar','chip','gpu','nvidia','semiconductor','datacenter','språkmodell','llm','openai','tsmc','amd','broadcom','avgo','nvda'],
   'active', 'seed'),
  ('electrification', 'Elektrifiering & EV',
   array['elbil','battery','batteri','laddning','tesla','elektrifiering','rivian','lucid','byd','charging','tsla','polestar'],
   'active', 'seed'),
  ('defense', 'Försvar & säkerhet',
   array['försvar','vapen','militär','nato','saab','lockheed','defense','missile','rheinmetall','upprustning','ukraina','lmt'],
   'active', 'seed'),
  ('energy', 'Energiomställning',
   array['energi','olja','oil','gas','vätgas','hydrogen','kärnkraft','nuclear','förnybar','renewable','sol','vind','wind','solar','xom','cvx'],
   'active', 'seed'),
  ('health', 'Hälsa & demografi',
   array['läkemedel','pharma','hälsa','bioteknik','biotech','novo','glp-1','vård','healthcare','vaccin','eli lilly','obesity','lly'],
   'active', 'seed')
on conflict (id) do nothing;
