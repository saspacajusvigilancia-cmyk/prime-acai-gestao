-- Reverte somente o que a migração 31 criou.
--
-- A RPC `definir_permissao_perfil` existia em produção antes desta migração
-- (foi criada manualmente e agora está versionada). A reversão a remove: em
-- ambientes criados pela cadeia isso devolve o estado anterior, e em produção
-- a função seria recriada ao reaplicar a migração. Nenhum dado é tocado.
--
-- Índices: nenhum dado, coluna, política ou função de negócio é tocado.

do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'definir_permissao_perfil'
  ) then
    drop function public.definir_permissao_perfil(text, text, text, boolean);
  end if;
end;
$$;

drop index if exists public.tipos_venda_categoria_org_idx;
drop index if exists public.movimentacoes_estoque_produto_organizacao_idx;

notify pgrst, 'reload schema';
