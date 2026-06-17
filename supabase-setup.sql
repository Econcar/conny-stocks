-- ════════════════════════════════════════════════════════════════
-- Supabase-uppsättning för bevakningslistan (kör i Supabase → SQL Editor)
-- ════════════════════════════════════════════════════════════════

-- Tabell: en rad per bevakad aktie/fond, kopplad till inloggad användare.
create table if not exists public.watchlist_items (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  item_id    text        not null,            -- ticker (aktie) eller orderBookId (fond)
  name       text        not null,
  label      text,
  is_fund    boolean     not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- Slå på Row-Level Security: varje användare kommer bara åt sina egna rader.
alter table public.watchlist_items enable row level security;

-- Policys: läs / lägg till / ta bort – enbart egna rader.
create policy "egna rader – select"
  on public.watchlist_items for select
  using (auth.uid() = user_id);

create policy "egna rader – insert"
  on public.watchlist_items for insert
  with check (auth.uid() = user_id);

create policy "egna rader – delete"
  on public.watchlist_items for delete
  using (auth.uid() = user_id);

-- (valfritt) tillåt uppdatering av egna rader, om du vill kunna byta namn/etikett senare
create policy "egna rader – update"
  on public.watchlist_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
