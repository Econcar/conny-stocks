-- Megatrender: lägg till strukturerad lista över påverkade bolag/fonder.
-- Kör i Supabase → SQL Editor (additivt, ofarligt).

alter table public.megatrends add column if not exists companies jsonb;
