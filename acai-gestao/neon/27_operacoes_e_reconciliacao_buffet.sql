-- ============================================================================
-- 27 · Operações auditáveis e reconciliação por turno do Estoque Buffet
-- ============================================================================
-- Aditiva: usa o ledger existente, mantém produtos e saldos atuais e deixa
-- retorno desabilitado até que um responsável o autorize por produto.

alter table public.produtos
  add column if not exists permite_retorno_buffet boolean not null default false;

alter table public.produtos
  drop constraint if exists produtos_retorno_buffet_tipo_valido;

alter table public.produtos
  add constraint produtos_retorno_buffet_tipo_valido
  check (
    not permite_retorno_buffet
    or coalesce(tipo_produto, '') in ('buffet', 'insumo')
  );

alter table public.fechamentos_buffet
  add column if not exists data_operacional date,
  add column if not exists turno text not null default 'Geral'
    check (char_length(btrim(turno)) between 1 and 40);

update public.fechamentos_buffet
   set data_operacional = (aberto_em at time zone 'America/Sao_Paulo')::date
 where data_operacional is null;

alter table public.fechamentos_buffet
  alter column data_operacional
    set default ((now() at time zone 'America/Sao_Paulo')::date),
  alter column data_operacional set not null;

create table if not exists public.fechamentos_buffet_abertura (
  fechamento_id uuid not null
    references public.fechamentos_buffet(id) on delete restrict,
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  produto_id uuid not null
    references public.produtos(id) on delete restrict,
  saldo_inicial numeric(14, 3) not null check (saldo_inicial >= 0),
  unidade text not null,
  criado_em timestamptz not null default now(),
  primary key (fechamento_id, produto_id)
);

create index if not exists fechamentos_buffet_abertura_org_produto_idx
  on public.fechamentos_buffet_abertura (organization_id, produto_id, fechamento_id);

create table if not exists public.perdas_buffet (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
    references public.organizations(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  quantidade numeric(14, 3) not null check (quantidade > 0),
  motivo text not null check (motivo in (
    'vencimento', 'deterioracao', 'contaminacao', 'derramamento',
    'desperdicio_operacional', 'outro'
  )),
  observacoes text not null default '',
  chave_idempotencia text not null,
  movimentacao_id uuid not null unique
    references public.movimentacoes_estoque(id) on delete restrict,
  usuario_id uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (organization_id, chave_idempotencia),
  constraint perdas_buffet_observacoes_limite
    check (char_length(observacoes) <= 1000)
);

create index if not exists perdas_buffet_org_criada_idx
  on public.perdas_buffet (organization_id, criado_em desc);

create table if not exists public.devolucoes_buffet (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
    references public.organizations(id) on delete restrict,
  produto_id uuid not null references public.produtos(id) on delete restrict,
  quantidade numeric(14, 3) not null check (quantidade > 0),
  condicao text not null check (condicao in ('lacrado', 'reaproveitavel')),
  motivo text not null check (char_length(btrim(motivo)) between 1 and 500),
  observacoes text not null default '',
  chave_idempotencia text not null,
  movimentacao_id uuid not null unique
    references public.movimentacoes_estoque(id) on delete restrict,
  usuario_id uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (organization_id, chave_idempotencia),
  constraint devolucoes_buffet_observacoes_limite
    check (char_length(observacoes) <= 1000)
);

create index if not exists devolucoes_buffet_org_criada_idx
  on public.devolucoes_buffet (organization_id, criado_em desc);

alter table public.fechamentos_buffet_abertura enable row level security;
alter table public.perdas_buffet enable row level security;
alter table public.devolucoes_buffet enable row level security;

create policy fechamentos_buffet_abertura_leitura
  on public.fechamentos_buffet_abertura
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'consultar'))
  );

create policy perdas_buffet_leitura
  on public.perdas_buffet
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'consultar'))
  );

create policy devolucoes_buffet_leitura
  on public.devolucoes_buffet
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'consultar'))
  );

revoke all on public.fechamentos_buffet_abertura, public.perdas_buffet,
  public.devolucoes_buffet from anonymous, authenticated;
grant select on public.fechamentos_buffet_abertura, public.perdas_buffet,
  public.devolucoes_buffet to authenticated;

create or replace function public.abrir_fechamento_buffet_turno(p_turno text)
returns table (id uuid, status text, aberto_em timestamptz, data_operacional date, turno text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_id uuid;
  v_turno text := nullif(btrim(p_turno), '');
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para abrir o fechamento.';
  end if;
  if not public.pode('estoque', 'fechar_buffet') then
    raise exception 'Sua conta não tem permissão para abrir o fechamento do Buffet.'
      using errcode = '42501';
  end if;
  if v_turno is null or char_length(v_turno) > 40 then
    raise exception 'Informe um turno válido para o fechamento.';
  end if;
  if not exists (
    select 1 from public.estoque_locais l
     where l.organization_id = v_org and l.codigo = 'buffet' and l.ativo
  ) then
    raise exception 'O Estoque Buffet não está ativo nesta filial.';
  end if;

  perform p.id
    from public.produtos p
   where p.organization_id = v_org
     and p.ativo
     and p.controla_estoque
     and p.tipo_produto in ('buffet', 'insumo')
   order by p.id
   for update;

  insert into public.fechamentos_buffet as f
    (organization_id, aberto_por, data_operacional, turno)
  values (v_org, v_usuario, (now() at time zone 'America/Sao_Paulo')::date, v_turno)
  returning f.id into v_id;

  insert into public.fechamentos_buffet_abertura
    (fechamento_id, organization_id, produto_id, saldo_inicial, unidade)
  select v_id, v_org, p.id,
         public.saldo_estoque_local_v2(p.id, 'buffet'),
         p.unidade
    from public.produtos p
   where p.organization_id = v_org
     and p.ativo
     and p.controla_estoque
     and p.tipo_produto in ('buffet', 'insumo');

  return query
    select f.id, f.status, f.aberto_em, f.data_operacional, f.turno
      from public.fechamentos_buffet f
     where f.id = v_id;
exception
  when unique_violation then
    raise exception 'Já existe um fechamento aberto para o Estoque Buffet.';
end;
$$;

create or replace function public.abrir_fechamento_buffet()
returns table (id uuid, status text, aberto_em timestamptz)
language sql
security definer
set search_path = ''
as $$
  select f.id, f.status, f.aberto_em
    from public.abrir_fechamento_buffet_turno('Geral') f;
$$;

drop function public.listar_fechamentos_buffet();

create function public.listar_fechamentos_buffet()
returns table (
  id uuid,
  status text,
  aberto_em timestamptz,
  fechado_em timestamptz,
  motivo_reabertura text,
  aberto_por uuid,
  fechado_por uuid,
  reaberto_por uuid,
  data_operacional date,
  turno text
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
           f.aberto_por, f.fechado_por, f.reaberto_por,
           f.data_operacional, f.turno
      from public.fechamentos_buffet f
     where f.organization_id = public.minha_organizacao()
     order by f.aberto_em desc
     limit 50;
end;
$$;

create or replace function public.registrar_perda_buffet(
  p_produto_id uuid,
  p_quantidade numeric,
  p_motivo text,
  p_observacoes text,
  p_chave_idempotencia text
)
returns table (
  id uuid,
  movimentacao_id uuid,
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
  v_produto public.produtos%rowtype;
  v_existente public.perdas_buffet%rowtype;
  v_id uuid;
  v_mov uuid;
  v_qtd numeric := p_quantidade;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_obs text := coalesce(btrim(p_observacoes), '');
  v_chave text := nullif(btrim(p_chave_idempotencia), '');
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para registrar a perda.';
  end if;
  if not public.pode('estoque', 'criar') then
    raise exception 'Sua conta não tem permissão para registrar perdas.'
      using errcode = '42501';
  end if;
  if p_produto_id is null or v_qtd is null or v_qtd <= 0
     or v_qtd::text in ('NaN', 'Infinity', '-Infinity')
     or v_qtd <> round(v_qtd, 3) then
    raise exception 'Informe o produto e uma quantidade maior que zero.';
  end if;
  if v_motivo is null or v_motivo not in (
    'vencimento', 'deterioracao', 'contaminacao', 'derramamento',
    'desperdicio_operacional', 'outro'
  ) or v_chave is null or char_length(v_obs) > 1000 then
    raise exception 'Confira o motivo, as observações e a chave do registro de perda.';
  end if;

  select p.* into v_produto
    from public.produtos p
   where p.id = p_produto_id and p.organization_id = v_org
   for update;
  if not found or not v_produto.controla_estoque
     or coalesce(v_produto.tipo_produto, '') not in ('buffet', 'insumo') then
    raise exception 'Produto não encontrado ou sem controle de estoque nesta filial.';
  end if;

  select l.* into v_existente
    from public.perdas_buffet l
   where l.organization_id = v_org and l.chave_idempotencia = v_chave;
  if found then
    if v_existente.produto_id <> p_produto_id
       or v_existente.quantidade <> v_qtd
       or v_existente.motivo <> v_motivo
       or v_existente.observacoes <> v_obs then
      raise exception 'A chave já foi usada em outro registro de perda.';
    end if;
    return query
      select l.id, l.movimentacao_id,
             public.saldo_estoque_local_v2(l.produto_id, 'buffet'), l.criado_em
        from public.perdas_buffet l where l.id = v_existente.id;
    return;
  end if;

  if public.saldo_estoque_local_v2(p_produto_id, 'buffet') < v_qtd then
    raise exception 'Quantidade indisponível no Estoque Buffet. Confira o saldo antes de registrar a perda.';
  end if;

  insert into public.movimentacoes_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
  values (
    v_org, p_produto_id, v_qtd, 'buffet', 'perda',
    'Perda do Buffet: ' || v_motivo ||
      case when v_obs <> '' then ' — ' || v_obs else '' end,
    v_usuario
  )
  returning movimentacoes_estoque.id into v_mov;

  insert into public.perdas_buffet
    (organization_id, produto_id, quantidade, motivo, observacoes,
     chave_idempotencia, movimentacao_id, usuario_id)
  values (v_org, p_produto_id, v_qtd, v_motivo, v_obs, v_chave, v_mov, v_usuario)
  returning perdas_buffet.id into v_id;

  insert into public.estoque_operacoes_locais_v2 (movimentacao_id, organization_id)
  values (v_mov, v_org);

  return query
    select l.id, l.movimentacao_id,
           public.saldo_estoque_local_v2(l.produto_id, 'buffet'), l.criado_em
      from public.perdas_buffet l where l.id = v_id;
end;
$$;

create or replace function public.devolver_produto_buffet(
  p_produto_id uuid,
  p_quantidade numeric,
  p_condicao text,
  p_motivo text,
  p_observacoes text,
  p_chave_idempotencia text
)
returns table (
  id uuid,
  movimentacao_id uuid,
  saldo_buffet numeric,
  saldo_loja numeric,
  criado_em timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_produto public.produtos%rowtype;
  v_existente public.devolucoes_buffet%rowtype;
  v_id uuid;
  v_mov uuid;
  v_qtd numeric := p_quantidade;
  v_condicao text := nullif(btrim(p_condicao), '');
  v_motivo text := nullif(btrim(p_motivo), '');
  v_obs text := coalesce(btrim(p_observacoes), '');
  v_chave text := nullif(btrim(p_chave_idempotencia), '');
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para registrar a devolução.';
  end if;
  if not public.pode('estoque', 'criar') then
    raise exception 'Sua conta não tem permissão para devolver produtos do Buffet.'
      using errcode = '42501';
  end if;
  if p_produto_id is null or v_qtd is null or v_qtd <= 0
     or v_qtd::text in ('NaN', 'Infinity', '-Infinity')
     or v_qtd <> round(v_qtd, 3) then
    raise exception 'Informe o produto e uma quantidade maior que zero.';
  end if;
  if v_condicao is null or v_condicao not in ('lacrado', 'reaproveitavel')
     or v_motivo is null or char_length(v_motivo) > 500
     or v_chave is null or char_length(v_obs) > 1000 then
    raise exception 'Confira a condição, o motivo e as observações da devolução.';
  end if;

  select p.* into v_produto
    from public.produtos p
   where p.id = p_produto_id and p.organization_id = v_org
   for update;
  if not found or not v_produto.controla_estoque
     or not v_produto.permite_retorno_buffet
     or coalesce(v_produto.tipo_produto, '') not in ('buffet', 'insumo') then
    raise exception 'Este produto não está autorizado para retorno ao Estoque Normal.';
  end if;

  select d.* into v_existente
    from public.devolucoes_buffet d
   where d.organization_id = v_org and d.chave_idempotencia = v_chave;
  if found then
    if v_existente.produto_id <> p_produto_id
       or v_existente.quantidade <> v_qtd
       or v_existente.condicao <> v_condicao
       or v_existente.motivo <> v_motivo
       or v_existente.observacoes <> v_obs then
      raise exception 'A chave já foi usada em outra devolução.';
    end if;
    return query
      select d.id, d.movimentacao_id,
             public.saldo_estoque_local_v2(d.produto_id, 'buffet'),
             public.saldo_estoque_local_v2(d.produto_id, 'loja'), d.criado_em
        from public.devolucoes_buffet d where d.id = v_existente.id;
    return;
  end if;

  if public.saldo_estoque_local_v2(p_produto_id, 'buffet') < v_qtd then
    raise exception 'Quantidade indisponível no Estoque Buffet. Confira o saldo antes de devolver.';
  end if;

  insert into public.movimentacoes_estoque
    (organization_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
  values (
    v_org, p_produto_id, v_qtd, 'buffet', 'estoque',
    'Devolução do Buffet (' || v_condicao || '): ' || v_motivo ||
      case when v_obs <> '' then ' — ' || v_obs else '' end,
    v_usuario
  )
  returning movimentacoes_estoque.id into v_mov;

  insert into public.devolucoes_buffet
    (organization_id, produto_id, quantidade, condicao, motivo, observacoes,
     chave_idempotencia, movimentacao_id, usuario_id)
  values (v_org, p_produto_id, v_qtd, v_condicao, v_motivo, v_obs,
          v_chave, v_mov, v_usuario)
  returning devolucoes_buffet.id into v_id;

  insert into public.estoque_operacoes_locais_v2 (movimentacao_id, organization_id)
  values (v_mov, v_org);

  return query
    select d.id, d.movimentacao_id,
           public.saldo_estoque_local_v2(d.produto_id, 'buffet'),
           public.saldo_estoque_local_v2(d.produto_id, 'loja'), d.criado_em
      from public.devolucoes_buffet d where d.id = v_id;
end;
$$;

create or replace function public.listar_operacoes_buffet(
  p_desde date default null,
  p_ate date default null,
  p_produto_id uuid default null
)
returns table (
  id uuid,
  tipo text,
  produto_id uuid,
  produto_nome text,
  quantidade numeric,
  unidade text,
  origem text,
  destino text,
  motivo text,
  observacoes text,
  condicao text,
  responsavel text,
  criado_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar operações do Buffet.'
      using errcode = '42501';
  end if;
  if p_desde is not null and p_ate is not null and p_desde > p_ate then
    raise exception 'A data inicial deve ser anterior à data final.';
  end if;

  return query
    select mv.id,
           case
             when l.id is not null then 'perda'
             when d.id is not null then 'devolucao'
             when mv.motivo like 'Ajuste de fechamento Buffet %' then 'ajuste'
             else 'transferencia'
           end,
           mv.produto_id, p.nome, mv.quantidade, p.unidade, mv.origem, mv.destino,
           coalesce(l.motivo, d.motivo, mv.motivo),
           coalesce(l.observacoes, d.observacoes, ''),
           d.condicao, coalesce(pr.full_name, 'Usuário'), mv.criado_em
      from public.movimentacoes_estoque mv
      join public.produtos p
        on p.id = mv.produto_id and p.organization_id = mv.organization_id
      left join public.perdas_buffet l
        on l.movimentacao_id = mv.id and l.organization_id = mv.organization_id
      left join public.devolucoes_buffet d
        on d.movimentacao_id = mv.id and d.organization_id = mv.organization_id
      left join public.profiles pr on pr.id = mv.usuario_id
     where mv.organization_id = public.minha_organizacao()
       and (mv.origem = 'buffet' or mv.destino = 'buffet')
       and (p_desde is null or mv.criado_em >=
         (p_desde::timestamp at time zone 'America/Sao_Paulo'))
       and (p_ate is null or mv.criado_em <
         ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'))
       and (p_produto_id is null or mv.produto_id = p_produto_id)
     order by mv.criado_em desc
    limit 500;
end;
$$;

create or replace function public.resumo_fechamento_buffet(p_id uuid)
returns table (
  produto_id uuid,
  produto_nome text,
  unidade text,
  saldo_inicial numeric,
  abastecido numeric,
  devolvido numeric,
  perdas numeric,
  venda_direta numeric,
  saldo_sistema numeric,
  saldo_contado numeric,
  consumo_aparente numeric,
  consumo_estimado numeric,
  divergencia numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar o fechamento do Buffet.'
      using errcode = '42501';
  end if;

  return query
    select i.produto_id,
           p.nome,
           a.unidade,
           a.saldo_inicial,
           coalesce(m.abastecido, 0),
           coalesce(m.devolvido, 0),
           coalesce(m.perdas, 0),
           coalesce(m.venda_direta, 0),
           i.saldo_sistema,
           i.saldo_contado,
           a.saldo_inicial + coalesce(m.abastecido, 0)
             - coalesce(m.devolvido, 0) - coalesce(m.venda_direta, 0)
             - i.saldo_contado,
           a.saldo_inicial + coalesce(m.abastecido, 0)
             - coalesce(m.devolvido, 0) - coalesce(m.venda_direta, 0)
             - coalesce(m.perdas, 0) - i.saldo_contado,
           i.diferenca
      from public.fechamentos_buffet_itens i
      join public.fechamentos_buffet f
        on f.id = i.fechamento_id
       and f.organization_id = i.organization_id
      join public.fechamentos_buffet_abertura a
        on a.fechamento_id = i.fechamento_id
       and a.produto_id = i.produto_id
      join public.produtos p
        on p.id = i.produto_id
       and p.organization_id = i.organization_id
      left join lateral (
        select
          coalesce(sum(mv.quantidade) filter (
            where mv.destino = 'buffet'
              and mv.origem <> 'contagem'
          ), 0) as abastecido,
          coalesce(sum(mv.quantidade) filter (
            where mv.origem = 'buffet'
              and mv.destino in ('estoque', 'estoque_geral', 'sobra')
          ), 0) as devolvido,
          coalesce(sum(mv.quantidade) filter (
            where mv.origem = 'buffet' and mv.destino = 'perda'
          ), 0) as perdas,
          coalesce(sum(mv.quantidade) filter (
            where mv.origem = 'buffet' and mv.destino = 'cliente'
          ), 0) as venda_direta
          from public.movimentacoes_estoque mv
         where mv.organization_id = f.organization_id
           and mv.produto_id = i.produto_id
           and mv.criado_em >= f.aberto_em
           and mv.criado_em <= f.fechado_em
           and mv.id is distinct from i.movimentacao_id
      ) m on true
     where i.fechamento_id = p_id
       and i.organization_id = public.minha_organizacao()
     order by p.nome;
end;
$$;

revoke all on function public.abrir_fechamento_buffet_turno(text) from public, anonymous;
revoke all on function public.listar_fechamentos_buffet() from public, anonymous;
revoke all on function public.registrar_perda_buffet(uuid, numeric, text, text, text) from public, anonymous;
revoke all on function public.devolver_produto_buffet(uuid, numeric, text, text, text, text) from public, anonymous;
revoke all on function public.listar_operacoes_buffet(date, date, uuid) from public, anonymous;
revoke all on function public.resumo_fechamento_buffet(uuid) from public, anonymous;

grant execute on function public.abrir_fechamento_buffet_turno(text) to authenticated;
grant execute on function public.listar_fechamentos_buffet() to authenticated;
grant execute on function public.registrar_perda_buffet(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.devolver_produto_buffet(uuid, numeric, text, text, text, text) to authenticated;
grant execute on function public.listar_operacoes_buffet(date, date, uuid) to authenticated;
grant execute on function public.resumo_fechamento_buffet(uuid) to authenticated;

notify pgrst, 'reload schema';
