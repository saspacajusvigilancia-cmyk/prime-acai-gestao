-- 41 - Permite a consulta de saldo por local no contexto autorizado.
-- A funcao valida a organizacao e a filial ativa; nao liberar para PUBLIC ou
-- anonymous. A view vw_resumo usa SECURITY INVOKER e precisa deste GRANT.

revoke all on function public.saldo_estoque_local_v2(uuid, text)
  from public, anonymous;
grant execute on function public.saldo_estoque_local_v2(uuid, text)
  to authenticated;
