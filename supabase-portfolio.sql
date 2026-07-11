-- Portfölj: användarens Avanza-innehav, molnsynkat per konto (skyddat av RLS).
-- Kör i Supabase → SQL Editor. Speglar mönstret från supabase-signals/watchlist.

create table if not exists portfolio (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  ticker     text not null,          -- Yahoo-symbol (VOLV-B.ST, AMZN, CS.PA)
  name       text,                   -- bolagets namn
  isin       text,                   -- ISIN från Avanza (identifierare)
  quantity   numeric,                -- antal andelar (Avanzas "Volym")
  gav        numeric,                -- anskaffningskurs i innehavets valuta
  currency   text,                   -- valuta (USD, EUR, SEK ...)
  account    text,                   -- konto (valfritt)
  created_at timestamptz default now(),
  unique (user_id, ticker)
);

alter table portfolio enable row level security;

-- Bara ägaren får läsa/skriva sina egna rader.
drop policy if exists "portfolio_own_rows" on portfolio;
create policy "portfolio_own_rows" on portfolio
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
