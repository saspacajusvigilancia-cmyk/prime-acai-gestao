-- ============================================================================
-- 38 - Contexto autorizado e isolamento operacional por filial
-- ============================================================================
-- Aditiva e sem backfill operacional: movimentos sem origem comprovavel
-- permanecem sem filial e, portanto, fora do acesso operacional comum.

create table if not exists public.acessos_filiais (
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  filial_id uuid not null,
  usuario_id uuid not null
    references public.profiles(id) on delete cascade,
  ativo boolean not null default true,
  concedido_por uuid
    references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, filial_id),
  foreign key (filial_id, organization_id)
    references public.filiais(id, organization_id) on delete restrict
);

create index if not exists acessos_filiais_org_usuario_ativo_idx
  on public.acessos_filiais (organization_id, usuario_id, ativo);
create index if not exists acessos_filiais_filial_ativo_idx
  on public.acessos_filiais (filial_id, ativo);

alter table public.acessos_filiais enable row level security;
revoke all on public.acessos_filiais from public, anonymous, authenticated;

-- Buffet operations and their snapshots had no branch dimension. Keep existing
-- rows NULL; only new/updated rows are bound to an authorized active branch.
alter table public.fechamentos_buffet
  add column if not exists filial_id uuid;
alter table public.fechamentos_buffet_itens
  add column if not exists filial_id uuid;
alter table public.fechamentos_buffet_abertura
  add column if not exists filial_id uuid;
alter table public.perdas_buffet
  add column if not exists filial_id uuid;
alter table public.devolucoes_buffet
  add column if not exists filial_id uuid;
alter table public.estoque_operacoes_idempotencia
  add column if not exists filial_id uuid;
alter table public.recebimentos_compra_idempotencia
  add column if not exists filial_id uuid;
alter table public.estoque_operacoes_locais_v2
  add column if not exists filial_id uuid;

do $$
declare
  v_constraint text;
begin
  select c.conname into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.estoque_locais'::regclass
     and c.contype = 'u'
     and (
       select array_agg(a.attname order by a.attname)
         from unnest(c.conkey) k(attnum)
         join pg_attribute a
           on a.attrelid = c.conrelid and a.attnum = k.attnum
     ) = array['codigo', 'organization_id']::name[];

  if v_constraint is not null then
    execute format(
      'alter table public.estoque_locais drop constraint %I',
      v_constraint
    );
  end if;
end
$$;

create unique index if not exists estoque_locais_org_filial_codigo_uidx
  on public.estoque_locais (organization_id, filial_id, codigo);

create or replace function public.criar_locais_estoque_da_filial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.estoque_locais (
    organization_id, filial_id, codigo, nome
  )
  values
    (new.organization_id, new.id, 'loja', 'Estoque da loja'),
    (new.organization_id, new.id, 'geral', 'Estoque geral'),
    (new.organization_id, new.id, 'buffet', 'Estoque Buffet'),
    (new.organization_id, new.id, 'preparacao', 'Preparação'),
    (new.organization_id, new.id, 'producao', 'Produção')
  on conflict (organization_id, filial_id, codigo) do nothing;
  return new;
end;
$$;

drop trigger if exists criar_locais_estoque_da_filial on public.filiais;
create trigger criar_locais_estoque_da_filial
  after insert on public.filiais
  for each row execute function public.criar_locais_estoque_da_filial();

drop trigger if exists organizations_locais_estoque on public.organizations;

insert into public.estoque_locais (
  organization_id, filial_id, codigo, nome
)
select f.organization_id, f.id, local.codigo, local.nome
  from public.filiais f
 cross join (values
   ('loja', 'Estoque da loja'),
   ('geral', 'Estoque geral'),
   ('buffet', 'Estoque Buffet'),
   ('preparacao', 'Preparação'),
   ('producao', 'Produção')
 ) as local(codigo, nome)
on conflict (organization_id, filial_id, codigo) do nothing;

create index if not exists fechamentos_buffet_filial_idx
  on public.fechamentos_buffet (filial_id, aberto_em desc);
create index if not exists fechamentos_buffet_itens_filial_idx
  on public.fechamentos_buffet_itens (filial_id, fechamento_id);
create index if not exists fechamentos_buffet_abertura_filial_idx
  on public.fechamentos_buffet_abertura (filial_id, fechamento_id);
create index if not exists perdas_buffet_filial_idx
  on public.perdas_buffet (filial_id, criado_em desc);
create index if not exists devolucoes_buffet_filial_idx
  on public.devolucoes_buffet (filial_id, criado_em desc);
create index if not exists estoque_operacoes_idempotencia_filial_idx
  on public.estoque_operacoes_idempotencia (filial_id, criado_em desc);
create index if not exists recebimentos_compra_idempotencia_filial_idx
  on public.recebimentos_compra_idempotencia (filial_id, criado_em desc);

create or replace function public.filial_ativa()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.id
    from public.profiles p
    join public.filiais f
      on f.id = p.filial_id
     and f.organization_id = p.organization_id
    join public.acessos_filiais a
      on a.usuario_id = p.id
     and a.organization_id = p.organization_id
     and a.filial_id = f.id
     and a.ativo
   where p.id = (select auth.uid())
     and p.is_active
     and f.ativo
   limit 1
$$;

create or replace function public.minhas_filiais_autorizadas()
returns table (
  id uuid,
  organization_id uuid,
  empresa_id uuid,
  codigo text,
  numero bigint,
  nome text,
  nome_fantasia text,
  tipo text,
  atual boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.organization_id, f.empresa_id, f.codigo, f.numero,
         f.nome, f.nome_fantasia, f.tipo, (p.filial_id = f.id)
    from public.profiles p
    join public.acessos_filiais a
      on a.usuario_id = p.id
     and a.organization_id = p.organization_id
     and a.ativo
    join public.filiais f
      on f.id = a.filial_id
     and f.organization_id = a.organization_id
     and f.ativo
   where p.id = (select auth.uid())
     and p.is_active
   order by f.numero, f.id
$$;

create or replace function public.selecionar_filial(p_filial_id uuid)
returns public.filiais
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := (select auth.uid());
  v_filial public.filiais;
begin
  if v_usuario is null or p_filial_id is null then
    raise exception 'Sessao e filial sao obrigatorias.'
      using errcode = '42501';
  end if;

  select f.*
    into v_filial
    from public.profiles p
    join public.acessos_filiais a
      on a.usuario_id = p.id
     and a.organization_id = p.organization_id
     and a.filial_id = p_filial_id
     and a.ativo
    join public.filiais f
      on f.id = a.filial_id
     and f.organization_id = a.organization_id
     and f.ativo
   where p.id = v_usuario
     and p.is_active
   for update of p;

  if not found then
    raise exception 'Filial inativa ou nao autorizada para este usuario.'
      using errcode = '42501';
  end if;

  update public.profiles
     set filial_id = v_filial.id,
         updated_at = now()
   where id = v_usuario;

  return v_filial;
end;
$$;

create or replace function public.listar_acessos_filiais()
returns table (
  usuario_id uuid,
  nome_usuario text,
  email text,
  filial_id uuid,
  numero bigint,
  nome_filial text,
  ativo boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
begin
  if v_org is null or not public.pode('configuracoes', 'editar') then
    raise exception 'Sem permissao para consultar acessos por filial.'
      using errcode = '42501';
  end if;

  return query
    select p.id, p.full_name, p.email, f.id, f.numero, f.nome,
           coalesce(a.ativo, false)
      from public.profiles p
      cross join public.filiais f
      left join public.acessos_filiais a
        on a.usuario_id = p.id
       and a.filial_id = f.id
       and a.organization_id = v_org
     where p.organization_id = v_org
       and f.organization_id = v_org
     order by p.full_name, f.numero;
end;
$$;

create or replace function public.gerenciar_acesso_filial(
  p_usuario_id uuid,
  p_filial_id uuid,
  p_ativo boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_actor uuid := (select auth.uid());
begin
  if v_org is null or v_actor is null or p_usuario_id is null
     or p_filial_id is null or p_ativo is null then
    raise exception 'Organizacao, usuario, filial e permissao sao obrigatorios.'
      using errcode = '22023';
  end if;

  if not public.pode('configuracoes', 'editar') then
    raise exception 'Sem permissao para gerenciar acessos por filial.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles p
     where p.id = p_usuario_id
       and p.organization_id = v_org
  ) then
    raise exception 'Usuario nao encontrado nesta organizacao.'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.filiais f
     where f.id = p_filial_id
       and f.organization_id = v_org
       and f.ativo
  ) then
    raise exception 'Filial inativa ou nao encontrada nesta organizacao.'
      using errcode = 'P0002';
  end if;

  if not p_ativo
     and exists (
       select 1 from public.profiles p
        where p.id = p_usuario_id
          and p.organization_id = v_org
          and p.role = 'admin'
     )
     and not exists (
       select 1
         from public.acessos_filiais a
         join public.filiais f
           on f.id = a.filial_id
          and f.organization_id = a.organization_id
          and f.ativo
        where a.usuario_id = p_usuario_id
          and a.organization_id = v_org
          and a.ativo
          and a.filial_id <> p_filial_id
     ) then
    raise exception 'O administrador precisa manter acesso a pelo menos uma filial ativa.'
      using errcode = '42501';
  end if;

  insert into public.acessos_filiais (
    organization_id, filial_id, usuario_id, ativo, concedido_por, atualizado_em
  )
  values (v_org, p_filial_id, p_usuario_id, p_ativo, v_actor, now())
  on conflict (usuario_id, filial_id) do update
    set ativo = excluded.ativo,
        concedido_por = excluded.concedido_por,
        atualizado_em = now();

  if not p_ativo then
    update public.profiles
       set filial_id = null,
           updated_at = now()
     where id = p_usuario_id
       and organization_id = v_org
       and filial_id = p_filial_id;
  end if;

  insert into public.audit_logs (
    organization_id, actor_user_id, target_user_id, action, details
  )
  values (
    v_org, v_actor, p_usuario_id, 'acesso_filial_alterado',
    jsonb_build_object('filial_id', p_filial_id, 'ativo', p_ativo)
  );
end;
$$;

create or replace function public.bloquear_alteracao_direta_filial_perfil()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    raise exception 'Use a RPC autorizada para selecionar a filial.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.validar_contexto_filial_operacional()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_filial uuid := public.filial_ativa();
  v_org_text text;
  v_old_org_text text;
  v_org uuid;
begin
  if v_filial is null then
    raise exception 'Selecione uma filial autorizada antes da operacao.'
      using errcode = '42501';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    if old.filial_id is distinct from v_filial then
      raise exception 'A operacao nao pertence a filial ativa autorizada.'
        using errcode = '42501';
    end if;

    v_old_org_text := to_jsonb(old) ->> 'organization_id';
    if v_old_org_text is not null
       and v_old_org_text::uuid is distinct from public.minha_organizacao() then
      raise exception 'A organizacao do registro nao corresponde a sessao.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  v_org_text := to_jsonb(new) ->> 'organization_id';
  if v_org_text is not null then
    v_org := v_org_text::uuid;
    if v_org is distinct from public.minha_organizacao() then
      raise exception 'A organizacao do registro nao corresponde a sessao.'
        using errcode = '42501';
    end if;
  end if;

  if new.filial_id is null then
    new := jsonb_populate_record(new, jsonb_build_object('filial_id', v_filial));
  elsif new.filial_id is distinct from v_filial then
    raise exception 'A operacao nao pertence a filial ativa autorizada.'
      using errcode = '42501';
  end if;

  if to_jsonb(new) ? 'origem_deposito_id'
     and new.filial_id is not null
     and (
       (to_jsonb(new) ->> 'origem_deposito_id' is not null and not exists (
         select 1 from public.depositos d
          where d.id = (to_jsonb(new) ->> 'origem_deposito_id')::uuid
            and d.organization_id = public.minha_organizacao()
            and d.filial_id = v_filial
       ))
       or
       (to_jsonb(new) ->> 'destino_deposito_id' is not null and not exists (
         select 1 from public.depositos d
          where d.id = (to_jsonb(new) ->> 'destino_deposito_id')::uuid
            and d.organization_id = public.minha_organizacao()
            and d.filial_id = v_filial
       ))
     ) then
    raise exception 'Depositos de outra filial nao podem ser usados nesta operacao.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

do $$
declare
  v_tabela text;
begin
  for v_tabela in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'filial_id'
       and not a.attisdropped
       and c.relname not in (
         'profiles', 'filiais', 'depositos', 'acessos_filiais', 'estoque_locais'
       )
  loop
    execute format(
      'drop trigger if exists zz_validar_contexto_filial on public.%I',
      v_tabela
    );
    execute format(
      'create trigger zz_validar_contexto_filial
       before insert or update or delete on public.%I
       for each row execute function public.validar_contexto_filial_operacional()',
      v_tabela
    );
  end loop;
end
$$;

create or replace function public.validar_contexto_item_compra()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_filial uuid := public.filial_ativa();
  v_compra_id uuid;
begin
  if v_filial is null then
    raise exception 'Selecione uma filial autorizada antes da operacao.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    v_compra_id := old.compra_id;
  else
    v_compra_id := new.compra_id;
  end if;
  if not exists (
    select 1 from public.compras c
     where c.id = v_compra_id
       and c.filial_id = v_filial
  ) then
    raise exception 'O item da compra nao pertence a filial ativa autorizada.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists zz_validar_contexto_filial on public.compras_itens;
create trigger zz_validar_contexto_filial
  before insert or update or delete on public.compras_itens
  for each row execute function public.validar_contexto_item_compra();

drop index if exists public.fechamento_buffet_um_aberto_por_org;
create unique index if not exists fechamento_buffet_um_aberto_por_filial
  on public.fechamentos_buffet (organization_id, filial_id)
  where status = 'aberto' and filial_id is not null;

-- Buffet tables and sales/purchase children inherit authorization from their
-- own branch column or their parent transaction; no historic backfill occurs.
do $$
declare
  v_tabela text;
  v_filtro text;
begin
  for v_tabela in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public'
       and c.relkind = 'r'
       and a.attname = 'filial_id'
       and not a.attisdropped
       and c.relname not in ('profiles', 'acessos_filiais')
  loop
    v_filtro := 'filial_id = (select public.filial_ativa())';
    if exists (
      select 1
        from pg_attribute a
       where a.attrelid = format('public.%I', v_tabela)::regclass
         and a.attname = 'organization_id'
         and not a.attisdropped
    ) then
      v_filtro := v_filtro ||
        ' and organization_id = (select public.minha_organizacao())';
    end if;

    execute format(
      'drop policy if exists isolamento_filial_ativo on public.%I',
      v_tabela
    );
    execute format(
      'create policy isolamento_filial_ativo on public.%I
       as restrictive for all to authenticated
       using (%s)
       with check (%s)',
      v_tabela, v_filtro, v_filtro
    );
  end loop;
end
$$;

drop policy if exists compras_itens_filial_ativa on public.compras_itens;
create policy compras_itens_filial_ativa on public.compras_itens
  as restrictive for all to authenticated
  using (
    exists (
      select 1 from public.compras c
       where c.id = compras_itens.compra_id
         and c.filial_id = (select public.filial_ativa())
    )
  )
  with check (
    exists (
      select 1 from public.compras c
       where c.id = compras_itens.compra_id
         and c.filial_id = (select public.filial_ativa())
    )
  );

-- A chave de idempotencia da venda e global por organizacao no schema legado.
-- Em caso de colisao entre filiais, nunca devolve a venda de outra unidade.
do $$
declare
  v_def text;
  v_antigo text := E'and v.organization_id = v_org;';
begin
  select pg_get_functiondef(
    'public.registrar_venda(jsonb, text, uuid, text, text, text)'::regprocedure
  ) into v_def;

  if position('and v.filial_id = public.filial_ativa()' in v_def) = 0 then
    if position(v_antigo in v_def) = 0 then
      raise exception '38: nao foi possivel localizar o filtro organizacional da idempotencia de vendas.';
    end if;
    v_def := replace(
      v_def,
      v_antigo,
      E'and v.organization_id = v_org\n         and v.filial_id = public.filial_ativa();'
    );
    execute v_def;
  end if;
end
$$;

-- A compra, sua chave idempotente e o livro de estoque devem pertencer ao
-- contexto autorizado. As ancoras fazem a migracao falhar alto se o corpo
-- transacional mudar sem revisao.
do $$
declare
  v_def text;
  v_antigo text;
begin
  select pg_get_functiondef(
    'public.confirmar_recebimento_compra(uuid, jsonb)'::regprocedure
  ) into v_def;
  if position('and filial_id = public.filial_ativa()' in v_def) = 0 then
    v_antigo := E'and organization_id = v_org\n   for update;';
    if position(v_antigo in v_def) = 0 then
      raise exception '38: nao foi possivel localizar a compra na RPC de recebimento.';
    end if;
    v_def := replace(
      v_def,
      v_antigo,
      E'and organization_id = v_org\n     and filial_id = public.filial_ativa()\n   for update;'
    );
    execute v_def;
  end if;

  select pg_get_functiondef(
    'public.registrar_movimentacao_local_v3(uuid, numeric, text, text, text, text)'::regprocedure
  ) into v_def;
  if position('o.filial_id = public.filial_ativa()' in v_def) = 0 then
    v_antigo := E'and o.chave_idempotencia = v_chave;';
    if position(v_antigo in v_def) = 0 then
      raise exception '38: nao foi possivel localizar a chave de idempotencia do estoque.';
    end if;
    v_def := replace(
      v_def,
      v_antigo,
      E'and o.chave_idempotencia = v_chave\n      and o.filial_id = public.filial_ativa();'
    );
    execute v_def;
  end if;

  select pg_get_functiondef(
    'public.confirmar_recebimento_compra_idempotente(uuid, jsonb, text)'::regprocedure
  ) into v_def;
  if position('r.filial_id = public.filial_ativa()' in v_def) = 0 then
    v_def := regexp_replace(
      v_def,
      'and r[.]chave_idempotencia = v_chave[[:space:]]+for update;',
      E'and r.chave_idempotencia = v_chave\n        and r.filial_id = public.filial_ativa()\n      for update;'
    );
    if position('r.filial_id = public.filial_ativa()' in v_def) = 0 then
      raise exception '38: nao foi possivel localizar a chave de idempotencia do recebimento.';
    end if;
    execute v_def;

    v_def := regexp_replace(
      v_def,
      'and chave_idempotencia = v_chave;',
      E'and chave_idempotencia = v_chave\n     and filial_id = public.filial_ativa();'
    );
    if position(E'and chave_idempotencia = v_chave\n     and filial_id = public.filial_ativa();' in v_def) = 0 then
      raise exception '38: nao foi possivel localizar a atualizacao da chave de recebimento.';
    end if;
    execute v_def;
  end if;
end
$$;

create or replace function public.saldo_estoque(p_produto_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
begin
  if v_filial is null then
    raise exception 'Selecione uma filial autorizada para consultar o estoque.'
      using errcode = '42501';
  end if;

  return coalesce((
    select sum(case when m.destino = 'estoque' then m.quantidade
                    when m.origem = 'estoque' then -m.quantidade
                    else 0::numeric end)
      from public.movimentacoes_estoque m
     where m.produto_id = p_produto_id
       and m.organization_id = v_org
       and m.filial_id = v_filial
  ), 0::numeric);
end;
$$;

create or replace function public.saldo_estoque_local_v2(
  p_produto_id uuid,
  p_local text
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lancamento text;
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
begin
  if p_local not in ('geral', 'loja', 'buffet', 'preparacao', 'producao') then
    raise exception 'Local de estoque invalido.';
  end if;
  if v_filial is null then
    raise exception 'Selecione uma filial autorizada para consultar o estoque.'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.produtos p
     where p.id = p_produto_id and p.organization_id = v_org
  ) then
    raise exception 'Produto nao pertence a esta organizacao.'
      using errcode = 'P0002';
  end if;

  v_lancamento := case p_local
    when 'geral' then 'estoque_geral'
    when 'loja' then 'estoque'
    else p_local
  end;
  return coalesce((
    select sum(case when m.destino = v_lancamento then m.quantidade
                    when m.origem = v_lancamento then -m.quantidade
                    else 0::numeric end)
      from public.movimentacoes_estoque m
     where m.produto_id = p_produto_id
       and m.organization_id = v_org
       and m.filial_id = v_filial
  ), 0::numeric);
end;
$$;

create or replace function public.listar_saldos_estoque_por_local()
returns table (produto_id uuid, local text, saldo numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_filial uuid := public.filial_ativa();
  v_org uuid := public.minha_organizacao();
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta nao tem permissao para consultar estoque.'
      using errcode = '42501';
  end if;
  if v_filial is null then
    raise exception 'Selecione uma filial autorizada para consultar o estoque.'
      using errcode = '42501';
  end if;

  return query
    select p.id, l.codigo,
           coalesce(sum(case when m.destino = case l.codigo
                                      when 'geral' then 'estoque_geral'
                                      when 'loja' then 'estoque'
                                      else l.codigo
                                    end then m.quantidade
                             when m.origem = case l.codigo
                                      when 'geral' then 'estoque_geral'
                                      when 'loja' then 'estoque'
                                      else l.codigo
                                    end then -m.quantidade
                             else 0::numeric end), 0::numeric)
      from public.produtos p
      join public.estoque_locais l
        on l.organization_id = p.organization_id
       and l.filial_id = v_filial
       and l.ativo
      left join public.movimentacoes_estoque m
        on m.produto_id = p.id
       and m.organization_id = p.organization_id
       and m.filial_id = v_filial
     where p.organization_id = v_org
       and p.controla_estoque
     group by p.id, p.nome, l.codigo
     order by p.nome, l.codigo;
end;
$$;

-- `produtos.quantidade` foi cache de uma única loja. Com várias filiais, o
-- saldo operacional só pode vir do ledger filtrado; não publique o cache comum.
create or replace function public.movimento_de_estoque_aplica_saldo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

create or replace function public.produtos_saldo_vem_do_livro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.quantidade := 0;
  else
    new.quantidade := old.quantidade;
  end if;
  return new;
end;
$$;

create or replace function public.salvar_produto_com_imagem(
  p_produto jsonb,
  p_mime text default null,
  p_conteudo bytea default null,
  p_remover_imagem boolean default false
)
returns public.produtos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_produto public.produtos;
  v_id uuid := nullif(p_produto ->> 'id', '')::uuid;
begin
  if v_org is null or public.filial_ativa() is null then
    raise exception 'Selecione uma filial autorizada antes de salvar o produto.'
      using errcode = '42501';
  end if;

  if v_id is null then
    if not public.pode('estoque', 'criar') then
      raise exception 'Sem permissao para cadastrar produto.'
        using errcode = '42501';
    end if;

    insert into public.produtos (
      codigo, nome, descricao, categoria, quantidade, minimo, unidade,
      custo, preco, ativo, tipo_venda, controla_estoque, metodo_estoque,
      metodo_peso
    )
    values (
      p_produto ->> 'codigo',
      p_produto ->> 'nome',
      nullif(p_produto ->> 'descricao', ''),
      p_produto ->> 'categoria',
      0,
      coalesce(nullif(p_produto ->> 'minimo', '')::numeric, 0),
      coalesce(nullif(p_produto ->> 'unidade', ''), 'un'),
      coalesce(nullif(p_produto ->> 'custo', '')::numeric, 0),
      coalesce(nullif(p_produto ->> 'preco', '')::numeric, 0),
      coalesce((p_produto ->> 'ativo')::boolean, true),
      coalesce(nullif(p_produto ->> 'tipo_venda', ''), 'unidade'),
      coalesce((p_produto ->> 'controla_estoque')::boolean, true),
      coalesce(nullif(p_produto ->> 'metodo_estoque', ''), 'movimentacoes'),
      nullif(p_produto ->> 'metodo_peso', '')
    )
    returning * into v_produto;
  else
    if not public.pode('estoque', 'editar') then
      raise exception 'Sem permissao para editar produto.'
        using errcode = '42501';
    end if;

    update public.produtos
       set codigo = p_produto ->> 'codigo',
           nome = p_produto ->> 'nome',
           descricao = nullif(p_produto ->> 'descricao', ''),
           categoria = p_produto ->> 'categoria',
           minimo = coalesce(nullif(p_produto ->> 'minimo', '')::numeric, 0),
           unidade = coalesce(nullif(p_produto ->> 'unidade', ''), 'un'),
           custo = coalesce(nullif(p_produto ->> 'custo', '')::numeric, 0),
           preco = coalesce(nullif(p_produto ->> 'preco', '')::numeric, 0),
           ativo = coalesce((p_produto ->> 'ativo')::boolean, true),
           tipo_venda = coalesce(nullif(p_produto ->> 'tipo_venda', ''), 'unidade'),
           controla_estoque = coalesce((p_produto ->> 'controla_estoque')::boolean, true),
           metodo_estoque = coalesce(nullif(p_produto ->> 'metodo_estoque', ''), 'movimentacoes'),
           metodo_peso = nullif(p_produto ->> 'metodo_peso', '')
     where id = v_id
       and organization_id = v_org
     returning * into v_produto;

    if not found then
      raise exception 'Produto nao encontrado nesta organizacao.'
        using errcode = 'P0002';
    end if;
  end if;

  if p_remover_imagem then
    delete from public.imagens_produtos where produto_id = v_produto.id;
  elsif p_mime is not null or p_conteudo is not null then
    if p_mime not in ('image/jpeg', 'image/png', 'image/webp')
       or p_conteudo is null
       or octet_length(p_conteudo) not between 1 and 524288 then
      raise exception 'Imagem invalida: formato nao permitido ou tamanho acima de 512 KiB.';
    end if;

    insert into public.imagens_produtos (produto_id, mime, conteudo)
    values (v_produto.id, p_mime, p_conteudo)
    on conflict (produto_id) do update
      set mime = excluded.mime,
          conteudo = excluded.conteudo,
          atualizado_em = now();
  end if;

  v_produto.quantidade := 0;
  return v_produto;
end;
$$;

-- Existing stock RPCs validated local codes only at organization scope. Once
-- locations are duplicated by branch, every such lookup must use the active
-- branch as well or an active location in another branch could authorize it.
do $$
declare
  v_proc record;
  v_def text;
  v_original text;
begin
  for v_proc in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.prosrc like '%estoque_locais%'
  loop
    v_def := pg_get_functiondef(v_proc.oid);
    v_original := v_def;
    v_def := replace(
      v_def,
      'l.organization_id = v_org',
      'l.organization_id = v_org and l.filial_id = public.filial_ativa()'
    );
    v_def := replace(
      v_def,
      'l.organization_id = v_prod.organization_id',
      'l.organization_id = v_prod.organization_id and l.filial_id = public.filial_ativa()'
    );
    v_def := replace(
      v_def,
      'l.organization_id = new.organization_id',
      'l.organization_id = new.organization_id and l.filial_id = public.filial_ativa()'
    );
    v_def := replace(
      v_def,
      'l.organization_id = p.organization_id',
      'l.organization_id = p.organization_id and l.filial_id = public.filial_ativa()'
    );
    if v_def is distinct from v_original then
      execute v_def;
    end if;
  end loop;
end
$$;

revoke all on function public.salvar_produto_com_imagem(jsonb, text, bytea, boolean)
  from public, anonymous;
grant execute on function public.salvar_produto_com_imagem(jsonb, text, bytea, boolean)
  to authenticated;

do $$
begin
  if not exists (
    select 1
      from pg_proc p
     where p.oid = 'public.salvar_produto_com_imagem(jsonb, text, bytea, boolean)'::regprocedure
       and p.prosecdef
       and p.prosrc like '%public.pode(''estoque'', ''criar'')%'
  ) then
    raise exception '38: RPC de produto precisa ser SECURITY DEFINER com checagem de permissao.';
  end if;
end
$$;

-- Catalog data is shared, but its legacy single-store quantity is not.
revoke select on public.produtos from public, anonymous, authenticated;
do $$
declare
  v_coluna text;
begin
  for v_coluna in
    select a.attname
      from pg_attribute a
     where a.attrelid = 'public.produtos'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and a.attname <> 'quantidade'
  loop
    execute format(
      'grant select (%I) on public.produtos to authenticated',
      v_coluna
    );
  end loop;
end
$$;

do $$
declare
  v_view record;
begin
  for v_view in
    select schemaname, viewname
      from pg_views
     where schemaname = 'public'
  loop
    execute format(
      'alter view %I.%I set (security_invoker = true)',
      v_view.schemaname, v_view.viewname
    );
  end loop;
end
$$;

create or replace function public.filial_padrao(p_organization_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
begin
  if v_org is null or v_filial is null
     or (p_organization_id is not null and p_organization_id <> v_org) then
    return null;
  end if;
  return v_filial;
end;
$$;

create or replace function public.pode(p_modulo text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with eu as (
    select id, role
      from public.profiles
     where id = (select auth.uid())
       and is_active
  ),
  perm as (
    select id
      from public.permissions
     where module_key = p_modulo
       and action_key = p_acao
  ),
  autorizacao as (
    select coalesce(
      (select up.allowed
         from public.user_permissions up, eu
        where up.user_id = eu.id
          and up.permission_id = (select id from perm)),
      (select true
         from public.role_permissions rp
         join public.roles r on r.id = rp.role_id, eu
        where r.name = eu.role
          and rp.permission_id = (select id from perm)),
      false
    ) as permitido
  )
  select a.permitido
     and (
       p_modulo not in (
         'dashboard', 'estoque', 'vendas', 'compras', 'financeiro',
         'clientes', 'buffet', 'relatorios'
       )
       or public.filial_ativa() is not null
     )
    from autorizacao a
$$;

drop trigger if exists bloquear_alteracao_direta_filial_perfil on public.profiles;
create trigger bloquear_alteracao_direta_filial_perfil
  before update of filial_id on public.profiles
  for each row
  when (old.filial_id is distinct from new.filial_id)
  execute function public.bloquear_alteracao_direta_filial_perfil();

revoke all on function public.filial_ativa() from public, anonymous;
revoke all on function public.minhas_filiais_autorizadas() from public, anonymous;
revoke all on function public.selecionar_filial(uuid) from public, anonymous;
revoke all on function public.listar_acessos_filiais() from public, anonymous;
revoke all on function public.gerenciar_acesso_filial(uuid, uuid, boolean)
  from public, anonymous;
revoke all on function public.validar_contexto_filial_operacional()
  from public, anonymous, authenticated;
revoke all on function public.validar_contexto_item_compra()
  from public, anonymous, authenticated;
revoke all on function public.bloquear_alteracao_direta_filial_perfil()
  from public, anonymous, authenticated;
revoke all on function public.filial_padrao(uuid) from public, anonymous;
revoke all on function public.pode(text, text) from public, anonymous;

grant execute on function public.filial_ativa() to authenticated;
grant execute on function public.minhas_filiais_autorizadas() to authenticated;
grant execute on function public.selecionar_filial(uuid) to authenticated;
grant execute on function public.listar_acessos_filiais() to authenticated;
grant execute on function public.gerenciar_acesso_filial(uuid, uuid, boolean)
  to authenticated;
grant execute on function public.filial_padrao(uuid) to authenticated;
grant execute on function public.pode(text, text) to authenticated;
revoke all on function public.saldo_estoque(uuid)
  from public, anonymous, authenticated;

comment on table public.acessos_filiais is
  'Permissoes explicitas de usuarios por filial; nenhuma associacao historica e criada automaticamente.';
comment on function public.filial_ativa() is
  'Resolve a filial persistida somente se o perfil estiver ativo e possuir acesso explicito a uma filial ativa da mesma organizacao.';
comment on function public.selecionar_filial(uuid) is
  'Troca o contexto operacional persistente somente para filial autorizada.';
