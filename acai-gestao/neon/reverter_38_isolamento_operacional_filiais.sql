-- Reverte a migration 38 sem descartar dados associados a filiais.
-- Execute antes das reversões 37 e 33.
do $$
begin
  if exists (select 1 from public.acessos_filiais) then
    raise exception
      'Reversão 38 abortada: existem acessos explícitos a filiais que precisam ser preservados.';
  end if;

  if exists (
    select 1 from public.fechamentos_buffet where filial_id is not null
    union all
    select 1 from public.fechamentos_buffet_itens where filial_id is not null
    union all
    select 1 from public.fechamentos_buffet_abertura where filial_id is not null
    union all
    select 1 from public.perdas_buffet where filial_id is not null
    union all
    select 1 from public.devolucoes_buffet where filial_id is not null
    union all
    select 1 from public.estoque_operacoes_idempotencia where filial_id is not null
    union all
    select 1 from public.recebimentos_compra_idempotencia where filial_id is not null
    union all
    select 1 from public.estoque_operacoes_locais_v2 where filial_id is not null
  ) then
    raise exception
      'Reversão 38 abortada: existem operações vinculadas a filiais; preserve o histórico antes de reverter.';
  end if;

  if exists (
    select 1
      from public.estoque_locais
     group by organization_id, codigo
    having count(*) > 1
  ) then
    raise exception
      'Reversão 38 abortada: há locais de estoque repetidos por filial que não podem voltar ao escopo da organização.';
  end if;

  if exists (
    select 1
      from public.fechamentos_buffet
     where status = 'aberto'
     group by organization_id
    having count(*) > 1
  ) then
    raise exception
      'Reversão 38 abortada: há mais de um fechamento aberto por organização; preserve os ciclos antes de reverter.';
  end if;
end
$$;

-- Remova primeiro objetos que referenciam o contexto de filial.
do $$
declare
  v_tabela text;
begin
  for v_tabela in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_policy p on p.polrelid = c.oid
     where n.nspname = 'public'
       and p.polname = 'isolamento_filial_ativo'
  loop
    execute format(
      'drop policy if exists isolamento_filial_ativo on public.%I',
      v_tabela
    );
  end loop;
end
$$;

drop policy if exists compras_itens_filial_ativa on public.compras_itens;

do $$
declare
  v_tabela text;
begin
  for v_tabela in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_trigger t on t.tgrelid = c.oid
     where n.nspname = 'public'
       and t.tgname = 'zz_validar_contexto_filial'
       and not t.tgisinternal
  loop
    execute format(
      'drop trigger if exists zz_validar_contexto_filial on public.%I',
      v_tabela
    );
  end loop;
end
$$;

drop trigger if exists zz_validar_contexto_filial on public.compras_itens;
drop trigger if exists bloquear_alteracao_direta_filial_perfil on public.profiles;
drop trigger if exists criar_locais_estoque_da_filial on public.filiais;

drop function if exists public.validar_contexto_item_compra();
drop function if exists public.validar_contexto_filial_operacional();
drop function if exists public.bloquear_alteracao_direta_filial_perfil();
drop function if exists public.gerenciar_acesso_filial(uuid, uuid, boolean);
drop function if exists public.listar_acessos_filiais();
drop function if exists public.selecionar_filial(uuid);
drop function if exists public.minhas_filiais_autorizadas();
drop function if exists public.filial_ativa();
drop function if exists public.criar_locais_estoque_da_filial();

drop index if exists public.acessos_filiais_org_usuario_ativo_idx;
drop index if exists public.acessos_filiais_filial_ativo_idx;
drop index if exists public.fechamentos_buffet_filial_idx;
drop index if exists public.fechamentos_buffet_itens_filial_idx;
drop index if exists public.fechamentos_buffet_abertura_filial_idx;
drop index if exists public.perdas_buffet_filial_idx;
drop index if exists public.devolucoes_buffet_filial_idx;
drop index if exists public.estoque_operacoes_idempotencia_filial_idx;
drop index if exists public.recebimentos_compra_idempotencia_filial_idx;
drop index if exists public.estoque_locais_org_filial_codigo_uidx;
drop index if exists public.fechamento_buffet_um_aberto_por_filial;

alter table public.fechamentos_buffet
  drop column if exists filial_id;
alter table public.fechamentos_buffet_itens
  drop column if exists filial_id;
alter table public.fechamentos_buffet_abertura
  drop column if exists filial_id;
alter table public.perdas_buffet
  drop column if exists filial_id;
alter table public.devolucoes_buffet
  drop column if exists filial_id;
alter table public.estoque_operacoes_idempotencia
  drop column if exists filial_id;
alter table public.recebimentos_compra_idempotencia
  drop column if exists filial_id;
alter table public.estoque_operacoes_locais_v2
  drop column if exists filial_id;

drop table if exists public.acessos_filiais;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.estoque_locais'::regclass
       and conname = 'estoque_locais_organization_id_codigo_key'
  ) then
    alter table public.estoque_locais
      add constraint estoque_locais_organization_id_codigo_key
      unique (organization_id, codigo);
  end if;
end
$$;

create unique index if not exists fechamento_buffet_um_aberto_por_org
  on public.fechamentos_buffet (organization_id)
  where status = 'aberto';

drop trigger if exists organizations_locais_estoque on public.organizations;
create trigger organizations_locais_estoque
  after insert on public.organizations
  for each row execute function public.seed_locais_estoque_nova_organizacao();

grant select on public.produtos to authenticated;

notify pgrst, 'reload schema';
