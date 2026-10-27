-- ============================================================================
-- Reverte a 29: volta as quatro tabelas ao modelo de loja única
-- ============================================================================
-- Nenhuma linha é apagada. As colunas `organization_id` são removidas depois
-- que as políticas voltam ao formato anterior (permissão apenas), que é
-- exatamente o estado deixado pelas migrações 08 e 17.
--
-- As permissões de execução revogadas pela 29 não são devolvidas: os caminhos
-- antigos de escrita (`registrar_movimentacao`, `ajustar_saldo`,
-- `registrar_movimentacao_local`) continuam sem uso pelo app atual.

-- ------------------------------------------------------------ políticas -----
drop policy if exists vendas_leitura on public.vendas;
create policy vendas_leitura on public.vendas
  for select to authenticated
  using ((select public.pode('vendas', 'consultar')));

drop policy if exists itens_venda_leitura on public.itens_venda;
create policy itens_venda_leitura on public.itens_venda
  for select to authenticated
  using ((select public.pode('vendas', 'consultar')));

drop policy if exists clientes_leitura on public.clientes;
create policy clientes_leitura on public.clientes
  for select to authenticated
  using ((select public.pode('clientes', 'consultar')));

drop policy if exists clientes_criacao on public.clientes;
create policy clientes_criacao on public.clientes
  for insert to authenticated
  with check ((select public.pode('clientes', 'criar')));

drop policy if exists clientes_edicao on public.clientes;
create policy clientes_edicao on public.clientes
  for update to authenticated
  using ((select public.pode('clientes', 'editar')))
  with check ((select public.pode('clientes', 'editar')));

drop policy if exists clientes_exclusao on public.clientes;
create policy clientes_exclusao on public.clientes
  for delete to authenticated
  using ((select public.pode('clientes', 'excluir')));

drop policy if exists lancamentos_leitura on public.lancamentos;
create policy lancamentos_leitura on public.lancamentos
  for select to authenticated
  using ((select public.pode('financeiro', 'consultar')));

drop policy if exists lancamentos_criacao on public.lancamentos;
create policy lancamentos_criacao on public.lancamentos
  for insert to authenticated
  with check ((select public.pode('financeiro', 'criar')));

drop policy if exists lancamentos_edicao on public.lancamentos;
create policy lancamentos_edicao on public.lancamentos
  for update to authenticated
  using ((select public.pode('financeiro', 'editar')))
  with check ((select public.pode('financeiro', 'editar')));

drop policy if exists lancamentos_exclusao on public.lancamentos;
create policy lancamentos_exclusao on public.lancamentos
  for delete to authenticated
  using ((select public.pode('financeiro', 'excluir')));

-- ---------------------------------------------------- funções de permissão --
create or replace function public.remover_permissao_usuario(alvo uuid, p_modulo text, p_acao text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem alterar permissões.' using errcode = '42501';
  end if;

  delete from public.user_permissions up
   using public.permissions p
   where up.permission_id = p.id
     and up.user_id = alvo
     and p.module_key = p_modulo
     and p.action_key = p_acao;

  insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
  values (public.minha_organizacao(), (select auth.uid()), alvo, 'permissao_restaurada',
          jsonb_build_object('modulo', p_modulo, 'acao', p_acao));
end;
$$;

create or replace function public.restaurar_permissoes_usuario(alvo uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem alterar permissões.' using errcode = '42501';
  end if;

  delete from public.user_permissions where user_id = alvo;

  insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
  values (public.minha_organizacao(), (select auth.uid()), alvo, 'permissoes_restauradas',
          jsonb_build_object('origem', 'perfil'));
end;
$$;

-- ------------------------------------------------ triggers e funções novas --
drop trigger if exists vendas_organizacao on public.vendas;
drop trigger if exists clientes_organizacao on public.clientes;
drop trigger if exists lancamentos_organizacao on public.lancamentos;
drop trigger if exists itens_venda_organizacao on public.itens_venda;
drop trigger if exists vendas_validar_vinculos on public.vendas;
drop trigger if exists itens_venda_validar_vinculos on public.itens_venda;

drop function if exists public.validar_vinculos_do_item();
drop function if exists public.validar_vinculos_da_venda();
drop function if exists public.preencher_organizacao_item_venda();
drop function if exists public.preencher_organizacao();
drop function if exists public.organizacao_padrao();

-- ---------------------------------------------------------------- índices ---
drop index if exists public.idx_vendas_organizacao;
drop index if exists public.idx_itens_venda_organizacao;
drop index if exists public.idx_clientes_organizacao;
drop index if exists public.idx_lancamentos_organizacao;
drop index if exists public.idx_vendas_usuario;
drop index if exists public.idx_movimentacoes_usuario;
drop index if exists public.idx_fechamentos_itens_produto;
drop index if exists public.idx_perdas_produto;
drop index if exists public.idx_devolucoes_produto;
drop index if exists public.idx_transferencias_produto;
drop index if exists public.idx_notifications_organizacao;
drop index if exists public.idx_venda_detalhes_tipo;
drop index if exists public.idx_venda_detalhes_forma;

-- ---------------------------------------------------------------- colunas ---
alter table public.itens_venda drop column if exists organization_id;
alter table public.vendas      drop column if exists organization_id;
alter table public.clientes    drop column if exists organization_id;
alter table public.lancamentos drop column if exists organization_id;

notify pgrst, 'reload schema';
