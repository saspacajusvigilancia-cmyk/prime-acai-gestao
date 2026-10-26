-- Reverte somente a função e a sequência introduzidas pela migração 26.
-- Nenhum produto ou código já salvo é removido ou alterado.

drop function if exists public.proximo_codigo_produto();
drop sequence if exists public.produtos_codigo_seq;

notify pgrst, 'reload schema';
