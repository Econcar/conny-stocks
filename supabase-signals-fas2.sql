-- ════════════════════════════════════════════════════════════════
-- Fas 2-migration: djupanalys-kaskad. Kör i Supabase → SQL Editor EN gång.
-- Additiva kolumner – ofarligt, påverkar inte befintliga rader.
-- ════════════════════════════════════════════════════════════════

-- Fördjupad analys (rationale) från djup-modellen. Null för triage-only-signaler.
alter table public.signals add column if not exists analysis text;

-- Vilken modell som producerade den lagrade analysen (t.ex. claude-haiku-4-5
-- för triage, claude-opus-4-8 för djupanalys).
alter table public.signals add column if not exists model text;
