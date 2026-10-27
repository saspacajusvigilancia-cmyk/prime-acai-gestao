-- ============================================================================
-- 29 · Isolamento por organização: vendas, itens, clientes e lançamentos
-- ============================================================================
-- Até a 28 o banco era, na prática, de loja única: `vendas`, `itens_venda`,
-- `clientes` e `lancamentos` não tinham `organization_id`, e as políticas da 08
-- e da 17 liberavam por PERMISSÃO, não por organização. Quem tivesse a
-- permissão lia (e escrevia) dados de qualquer organização.
--
-- Esta migração decide pelo modelo MULTI-ORGANIZAÇÃO:
--   · acrescenta `organization_id` nas quatro tabelas;
--   · preenche as linhas existentes com a organização padrão (a mais antiga,
--     que é a única existente hoje);
--   · preenche automaticamente nas inserções novas — pelo JWT quando há sessão,
--     pela organização padrão quando a gravação vem de script/serviço;
--   · troca as políticas por permissão + organização.
--
-- O que continua igual de propósito:
--   · `codigo` de venda e de cliente seguem únicos GLOBALMENTE. O gerador
--     sequencial (26/28) não conhece organização; torná-lo por organização
--     exige uma migração própria. Fica registrado como limitação conhecida.
--   · Escritas de venda seguem exclusivamente pelas RPCs `security definer`
--     (08/11/18); não há policy de insert/update/delete para `vendas`.
--
-- Reverter: neon/reverter_29_multi_organizacao.sql
-- ============================================================================

-- ---------------------------------------------------- organização padrão ----
-- Usada apenas quando não há sessão (script, seed, manutenção). Com JWT, a
-- organização vem sempre de `minha_organizacao()`.
create or replace function public.organizacao_padrao()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.organizations order by created_at, id limit 1;
$$;

create or replace function public.preencher_organizacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is null then
    new.organization_id := coalesce(
      public.minha_organizacao(),
      public.organizacao_padrao()
    );
  end if;

  if new.organization_id is null then
    raise exception 'Nenhuma organização disponível para completar o registro.'
      using errcode = 'P0002';
  end if;

  return new;
end;
$$;

-- Itens herdam a organização da venda: um item nunca pertence a outra
-- organização que não a do cabeçalho.
create or replace function public.preencher_organizacao_item_venda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is null then
    select v.organization_id
      into new.organization_id
      from public.vendas v
     where v.id = new.venda_id;
  end if;

  if new.organization_id is null then
    new.organization_id := coalesce(
      public.minha_organizacao(),
      public.organizacao_padrao()
    );
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------- colunas ------
alter table public.vendas
  add column if not exists organization_id uuid references public.organizations (id);

alter table public.itens_venda
  add column if not exists organization_id uuid references public.organizations (id);

alter table public.clientes
  add column if not exists organization_id uuid references public.organizations (id);

alter table public.lancamentos
  add column if not exists organization_id uuid references public.organizations (id);

-- -------------------------------------------------------------- backfill ----
update public.vendas
   set organization_id = public.organizacao_padrao()
 where organization_id is null;

update public.clientes
   set organization_id = public.organizacao_padrao()
 where organization_id is null;

update public.lancamentos
   set organization_id = public.organizacao_padrao()
 where organization_id is null;

update public.itens_venda i
   set organization_id = v.organization_id
  from public.vendas v
 where v.id = i.venda_id
   and i.organization_id is null;

-- Item cuja venda desapareceu (não deveria existir, mas não se perde dado em
-- migração): assume a organização padrão.
update public.itens_venda
   set organization_id = public.organizacao_padrao()
 where organization_id is null;

alter table public.vendas      alter column organization_id set not null;
alter table public.itens_venda alter column organization_id set not null;
alter table public.clientes    alter column organization_id set not null;
alter table public.lancamentos alter column organization_id set not null;

-- -------------------------------------------------------------- triggers ----
drop trigger if exists vendas_organizacao on public.vendas;
create trigger vendas_organizacao
  before insert on public.vendas
  for each row execute function public.preencher_organizacao();

drop trigger if exists clientes_organizacao on public.clientes;
create trigger clientes_organizacao
  before insert on public.clientes
  for each row execute function public.preencher_organizacao();

drop trigger if exists lancamentos_organizacao on public.lancamentos;
create trigger lancamentos_organizacao
  before insert on public.lancamentos
  for each row execute function public.preencher_organizacao();

drop trigger if exists itens_venda_organizacao on public.itens_venda;
create trigger itens_venda_organizacao
  before insert on public.itens_venda
  for each row execute function public.preencher_organizacao_item_venda();

-- Vínculos entre organizações -------------------------------------------------
-- `registrar_venda()` é `security definer`: o RLS não vale dentro dela. Sem esta
-- conferência, um chamador poderia passar o uuid de um cliente/produto de outra
-- organização e a venda leria preço/estoque alheios. A validação roda no banco
-- para valer também para chamadas diretas à RPC, não só para a tela.
create or replace function public.validar_vinculos_da_venda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := coalesce(
    new.organization_id,
    public.minha_organizacao(),
    public.organizacao_padrao()
  );

  if v_org is null then
    return new; -- o trigger de organização levanta o erro apropriado
  end if;

  if new.cliente_id is not null
     and not exists (
       select 1 from public.clientes c
        where c.id = new.cliente_id
          and c.organization_id = v_org
     ) then
    raise exception 'Cliente não pertence a esta organização.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.validar_vinculos_do_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  v_org := new.organization_id;

  if v_org is null then
    select v.organization_id into v_org from public.vendas v where v.id = new.venda_id;
  end if;

  v_org := coalesce(v_org, public.minha_organizacao(), public.organizacao_padrao());
  if v_org is null then
    return new;
  end if;

  if not exists (
    select 1 from public.produtos p
     where p.id = new.produto_id
       and (p.organization_id is null or p.organization_id = v_org)
  ) then
    raise exception 'Produto não pertence a esta organização.' using errcode = '42501';
  end if;

  if new.recipiente_id is not null
     and not exists (
       select 1 from public.recipientes r
        where r.id = new.recipiente_id
          and r.organization_id = v_org
     ) then
    raise exception 'Recipiente não pertence a esta organização.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists vendas_validar_vinculos on public.vendas;
create trigger vendas_validar_vinculos
  before insert on public.vendas
  for each row execute function public.validar_vinculos_da_venda();

drop trigger if exists itens_venda_validar_vinculos on public.itens_venda;
create trigger itens_venda_validar_vinculos
  before insert on public.itens_venda
  for each row execute function public.validar_vinculos_do_item();

-- --------------------------------------------------------------- índices ----
create index if not exists idx_vendas_organizacao
  on public.vendas (organization_id, criado_em desc);
create index if not exists idx_itens_venda_organizacao
  on public.itens_venda (organization_id);
create index if not exists idx_clientes_organizacao
  on public.clientes (organization_id);
create index if not exists idx_lancamentos_organizacao
  on public.lancamentos (organization_id, data desc);

-- FKs que nunca tiveram índice (varreduras e deletes em cascata).
create index if not exists idx_vendas_usuario
  on public.vendas (usuario_id);
create index if not exists idx_movimentacoes_usuario
  on public.movimentacoes_estoque (usuario_id);
create index if not exists idx_fechamentos_itens_produto
  on public.fechamentos_buffet_itens (produto_id);
create index if not exists idx_perdas_produto
  on public.perdas_buffet (produto_id);
create index if not exists idx_devolucoes_produto
  on public.devolucoes_buffet (produto_id);
create index if not exists idx_transferencias_produto
  on public.transferencias_estoque (produto_id);
create index if not exists idx_notifications_organizacao
  on public.notifications (organization_id);
create index if not exists idx_venda_detalhes_tipo
  on public.venda_detalhes (tipo_venda_id);
create index if not exists idx_venda_detalhes_forma
  on public.venda_detalhes (forma_pagamento_id);

-- -------------------------------------------------------------- políticas ---
-- Vendas -------------------------------------------------------------------
drop policy if exists vendas_leitura on public.vendas;
create policy vendas_leitura on public.vendas
  for select to authenticated
  using (
    (select public.pode('vendas', 'consultar'))
    and organization_id = (select public.minha_organizacao())
  );

drop policy if exists itens_venda_leitura on public.itens_venda;
create policy itens_venda_leitura on public.itens_venda
  for select to authenticated
  using (
    (select public.pode('vendas', 'consultar'))
    and organization_id = (select public.minha_organizacao())
  );

-- Clientes ------------------------------------------------------------------
drop policy if exists clientes_leitura on public.clientes;
create policy clientes_leitura on public.clientes
  for select to authenticated
  using (
    (select public.pode('clientes', 'consultar'))
    and organization_id = (select public.minha_organizacao())
  );

drop policy if exists clientes_criacao on public.clientes;
create policy clientes_criacao on public.clientes
  for insert to authenticated
  with check (
    (select public.pode('clientes', 'criar'))
    and organization_id = (select public.minha_organizacao())
  );

drop policy if exists clientes_edicao on public.clientes;
create policy clientes_edicao on public.clientes
  for update to authenticated
  using (
    (select public.pode('clientes', 'editar'))
    and organization_id = (select public.minha_organizacao())
  )
  with check (
    (select public.pode('clientes', 'editar'))
    and organization_id = (select public.minha_organizacao())
  );

drop policy if exists clientes_exclusao on public.clientes;
create policy clientes_exclusao on public.clientes
  for delete to authenticated
  using (
    (select public.pode('clientes', 'excluir'))
    and organization_id = (select public.minha_organizacao())
  );

-- Lançamentos ---------------------------------------------------------------
drop policy if exists lancamentos_leitura on public.lancamentos;
create policy lancamentos_leitura on public.lancamentos
  for select to authenticated
  using (
    (select public.pode('financeiro', 'consultar'))
    and organization_id = (select public.minha_organizacao())
  );

drop policy if exists lancamentos_criacao on public.lancamentos;
create policy lancamentos_criacao on public.lancamentos
  for insert to authenticated
  with check (
    (select public.pode('financeiro', 'criar'))
    and organization_id = (select public.minha_organizacao())
  );

drop policy if exists lancamentos_edicao on public.lancamentos;
create policy lancamentos_edicao on public.lancamentos
  for update to authenticated
  using (
    (select public.pode('financeiro', 'editar'))
    and organization_id = (select public.minha_organizacao())
  )
  with check (
    (select public.pode('financeiro', 'editar'))
    and organization_id = (select public.minha_organizacao())
  );

drop policy if exists lancamentos_exclusao on public.lancamentos;
create policy lancamentos_exclusao on public.lancamentos
  for delete to authenticated
  using (
    (select public.pode('financeiro', 'excluir'))
    and organization_id = (select public.minha_organizacao())
  );

-- ------------------------------------------- permissões entre organizações --
-- As funções da 01 conferiam apenas "é administrador", não a organização do
-- alvo: um admin de A podia zerar permissões de um usuário de B sabendo o uuid.
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

  if not exists (
    select 1 from public.profiles
     where id = alvo and organization_id = public.minha_organizacao()
  ) then
    raise exception 'Usuário não encontrado nesta organização.' using errcode = 'P0002';
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

  if not exists (
    select 1 from public.profiles
     where id = alvo and organization_id = public.minha_organizacao()
  ) then
    raise exception 'Usuário não encontrado nesta organização.' using errcode = 'P0002';
  end if;

  delete from public.user_permissions where user_id = alvo;

  insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
  values (public.minha_organizacao(), (select auth.uid()), alvo, 'permissoes_restauradas',
          jsonb_build_object('origem', 'perfil'));
end;
$$;

-- ------------------------------------------------- portas antigas de escrita -
-- `registrar_movimentacao`, `ajustar_saldo` e `registrar_movimentacao_local`
-- foram substituídas por `*_v2`/`ajustar_saldo_estoque_local` (22/25), mas
-- seguem executáveis por `authenticated` — e a suíte de migrações ainda as
-- exercita como contrato público. Revogá-las é uma mudança de contrato e fica
-- registrada como pendência separada, fora desta migração.
--
--   revoke execute on function public.registrar_movimentacao(...)
--     from authenticated, public;  -- e as outras duas
--
-- Não faça isso sem atualizar `neon/validar-migracoes.mjs` e confirmar que
-- nenhum cliente antigo ainda chama as versões sem sufixo.

-- ------------------------------------------------------------ conferência ---
-- select table_name, column_name, is_nullable
--   from information_schema.columns
--  where table_schema = 'public'
--    and column_name = 'organization_id'
--    and table_name in ('vendas','itens_venda','clientes','lancamentos');
-- Esperado: is_nullable = 'NO' nas quatro.

-- select policyname, cmd, qual
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('vendas','itens_venda','clientes','lancamentos')
--  order by tablename, policyname;
-- Esperado: toda política cita organization_id.

notify pgrst, 'reload schema';
