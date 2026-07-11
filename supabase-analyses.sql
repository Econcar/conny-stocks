-- Sparade AI-analyser, molnsynkade per användare (skyddat av RLS).
-- Kör i Supabase → SQL Editor. Speglar mönstret från portfolio/watchlist.

create table if not exists analyses (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text,                   -- kort rubrik (t.ex. "Portföljanalys")
  model      text,                   -- vilken modell som användes
  answer     text,                   -- själva analystexten
  created_at timestamptz default now()
);

alter table analyses enable row level security;

drop policy if exists "analyses_own_rows" on analyses;
create policy "analyses_own_rows" on analyses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists analyses_user_created_idx on analyses (user_id, created_at desc);
