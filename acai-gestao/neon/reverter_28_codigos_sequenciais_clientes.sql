-- ============================================================================
-- Reversão da 28 — Código sequencial automático de clientes
-- ============================================================================
-- Remove os triggers, as funções e a sequência criados pela migração. Os
-- códigos já gravados permanecem intactos; a edição manual volta a ser
-- permitida quando os triggers deixam de existir.

drop trigger if exists clientes_codigo_imutavel on public.clientes;
drop trigger if exists clientes_codigo_automatico on public.clientes;

drop function if exists public.impedir_alteracao_codigo_cliente();
drop function if exists public.preencher_codigo_cliente();
drop function if exists public.proximo_codigo_cliente();

drop sequence if exists public.clientes_codigo_seq;

notify pgrst, 'reload schema';
