-- Rollback seguro: desabilita as RPCs publicas sem restaurar o vazamento anterior.
-- As rotinas financeiras internas continuam usando saldo_parcela_interno().

revoke all on function public.saldo_parcela(uuid)
  from public, anonymous, authenticated;
revoke all on function public.custo_ficha_tecnica(uuid)
  from public, anonymous, authenticated;
