-- AI-fonder (AI-förvaltade fiktiva portföljer), molnsynkade per användare (RLS).
-- Kör i Supabase → SQL Editor. Hela fond-objektet sparas som JSON i data-kolumnen.

create table if not exists ai_funds (
  id         text primary key,       -- fondens id (genereras i klienten, aif_...)
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,         -- hela fond-objektet (innehav, strategi, logg ...)
  created_at timestamptz default now()
);

alter table ai_funds enable row level security;

drop policy if exists "ai_funds_own_rows" on ai_funds;
create policy "ai_funds_own_rows" on ai_funds
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists ai_funds_user_created_idx on ai_funds (user_id, created_at desc);
