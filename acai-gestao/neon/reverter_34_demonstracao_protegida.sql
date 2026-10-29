-- Reversao da migracao 34: remove apenas a funcao de carga de demonstracao.
drop function if exists public.demo_carregar(text);
notify pgrst, 'reload schema';
