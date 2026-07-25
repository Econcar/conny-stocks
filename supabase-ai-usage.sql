-- ════════════════════════════════════════════════════════════════
-- AI-kostnadslogg (kör i Supabase → SQL Editor). En rad per AI-anrop, oavsett
-- om det kommer från motorn (bakgrund) eller webbläsaren (on-demand). Sidan
-- "AI-kostnader" läser härifrån. Se docs/beslutslogg.md.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.ai_usage (
  id                  uuid        primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  user_id             uuid,                       -- null = motorn (bakgrund), annars auth.uid()
  context             text        not null,       -- 'engine-triage', 'chat', 'analysis', 'aifund' …
  model               text        not null,
  input_tokens        integer     not null default 0,
  output_tokens       integer     not null default 0,
  cache_read_tokens   integer     not null default 0,
  cache_create_tokens integer     not null default 0,
  web_searches        integer     not null default 0,
  cost_usd            numeric     not null default 0
);

create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;

-- Läsning: motorns rader (user_id null) är globala; egna on-demand-rader ser bara du.
drop policy if exists "ai_usage – läs egna + motorns" on public.ai_usage;
create policy "ai_usage – läs egna + motorns"
  on public.ai_usage for select
  using (user_id is null or user_id = auth.uid());

-- Skrivning från webbläsaren: bara inloggade, och bara i eget namn. Motorn skriver
-- med service-nyckeln och kringgår RLS (user_id sätts till null där).
drop policy if exists "ai_usage – skriv egna" on public.ai_usage;
create policy "ai_usage – skriv egna"
  on public.ai_usage for insert
  with check (auth.uid() = user_id);
