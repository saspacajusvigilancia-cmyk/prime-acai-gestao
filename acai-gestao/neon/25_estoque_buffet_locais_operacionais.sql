-- ============================================================================
-- 25 · Buffet e locais operacionais no ledger de estoque
-- ============================================================================
-- Aditiva: mantém movimentos e saldos existentes. Locais futuros são criados
-- inativos; somente Geral, Loja e Buffet ficam disponíveis para operação.

alter table public.estoque_locais
  drop constraint if exists estoque_locais_codigo_check;

alter table public.estoque_locais
  add constraint estoque_locais_codigo_check
  check (codigo in ('geral', 'loja', 'buffet', 'preparacao', 'producao'));

insert into public.estoque_locais (organization_id, codigo, nome, ativo)
select o.id, local.codigo, local.nome, local.ativo
  from public.organizations o
 cross join (values
   ('buffet', 'Estoque Buffet', true),
   ('preparacao', 'Preparação', false),
   ('producao', 'Produção', false)
 ) as local(codigo, nome, ativo)
on conflict (organization_id, codigo) do nothing;

create table if not exists public.estoque_operacoes_locais_v2 (
  movimentacao_id uuid primary key
    references public.movimentacoes_estoque(id) on delete restrict,
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  criado_em timestamptz not null default now()
);

alter table public.estoque_operacoes_locais_v2 enable row level security;
revoke all on public.estoque_operacoes_locais_v2 from anonymous, authenticated;

create or replace function public.seed_locais_estoque_nova_organizacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.estoque_locais (organization_id, codigo, nome, ativo) values
    (new.id, 'geral', 'Estoque geral', true),
    (new.id, 'loja', 'Estoque da loja', true),
    (new.id, 'buffet', 'Estoque Buffet', true),
    (new.id, 'preparacao', 'Preparação', false),
    (new.id, 'producao', 'Produção', false)
  on conflict (organization_id, codigo) do nothing;
  return new;
end;
$$;

alter table public.movimentacoes_estoque
  drop constraint if exists movimentacoes_estoque_origem_check,
  drop constraint if exists movimentacoes_estoque_destino_check;

alter table public.movimentacoes_estoque
  add constraint movimentacoes_estoque_origem_check
  check (origem in ('abertura', 'contagem', 'fornecedor', 'estoque',
                    'estoque_geral', 'buffet', 'preparacao', 'producao',
                    'sobra', 'perda', 'cliente')),
  add constraint movimentacoes_estoque_destino_check
  check (destino in ('abertura', 'contagem', 'fornecedor', 'estoque',
                     'estoque_geral', 'buffet', 'preparacao', 'producao',
                     'sobra', 'perda', 'cliente'));

alter table public.produtos
  drop constraint if exists produtos_local_estoque_origem_valido;

alter table public.produtos
  add constraint produtos_local_estoque_origem_valido
  check (local_estoque_origem in
    ('estoque', 'estoque_geral', 'buffet', 'preparacao', 'producao'));

create or replace function public.listar_saldos_estoque_por_local()
returns table (produto_id uuid, local text, saldo numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar estoque.'
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
       and l.ativo
      left join public.movimentacoes_estoque m
        on m.produto_id = p.id
       and m.organization_id = p.organization_id
     where p.organization_id = public.minha_organizacao()
       and p.controla_estoque
     group by p.id, p.nome, l.codigo
     order by p.nome, l.codigo;
end;
$$;

create or replace function public.saldo_estoque_local_v2(p_produto_id uuid, p_local text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lancamento text;
  v_org uuid := public.minha_organizacao();
begin
  if p_local not in ('geral', 'loja', 'buffet', 'preparacao', 'producao') then
    raise exception 'Local de estoque inválido.';
  end if;
  if not exists (
    select 1 from public.produtos p
     where p.id = p_produto_id and p.organization_id = v_org
  ) then
    raise exception 'Produto não pertence à filial atual.';
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
  ), 0::numeric);
end;
$$;

alter table public.transferencias_estoque
  drop constraint if exists transferencias_estoque_origem_check,
  drop constraint if exists transferencias_estoque_destino_check;

alter table public.transferencias_estoque
  add constraint transferencias_estoque_origem_check
    check (origem in ('geral', 'loja', 'buffet', 'preparacao', 'producao')),
  add constraint transferencias_estoque_destino_check
    check (destino in ('geral', 'loja', 'buffet', 'preparacao', 'producao'));

create or replace function public.registrar_movimentacao_local_v2(
  p_produto_id uuid,
  p_qtd numeric,
  p_origem text,
  p_destino text,
  p_motivo text
)
returns table (
  id uuid,
  produto_id uuid,
  quantidade numeric,
  origem text,
  destino text,
  motivo text,
  saldo_geral numeric,
  saldo_loja numeric,
  saldo_buffet numeric,
  criado_em timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_nome text;
  v_controla boolean;
  v_negativo boolean;
  v_local_origem text;
  v_local_destino text;
  v_id uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para movimentar o estoque.';
  end if;
  if not public.pode('estoque', 'criar') then
    raise exception 'Sua conta não tem permissão para movimentar estoque.'
      using errcode = '42501';
  end if;
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'A quantidade precisa ser maior que zero.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da movimentação.';
  end if;
  if p_origem is null or p_destino is null or p_origem = p_destino
     or p_origem not in ('fornecedor', 'estoque', 'estoque_geral', 'buffet',
                         'preparacao', 'producao', 'sobra', 'perda', 'cliente')
     or p_destino not in ('fornecedor', 'estoque', 'estoque_geral', 'buffet',
                          'preparacao', 'producao', 'sobra', 'perda', 'cliente') then
    raise exception 'Escolha locais diferentes e válidos para a movimentação.';
  end if;

  v_local_origem := case p_origem
    when 'estoque' then 'loja'
    when 'estoque_geral' then 'geral'
    when 'buffet' then 'buffet'
    when 'preparacao' then 'preparacao'
    when 'producao' then 'producao'
    else null
  end;
  v_local_destino := case p_destino
    when 'estoque' then 'loja'
    when 'estoque_geral' then 'geral'
    when 'buffet' then 'buffet'
    when 'preparacao' then 'preparacao'
    when 'producao' then 'producao'
    else null
  end;

  if v_local_origem is not null and v_local_destino is not null then
    raise exception 'Use a operação de transferência entre locais de estoque.';
  end if;

  select p.nome, p.controla_estoque, p.permitir_estoque_negativo
    into v_nome, v_controla, v_negativo
    from public.produtos p
   where p.id = p_produto_id
     and p.organization_id = v_org
   for update;
  if not found then
    raise exception 'Item de estoque não encontrado na filial atual.';
  end if;
  if not v_controla then
    raise exception 'O item "%" está marcado como sem controle de estoque.', v_nome;
  end if;

  if v_local_origem is not null and not exists (
    select 1 from public.estoque_locais l
     where l.organization_id = v_org
       and l.codigo = v_local_origem
       and l.ativo
  ) then
    raise exception 'O local de origem está inativo ou não pertence à filial.';
  end if;
  if v_local_destino is not null and not exists (
    select 1 from public.estoque_locais l
     where l.organization_id = v_org
       and l.codigo = v_local_destino
       and l.ativo
  ) then
    raise exception 'O local de destino está inativo ou não pertence à filial.';
  end if;
  if v_local_origem is not null
     and public.saldo_estoque_local_v2(p_produto_id, v_local_origem) < p_qtd
     and not coalesce(v_negativo, false) then
    raise exception 'Saldo insuficiente no estoque % para "%".', v_local_origem, v_nome;
  end if;

  insert into public.movimentacoes_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
  values
    (v_org, p_produto_id, p_qtd, p_origem, p_destino, btrim(p_motivo), v_usuario)
  returning movimentacoes_estoque.id into v_id;

  insert into public.estoque_operacoes_locais_v2 (movimentacao_id, organization_id)
  values (v_id, v_org);

  return query
    select m.id, m.produto_id, m.quantidade, m.origem, m.destino, m.motivo,
           public.saldo_estoque_local_v2(m.produto_id, 'geral'),
           public.saldo_estoque_local_v2(m.produto_id, 'loja'),
           public.saldo_estoque_local_v2(m.produto_id, 'buffet'),
           m.criado_em
      from public.movimentacoes_estoque m
     where m.id = v_id;
end;
$$;

create or replace function public.transferir_estoque_local_v2(
  p_produto_id uuid,
  p_qtd numeric,
  p_origem text,
  p_destino text,
  p_motivo text,
  p_chave_idempotencia text
)
returns table (
  id uuid,
  produto_id uuid,
  quantidade numeric,
  origem text,
  destino text,
  motivo text,
  chave_idempotencia text,
  movimentacao_id uuid,
  saldo_geral numeric,
  saldo_loja numeric,
  saldo_buffet numeric,
  criado_em timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_nome text;
  v_controla boolean;
  v_negativo boolean;
  v_transferencia public.transferencias_estoque%rowtype;
  v_origem text;
  v_destino text;
  v_mov uuid;
  v_id uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para transferir estoque.';
  end if;
  if not public.pode('estoque', 'criar') then
    raise exception 'Sua conta não tem permissão para transferir estoque.'
      using errcode = '42501';
  end if;
  if p_qtd is null or p_qtd <= 0 then
    raise exception 'A quantidade precisa ser maior que zero.';
  end if;
  if p_origem not in ('geral', 'loja', 'buffet', 'preparacao', 'producao')
     or p_destino not in ('geral', 'loja', 'buffet', 'preparacao', 'producao')
     or p_origem = p_destino then
    raise exception 'Selecione dois locais de estoque diferentes e válidos.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' or coalesce(btrim(p_chave_idempotencia), '') = '' then
    raise exception 'Informe o motivo e a chave de idempotência da transferência.';
  end if;

  select p.nome, p.controla_estoque, p.permitir_estoque_negativo
    into v_nome, v_controla, v_negativo
    from public.produtos p
   where p.id = p_produto_id and p.organization_id = v_org
   for update;
  if not found then
    raise exception 'Item de estoque não encontrado na filial atual.';
  end if;
  if not v_controla then
    raise exception 'O item "%" está marcado como sem controle de estoque.', v_nome;
  end if;

  if not exists (
    select 1 from public.estoque_locais l
     where l.organization_id = v_org and l.codigo = p_origem and l.ativo
  ) or not exists (
    select 1 from public.estoque_locais l
     where l.organization_id = v_org and l.codigo = p_destino and l.ativo
  ) then
    raise exception 'Um dos locais está inativo ou não pertence à filial.';
  end if;

  select t.* into v_transferencia
    from public.transferencias_estoque t
   where t.organization_id = v_org
     and t.chave_idempotencia = p_chave_idempotencia;
  if found then
    if v_transferencia.produto_id <> p_produto_id
       or v_transferencia.quantidade <> p_qtd
       or v_transferencia.origem <> p_origem
       or v_transferencia.destino <> p_destino
       or v_transferencia.motivo <> btrim(p_motivo) then
      raise exception 'A chave de idempotência já foi usada em outra transferência.';
    end if;
    return query
      select t.id, t.produto_id, t.quantidade, t.origem, t.destino, t.motivo,
             t.chave_idempotencia, t.movimentacao_id,
             public.saldo_estoque_local_v2(t.produto_id, 'geral'),
             public.saldo_estoque_local_v2(t.produto_id, 'loja'),
             public.saldo_estoque_local_v2(t.produto_id, 'buffet'), t.criado_em
        from public.transferencias_estoque t
       where t.id = v_transferencia.id;
    return;
  end if;

  if public.saldo_estoque_local_v2(p_produto_id, p_origem) < p_qtd
     and not coalesce(v_negativo, false) then
    raise exception 'Saldo insuficiente no estoque % para "%".', p_origem, v_nome;
  end if;

  v_origem := case p_origem when 'geral' then 'estoque_geral'
                            when 'loja' then 'estoque'
                            else p_origem end;
  v_destino := case p_destino when 'geral' then 'estoque_geral'
                              when 'loja' then 'estoque'
                              else p_destino end;

  insert into public.movimentacoes_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
  values
    (v_org, p_produto_id, p_qtd, v_origem, v_destino, btrim(p_motivo), v_usuario)
  returning movimentacoes_estoque.id into v_mov;

  insert into public.transferencias_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo,
     chave_idempotencia, movimentacao_id, usuario_id)
  values
    (v_org, p_produto_id, p_qtd, p_origem, p_destino, btrim(p_motivo),
     p_chave_idempotencia, v_mov, v_usuario)
  returning transferencias_estoque.id into v_id;

  insert into public.estoque_operacoes_locais_v2 (movimentacao_id, organization_id)
  values (v_mov, v_org);

  return query
    select t.id, t.produto_id, t.quantidade, t.origem, t.destino, t.motivo,
           t.chave_idempotencia, t.movimentacao_id,
           public.saldo_estoque_local_v2(t.produto_id, 'geral'),
           public.saldo_estoque_local_v2(t.produto_id, 'loja'),
           public.saldo_estoque_local_v2(t.produto_id, 'buffet'), t.criado_em
      from public.transferencias_estoque t
     where t.id = v_id;
end;
$$;

drop function if exists public.ajustar_saldo_estoque_local(uuid, numeric, text, text, text);
create or replace function public.ajustar_saldo_estoque_local(
  p_produto_id uuid,
  p_contado numeric,
  p_motivo text,
  p_local text,
  p_tipo text default 'contagem'
)
returns table (
  saldo_anterior numeric,
  saldo numeric,
  movimentacao_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_nome text;
  v_controla boolean;
  v_anterior numeric;
  v_delta numeric;
  v_lancamento text;
  v_mov uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para contar estoque.';
  end if;
  if not public.pode('estoque', 'editar') then
    raise exception 'Sua conta não tem permissão para ajustar saldo de estoque.'
      using errcode = '42501';
  end if;
  if p_contado is null or p_contado < 0 then
    raise exception 'O saldo contado precisa ser maior ou igual a zero.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da contagem.';
  end if;
  if p_local not in ('geral', 'loja', 'buffet', 'preparacao', 'producao')
     or p_tipo not in ('abertura', 'contagem') then
    raise exception 'Local ou tipo de contagem inválido.';
  end if;

  select p.nome, p.controla_estoque
    into v_nome, v_controla
    from public.produtos p
   where p.id = p_produto_id and p.organization_id = v_org
   for update;
  if not found or not v_controla then
    raise exception 'Produto não encontrado ou sem controle de estoque.';
  end if;
  if not exists (
    select 1 from public.estoque_locais l
     where l.organization_id = v_org and l.codigo = p_local and l.ativo
  ) then
    raise exception 'O local de contagem está inativo ou não pertence à filial.';
  end if;

  v_anterior := public.saldo_estoque_local_v2(p_produto_id, p_local);
  if p_tipo = 'abertura' and v_anterior <> 0 then
    raise exception 'O saldo inicial só pode ser registrado antes de haver movimentos nesse local.';
  end if;
  v_delta := p_contado - v_anterior;
  v_lancamento := case p_local when 'geral' then 'estoque_geral'
                               when 'loja' then 'estoque'
                               else p_local end;

  if v_delta > 0 then
    insert into public.movimentacoes_estoque
      (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
    values
      (v_org, p_produto_id, v_delta, p_tipo, v_lancamento, btrim(p_motivo), v_usuario)
    returning movimentacoes_estoque.id into v_mov;
  elsif v_delta < 0 then
    insert into public.movimentacoes_estoque
      (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
    values
      (v_org, p_produto_id, abs(v_delta), v_lancamento, 'contagem', btrim(p_motivo), v_usuario)
    returning movimentacoes_estoque.id into v_mov;
  end if;

  if v_mov is not null then
    insert into public.estoque_operacoes_locais_v2 (movimentacao_id, organization_id)
    values (v_mov, v_org);
  end if;

  return query select v_anterior, p_contado, v_mov;
end;
$$;

-- O recebimento continua em uma única transação e pela RPC já usada pelo app.
-- A função passa a aceitar `local` por item, sem criar uma segunda porta de
-- entrada. Alterações de forma inesperada falham a migração explicitamente.
do $$
declare
  v_def text;
  v_declaracao_antiga text := 'v_qtd_base       numeric;';
  v_declaracao_nova text := 'v_qtd_base       numeric;' || E'\n  v_local          text;';
  v_saldo_antigo text := 'v_saldo    := public.saldo_estoque(v_item.produto_id);';
  v_saldo_novo text := $replace$
    v_local := coalesce(nullif(v_entrada->>'local', ''), 'loja');
    if v_local not in ('loja', 'geral', 'buffet') or not exists (
      select 1 from public.estoque_locais l
       where l.organization_id = v_org and l.codigo = v_local and l.ativo
    ) then
      raise exception 'O local de destino do recebimento está inválido ou inativo.';
    end if;
    v_saldo := public.saldo_estoque_local_v2(v_item.produto_id, 'loja')
               + public.saldo_estoque_local_v2(v_item.produto_id, 'geral')
               + public.saldo_estoque_local_v2(v_item.produto_id, 'buffet');
$replace$;
  v_entrada_nova text :=
    'values' || E'\n      (v_org, v_item.produto_id, v_qtd_base, ''fornecedor'', ' ||
    'case v_local when ''loja'' then ''estoque'' when ''geral'' then ''estoque_geral'' else ''buffet'' end, ' ||
    'v_motivo, v_usuario);';
  v_entrada_padrao text :=
    'values[[:space:]]*[(][[:space:]]*v_org,[[:space:]]*v_item[.]produto_id,' ||
    '[[:space:]]*v_qtd_base,[[:space:]]*''fornecedor'',[[:space:]]*''estoque'',' ||
    '[[:space:]]*v_motivo,[[:space:]]*v_usuario[[:space:]]*[)];';
  v_produto_sem_lock text := 'where p.id = v_item.produto_id;';
  v_produto_com_lock text := 'where p.id = v_item.produto_id for update;';
begin
  select pg_get_functiondef(
    'public.confirmar_recebimento_compra(uuid, jsonb)'::regprocedure
  ) into v_def;

  if position('public.saldo_estoque_local_v2(v_item.produto_id' in v_def) = 0 then
    if position(v_declaracao_nova in v_def) = 0 then
      if position(v_declaracao_antiga in v_def) = 0 then
        raise exception 'Migração 25 não reconheceu as variáveis de confirmar_recebimento_compra().';
      end if;
      v_def := replace(v_def, v_declaracao_antiga, v_declaracao_nova);
    end if;
    if position(v_saldo_antigo in v_def) = 0 then
      raise exception 'Migração 25 não reconheceu o cálculo de saldo no recebimento de compras.';
    end if;
    v_def := replace(v_def, v_saldo_antigo, v_saldo_novo);
    if v_def !~ v_entrada_padrao then
      raise exception 'Migração 25 não reconheceu o movimento de entrada do recebimento de compras.';
    end if;
    v_def := regexp_replace(v_def, v_entrada_padrao, v_entrada_nova, 'g');
    if position(v_produto_com_lock in v_def) = 0 then
      if position(v_produto_sem_lock in v_def) = 0 then
        raise exception 'Migração 25 não reconheceu o bloqueio concorrente do produto recebido.';
      end if;
      v_def := replace(v_def, v_produto_sem_lock, v_produto_com_lock);
    end if;
    execute v_def;
  end if;
end
$$;

-- ============================================================================
-- Fechamento auditável do Buffet
-- ============================================================================
insert into public.permissions (module_key, action_key, description) values
  ('estoque', 'fechar_buffet', 'Fechar e reconciliar o Estoque Buffet'),
  ('estoque', 'reabrir_buffet', 'Reabrir um fechamento do Buffet para correção')
on conflict (module_key, action_key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
  from public.roles r
  join public.permissions p
    on p.module_key = 'estoque'
   and p.action_key in ('fechar_buffet', 'reabrir_buffet')
 where r.name in ('admin', 'manager')
on conflict do nothing;

create table if not exists public.fechamentos_buffet (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
    references public.organizations(id) on delete restrict,
  status text not null default 'aberto'
    check (status in ('aberto', 'fechado', 'reaberto')),
  aberto_por uuid references public.profiles(id) on delete set null,
  aberto_em timestamptz not null default now(),
  fechado_por uuid references public.profiles(id) on delete set null,
  fechado_em timestamptz,
  payload_hash text,
  reaberto_por uuid references public.profiles(id) on delete set null,
  reaberto_em timestamptz,
  motivo_reabertura text,
  criado_em timestamptz not null default now(),
  constraint fechamento_buffet_estado_consistente check (
    (status = 'aberto' and fechado_em is null and reaberto_em is null)
    or (status = 'fechado' and fechado_em is not null and reaberto_em is null)
    or (status = 'reaberto' and fechado_em is not null
        and reaberto_em is not null and motivo_reabertura is not null)
  )
);

create unique index if not exists fechamento_buffet_um_aberto_por_org
  on public.fechamentos_buffet (organization_id) where status = 'aberto';

create table if not exists public.fechamentos_buffet_itens (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null
    references public.fechamentos_buffet(id) on delete restrict,
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  produto_id uuid not null
    references public.produtos(id) on delete restrict,
  saldo_sistema numeric(14, 3) not null check (saldo_sistema >= 0),
  saldo_contado numeric(14, 3) not null check (saldo_contado >= 0),
  diferenca numeric(14, 3) not null,
  movimentacao_id uuid unique
    references public.movimentacoes_estoque(id) on delete restrict,
  criado_em timestamptz not null default now(),
  unique (fechamento_id, produto_id)
);

alter table public.fechamentos_buffet enable row level security;
alter table public.fechamentos_buffet_itens enable row level security;
drop policy if exists fechamentos_buffet_leitura on public.fechamentos_buffet;
create policy fechamentos_buffet_leitura on public.fechamentos_buffet
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'consultar'))
  );
drop policy if exists fechamentos_buffet_itens_leitura on public.fechamentos_buffet_itens;
create policy fechamentos_buffet_itens_leitura on public.fechamentos_buffet_itens
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'consultar'))
  );

revoke all on public.fechamentos_buffet, public.fechamentos_buffet_itens
  from anonymous, authenticated;
grant select on public.fechamentos_buffet, public.fechamentos_buffet_itens to authenticated;

create or replace function public.abrir_fechamento_buffet()
returns table (id uuid, status text, aberto_em timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_id uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para abrir o fechamento.';
  end if;
  if not public.pode('estoque', 'fechar_buffet') then
    raise exception 'Sua conta não tem permissão para abrir o fechamento do Buffet.'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.estoque_locais l
     where l.organization_id = v_org and l.codigo = 'buffet' and l.ativo
  ) then
    raise exception 'O Estoque Buffet não está ativo nesta filial.';
  end if;

  insert into public.fechamentos_buffet as f (organization_id, aberto_por)
  values (v_org, v_usuario)
  returning f.id into v_id;

  return query
    select f.id, f.status, f.aberto_em
      from public.fechamentos_buffet f where f.id = v_id;
exception
  when unique_violation then
    raise exception 'Já existe um fechamento aberto para o Estoque Buffet.';
end;
$$;

create or replace function public.fechar_fechamento_buffet(
  p_id uuid,
  p_itens jsonb
)
returns table (id uuid, status text, itens integer, ajustes integer, fechado_em timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_fechamento public.fechamentos_buffet%rowtype;
  v_entrada jsonb;
  v_produto public.produtos%rowtype;
  v_contado numeric;
  v_sistema numeric;
  v_delta numeric;
  v_mov uuid;
  v_itens integer := 0;
  v_ajustes integer := 0;
  v_hash text;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para fechar o Buffet.';
  end if;
  if not public.pode('estoque', 'fechar_buffet') then
    raise exception 'Sua conta não tem permissão para fechar o Buffet.'
      using errcode = '42501';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Informe a contagem dos itens do Buffet.';
  end if;
  v_hash := md5(p_itens::text);

  select f.* into v_fechamento
    from public.fechamentos_buffet f
   where f.id = p_id and f.organization_id = v_org
   for update;
  if not found then
    raise exception 'Fechamento não encontrado nesta filial.';
  end if;
  if v_fechamento.status = 'fechado' then
    if v_fechamento.payload_hash <> v_hash then
      raise exception 'Este fechamento já foi confirmado com outra contagem.';
    end if;
    return query
      select f.id, f.status,
             (select count(*)::integer from public.fechamentos_buffet_itens i where i.fechamento_id = f.id),
             (select count(*)::integer from public.fechamentos_buffet_itens i
               where i.fechamento_id = f.id and i.movimentacao_id is not null),
             f.fechado_em
        from public.fechamentos_buffet f where f.id = p_id;
    return;
  end if;
  if v_fechamento.status <> 'aberto' then
    raise exception 'Fechamento reaberto não pode ser confirmado novamente. Abra um novo ciclo.';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_itens) e
     group by e->>'produto_id'
    having count(*) > 1
  ) then
    raise exception 'Um produto apareceu mais de uma vez na contagem.';
  end if;
  if jsonb_array_length(p_itens) <> (
    select count(*) from public.produtos p
     where p.organization_id = v_org
       and p.ativo
       and p.controla_estoque
       and p.tipo_produto in ('buffet', 'insumo')
  ) then
    raise exception 'A contagem precisa incluir todos os produtos ativos de Buffet e insumos da filial.';
  end if;

  perform p.id
    from public.produtos p
   where p.organization_id = v_org
     and p.ativo
     and p.controla_estoque
     and p.tipo_produto in ('buffet', 'insumo')
   order by p.id
   for update;

  for v_entrada in select * from jsonb_array_elements(p_itens)
  loop
    if coalesce(v_entrada->>'produto_id', '') !~* '^[0-9a-f-]{36}$'
       or coalesce(v_entrada->>'quantidade', '') !~ '^[0-9]+([.][0-9]+)?$' then
      raise exception 'Produto ou quantidade inválida na contagem do Buffet.';
    end if;

    select p.* into v_produto
      from public.produtos p
     where p.id = (v_entrada->>'produto_id')::uuid
       and p.organization_id = v_org
       and p.ativo
       and p.controla_estoque
       and p.tipo_produto in ('buffet', 'insumo')
     for update;
    if not found then
      raise exception 'A contagem contém produto inativo, sem controle ou de outra filial.';
    end if;

    v_contado := (v_entrada->>'quantidade')::numeric;
    v_sistema := public.saldo_estoque_local_v2(v_produto.id, 'buffet');
    v_delta := v_contado - v_sistema;
    v_mov := null;

    if v_delta > 0 then
      insert into public.movimentacoes_estoque
        (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
      values
        (v_org, v_produto.id, v_delta, 'contagem', 'buffet',
         'Fechamento Buffet ' || p_id::text, v_usuario)
      returning movimentacoes_estoque.id into v_mov;
    elsif v_delta < 0 then
      insert into public.movimentacoes_estoque
        (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
      values
        (v_org, v_produto.id, abs(v_delta), 'buffet', 'perda',
         'Ajuste de fechamento Buffet ' || p_id::text, v_usuario)
      returning movimentacoes_estoque.id into v_mov;
    end if;

    if v_mov is not null then
      insert into public.estoque_operacoes_locais_v2 (movimentacao_id, organization_id)
      values (v_mov, v_org);
      v_ajustes := v_ajustes + 1;
    end if;

    insert into public.fechamentos_buffet_itens (
      fechamento_id, organization_id, produto_id, saldo_sistema,
      saldo_contado, diferenca, movimentacao_id
    ) values (
      p_id, v_org, v_produto.id, v_sistema, v_contado, v_delta, v_mov
    );
    v_itens := v_itens + 1;
  end loop;

  update public.fechamentos_buffet as f
     set status = 'fechado',
         fechado_por = v_usuario,
         fechado_em = now(),
         payload_hash = v_hash
   where f.id = p_id;

  return query
    select p_id, 'fechado'::text, v_itens, v_ajustes, now();
end;
$$;

create or replace function public.reabrir_fechamento_buffet(
  p_id uuid,
  p_motivo text
)
returns table (id uuid, status text, reaberto_em timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_fechamento public.fechamentos_buffet%rowtype;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para reabrir o fechamento.';
  end if;
  if not public.pode('estoque', 'reabrir_buffet') then
    raise exception 'Sua conta não tem permissão para reabrir o fechamento do Buffet.'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da reabertura para manter a auditoria.';
  end if;

  select f.* into v_fechamento
    from public.fechamentos_buffet f
   where f.id = p_id and f.organization_id = v_org
   for update;
  if not found or v_fechamento.status <> 'fechado' then
    raise exception 'Somente um fechamento concluído pode ser reaberto.';
  end if;

  update public.fechamentos_buffet as f
     set status = 'reaberto',
         reaberto_por = v_usuario,
         reaberto_em = now(),
         motivo_reabertura = btrim(p_motivo)
   where f.id = p_id;

  return query
    select f.id, f.status, f.reaberto_em
      from public.fechamentos_buffet f where f.id = p_id;
end;
$$;

create or replace function public.listar_fechamentos_buffet()
returns table (
  id uuid,
  status text,
  aberto_em timestamptz,
  fechado_em timestamptz,
  motivo_reabertura text,
  aberto_por uuid,
  fechado_por uuid,
  reaberto_por uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar fechamentos.'
      using errcode = '42501';
  end if;
  return query
    select f.id, f.status, f.aberto_em, f.fechado_em, f.motivo_reabertura,
           f.aberto_por, f.fechado_por, f.reaberto_por
      from public.fechamentos_buffet f
     where f.organization_id = public.minha_organizacao()
     order by f.aberto_em desc
     limit 50;
end;
$$;

create or replace function public.listar_itens_fechamento_buffet(p_id uuid)
returns table (
  produto_id uuid,
  produto_nome text,
  saldo_sistema numeric,
  saldo_contado numeric,
  diferenca numeric,
  movimentacao_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar fechamentos.'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.fechamentos_buffet f
     where f.id = p_id and f.organization_id = public.minha_organizacao()
  ) then
    raise exception 'Fechamento não encontrado nesta filial.';
  end if;
  return query
    select i.produto_id, p.nome, i.saldo_sistema, i.saldo_contado,
           i.diferenca, i.movimentacao_id
      from public.fechamentos_buffet_itens i
      join public.produtos p on p.id = i.produto_id
     where i.fechamento_id = p_id
       and i.organization_id = public.minha_organizacao()
     order by p.nome;
end;
$$;

revoke all on function public.seed_locais_estoque_nova_organizacao() from public, anonymous, authenticated;
revoke all on function public.saldo_estoque_local_v2(uuid, text) from public, anonymous;
revoke all on function public.listar_saldos_estoque_por_local() from public, anonymous;
revoke all on function public.registrar_movimentacao_local_v2(uuid, numeric, text, text, text) from public, anonymous;
revoke all on function public.transferir_estoque_local_v2(uuid, numeric, text, text, text, text) from public, anonymous;
revoke all on function public.ajustar_saldo_estoque_local(uuid, numeric, text, text, text) from public, anonymous;
revoke all on function public.abrir_fechamento_buffet() from public, anonymous;
revoke all on function public.fechar_fechamento_buffet(uuid, jsonb) from public, anonymous;
revoke all on function public.reabrir_fechamento_buffet(uuid, text) from public, anonymous;
revoke all on function public.listar_fechamentos_buffet() from public, anonymous;
revoke all on function public.listar_itens_fechamento_buffet(uuid) from public, anonymous;

grant execute on function public.listar_saldos_estoque_por_local() to authenticated;
grant execute on function public.registrar_movimentacao_local_v2(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.transferir_estoque_local_v2(uuid, numeric, text, text, text, text) to authenticated;
grant execute on function public.ajustar_saldo_estoque_local(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.abrir_fechamento_buffet() to authenticated;
grant execute on function public.fechar_fechamento_buffet(uuid, jsonb) to authenticated;
grant execute on function public.reabrir_fechamento_buffet(uuid, text) to authenticated;
grant execute on function public.listar_fechamentos_buffet() to authenticated;
grant execute on function public.listar_itens_fechamento_buffet(uuid) to authenticated;
