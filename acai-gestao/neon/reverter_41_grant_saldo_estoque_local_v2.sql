-- Remove a permissao introduzida pela migracao 41, sem reabrir acesso publico.
revoke all on function public.saldo_estoque_local_v2(uuid, text)
  from public, anonymous, authenticated;
