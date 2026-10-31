-- ============================================================================
-- 36 · Integridade do Estoque Principal e do Estoque Buffet
-- ============================================================================
-- Aditiva: preserva o ledger e os saldos existentes. Para compatibilidade com
-- o histórico, Principal é a soma dos locais legados Loja e Geral; Buffet é
-- sempre separado. Transferências entre eles continuam sendo movimentos, não
-- compras nem consumo.
-- A RPC genérica sem chave idempotente deixa de ser executável pelo navegador;
-- o app deve usar registrar_movimentacao_local_v3().

create table if not exists public.estoque_operacoes_idempotencia (
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  chave_idempotencia text not null
    check (char_length(btrim(chave_idempotencia)) between 1 and 200),
  produto_id uuid not null references public.produtos(id) on delete restrict,
  quantidade numeric(12, 3) not null check (quantidade > 0),
  origem text not null,
  destino text not null,
  motivo text not null,
  movimentacao_id uuid not null unique,
  usuario_id uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  primary key (organization_id, chave_idempotencia)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.estoque_operacoes_idempotencia'::regclass
       and conname = 'estoque_operacoes_idempotencia_movimentacao_fk'
  ) then
    alter table public.estoque_operacoes_idempotencia
      add constraint estoque_operacoes_idempotencia_movimentacao_fk
      foreign key (movimentacao_id)
      references public.movimentacoes_estoque(id) on delete restrict;
  end if;
end
$$;

create index if not exists estoque_operacoes_idempotencia_produto_idx
  on public.estoque_operacoes_idempotencia (organization_id, produto_id, criado_em desc);

alter table public.estoque_operacoes_idempotencia enable row level security;
revoke all on public.estoque_operacoes_idempotencia from public, anonymous, authenticated;

create table if not exists public.recebimentos_compra_idempotencia (
  organization_id uuid not null
    references public.organizations(id) on delete restrict,
  chave_idempotencia text not null
    check (char_length(btrim(chave_idempotencia)) between 1 and 200),
  compra_id uuid not null references public.compras(id) on delete restrict,
  payload_hash text not null,
  resultado jsonb,
  usuario_id uuid references public.profiles(id) on delete set null,
  criado_em timestamptz not null default now(),
  primary key (organization_id, chave_idempotencia)
);

create index if not exists recebimentos_compra_idempotencia_compra_idx
  on public.recebimentos_compra_idempotencia (organization_id, compra_id, criado_em desc);

alter table public.recebimentos_compra_idempotencia enable row level security;
revoke all on public.recebimentos_compra_idempotencia from public, anonymous, authenticated;

create or replace function public.impedir_compra_direta_buffet()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origem = 'fornecedor' and new.destino = 'buffet' then
    raise exception
      'Compras e entradas devem aumentar o Estoque Principal. Transfira para o Buffet depois do recebimento.';
  end if;
  return new;
end;
$$;

drop trigger if exists movimentacao_compra_exige_estoque_principal
  on public.movimentacoes_estoque;
create trigger movimentacao_compra_exige_estoque_principal
  before insert on public.movimentacoes_estoque
  for each row execute function public.impedir_compra_direta_buffet();

create or replace function public.impedir_transferencia_com_saldo_insuficiente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local_origem text;
  v_local_destino text;
begin
  v_local_origem := case new.origem
    when 'estoque' then 'loja'
    when 'estoque_geral' then 'geral'
    when 'buffet' then 'buffet'
    when 'preparacao' then 'preparacao'
    when 'producao' then 'producao'
    else null
  end;
  v_local_destino := case new.destino
    when 'estoque' then 'loja'
    when 'estoque_geral' then 'geral'
    when 'buffet' then 'buffet'
    when 'preparacao' then 'preparacao'
    when 'producao' then 'producao'
    else null
  end;

  if v_local_origem is not null and v_local_destino is not null
     and public.saldo_estoque_local_v2(new.produto_id, v_local_origem) < new.quantidade then
    raise exception 'Saldo insuficiente no estoque % para concluir a transferência.',
      v_local_origem;
  end if;
  return new;
end;
$$;

drop trigger if exists movimentacao_transferencia_exige_saldo
  on public.movimentacoes_estoque;
create trigger movimentacao_transferencia_exige_saldo
  before insert on public.movimentacoes_estoque
  for each row execute function public.impedir_transferencia_com_saldo_insuficiente();

create or replace function public.registrar_movimentacao_local_v3(
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
  saldo_geral numeric,
  saldo_loja numeric,
  saldo_buffet numeric,
  saldo_principal numeric,
  saldo_total numeric,
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
  v_existente public.estoque_operacoes_idempotencia%rowtype;
  v_mov uuid;
  v_chave text := nullif(btrim(p_chave_idempotencia), '');
  v_motivo text := nullif(btrim(p_motivo), '');
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para movimentar o estoque.';
  end if;
  if not public.pode('estoque', 'criar') then
    raise exception 'Sua conta não tem permissão para movimentar estoque.'
      using errcode = '42501';
  end if;
  if p_produto_id is null or p_qtd is null or p_qtd <= 0
     or p_qtd::text in ('NaN', 'Infinity', '-Infinity')
     or p_qtd <> round(p_qtd, 3) then
    raise exception 'A quantidade precisa ser maior que zero, com até 3 casas decimais.';
  end if;
  if v_motivo is null then
    raise exception 'Informe o motivo da movimentação.';
  end if;
  if v_chave is null or char_length(v_chave) > 200 then
    raise exception 'A chave de idempotência da movimentação é inválida.';
  end if;
  if p_origem is null or p_destino is null or p_origem = p_destino
     or p_origem not in ('fornecedor', 'estoque', 'estoque_geral', 'buffet',
                         'preparacao', 'producao', 'sobra', 'perda', 'cliente')
     or p_destino not in ('fornecedor', 'estoque', 'estoque_geral', 'buffet',
                          'preparacao', 'producao', 'sobra', 'perda', 'cliente') then
    raise exception 'Escolha locais diferentes e válidos para a movimentação.';
  end if;
  if p_origem = 'fornecedor' and p_destino = 'buffet' then
    raise exception
      'Compras e entradas devem aumentar o Estoque Principal. Transfira para o Buffet depois do recebimento.';
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

  select o.* into v_existente
    from public.estoque_operacoes_idempotencia o
   where o.organization_id = v_org
     and o.chave_idempotencia = v_chave;
  if found then
    if v_existente.usuario_id is distinct from v_usuario
       or v_existente.produto_id <> p_produto_id
       or v_existente.quantidade <> p_qtd
       or v_existente.origem <> p_origem
       or v_existente.destino <> p_destino
       or v_existente.motivo <> v_motivo then
      raise exception 'A chave de idempotência já foi usada em outra movimentação.';
    end if;
    return query
      select m.id, m.produto_id, m.quantidade, m.origem, m.destino, m.motivo,
             v_chave,
             public.saldo_estoque_local_v2(m.produto_id, 'geral'),
             public.saldo_estoque_local_v2(m.produto_id, 'loja'),
             public.saldo_estoque_local_v2(m.produto_id, 'buffet'),
             public.saldo_estoque_local_v2(m.produto_id, 'geral')
               + public.saldo_estoque_local_v2(m.produto_id, 'loja'),
             public.saldo_estoque_local_v2(m.produto_id, 'geral')
               + public.saldo_estoque_local_v2(m.produto_id, 'loja')
               + public.saldo_estoque_local_v2(m.produto_id, 'buffet'),
             m.criado_em
        from public.movimentacoes_estoque m
       where m.id = v_existente.movimentacao_id;
    return;
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
    (v_org, p_produto_id, p_qtd, p_origem, p_destino, v_motivo, v_usuario)
  returning movimentacoes_estoque.id into v_mov;

  insert into public.estoque_operacoes_locais_v2 (movimentacao_id, organization_id)
  values (v_mov, v_org);

  insert into public.estoque_operacoes_idempotencia
    (organization_id, chave_idempotencia, produto_id, quantidade, origem, destino,
     motivo, movimentacao_id, usuario_id)
  values
    (v_org, v_chave, p_produto_id, p_qtd, p_origem, p_destino,
     v_motivo, v_mov, v_usuario);

  return query
    select m.id, m.produto_id, m.quantidade, m.origem, m.destino, m.motivo,
           v_chave,
           public.saldo_estoque_local_v2(m.produto_id, 'geral'),
           public.saldo_estoque_local_v2(m.produto_id, 'loja'),
           public.saldo_estoque_local_v2(m.produto_id, 'buffet'),
           public.saldo_estoque_local_v2(m.produto_id, 'geral')
             + public.saldo_estoque_local_v2(m.produto_id, 'loja'),
           public.saldo_estoque_local_v2(m.produto_id, 'geral')
             + public.saldo_estoque_local_v2(m.produto_id, 'loja')
             + public.saldo_estoque_local_v2(m.produto_id, 'buffet'),
           m.criado_em
      from public.movimentacoes_estoque m
     where m.id = v_mov;
end;
$$;

create or replace function public.confirmar_recebimento_compra_idempotente(
  p_compra_id uuid,
  p_itens jsonb,
  p_chave_idempotencia text
)
returns table (
  compra_id uuid,
  status text,
  data_recebimento date,
  itens_recebidos integer,
  valor_recebido numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_chave text := nullif(btrim(p_chave_idempotencia), '');
  v_hash text;
  v_existente public.recebimentos_compra_idempotencia%rowtype;
  v_inserido boolean;
  v_resultado jsonb;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para confirmar o recebimento.';
  end if;
  if not public.pode('compras', 'editar') then
    raise exception 'Sua conta não tem permissão para confirmar recebimento de compras.'
      using errcode = '42501';
  end if;
  if v_chave is null or char_length(v_chave) > 200 then
    raise exception 'A chave de idempotência do recebimento é inválida.';
  end if;
  if p_compra_id is null or p_itens is null or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe a compra e pelo menos um item recebido.';
  end if;
  v_hash := md5(p_itens::text);

  insert into public.recebimentos_compra_idempotencia
    (organization_id, chave_idempotencia, compra_id, payload_hash, usuario_id)
  values (v_org, v_chave, p_compra_id, v_hash, v_usuario)
  on conflict (organization_id, chave_idempotencia) do nothing
  returning true into v_inserido;

  if not coalesce(v_inserido, false) then
    select r.* into v_existente
      from public.recebimentos_compra_idempotencia r
     where r.organization_id = v_org
       and r.chave_idempotencia = v_chave
     for update;
    if not found
       or v_existente.usuario_id is distinct from v_usuario
       or v_existente.compra_id <> p_compra_id
       or v_existente.payload_hash <> v_hash then
      raise exception 'A chave de idempotência já foi usada em outro recebimento.';
    end if;
    if v_existente.resultado is null then
      raise exception 'O recebimento anterior ainda não foi concluído. Tente novamente.';
    end if;
    return query
      select r.compra_id, r.status, r.data_recebimento,
             r.itens_recebidos, r.valor_recebido
        from jsonb_to_record(v_existente.resultado) as r(
          compra_id uuid,
          status text,
          data_recebimento date,
          itens_recebidos integer,
          valor_recebido numeric
        );
    return;
  end if;

  select jsonb_build_object(
           'compra_id', r.compra_id,
           'status', r.status,
           'data_recebimento', r.data_recebimento,
           'itens_recebidos', r.itens_recebidos,
           'valor_recebido', r.valor_recebido
         )
    into v_resultado
    from public.confirmar_recebimento_compra(p_compra_id, p_itens) r;

  if v_resultado is null then
    raise exception 'O banco não confirmou o recebimento da compra.';
  end if;

  update public.recebimentos_compra_idempotencia
     set resultado = v_resultado
   where organization_id = v_org
     and chave_idempotencia = v_chave;

  return query
    select r.compra_id, r.status, r.data_recebimento,
           r.itens_recebidos, r.valor_recebido
      from jsonb_to_record(v_resultado) as r(
        compra_id uuid,
        status text,
        data_recebimento date,
        itens_recebidos integer,
        valor_recebido numeric
      );
end;
$$;

revoke all on function public.registrar_movimentacao_local_v2(uuid, numeric, text, text, text)
  from public, anonymous, authenticated;
revoke all on function public.registrar_movimentacao(uuid, numeric, text, text, text)
  from public, anonymous, authenticated;
revoke all on function public.registrar_movimentacao_local_v3(uuid, numeric, text, text, text, text)
  from public, anonymous;
revoke all on function public.confirmar_recebimento_compra(uuid, jsonb)
  from public, anonymous, authenticated;
revoke all on function public.confirmar_recebimento_compra_idempotente(uuid, jsonb, text)
  from public, anonymous;

grant execute on function public.registrar_movimentacao_local_v3(uuid, numeric, text, text, text, text)
  to authenticated;
grant execute on function public.confirmar_recebimento_compra_idempotente(uuid, jsonb, text)
  to authenticated;

create or replace view public.vw_resumo as
select
  (select coalesce(sum(total), 0) from public.vendas
     where status <> 'Cancelada'
       and criado_em >= date_trunc('month', current_date))       as faturamento_mes,
  (select coalesce(sum(total), 0) from public.vendas
     where status <> 'Cancelada'
       and criado_em::date = current_date)                       as faturamento_hoje,
  (select count(*) from public.vendas
     where criado_em::date = current_date)                       as vendas_hoje,
  (select count(*) from public.vendas
     where status = 'Cancelada'
       and criado_em::date = current_date)                       as cancelamentos_hoje,
  (select coalesce(avg(total), 0) from public.vendas
     where status <> 'Cancelada')                                as ticket_medio,
  (select count(*) from public.clientes)                         as total_clientes,
  (select count(*) from public.clientes
     where desde >= current_date - 30)                           as novos_clientes,
  (select count(*) from public.clientes where tier = 'VIP')       as clientes_vip,
  (select coalesce(sum(
      (public.saldo_estoque_local_v2(p.id, 'loja')
       + public.saldo_estoque_local_v2(p.id, 'geral')
       + public.saldo_estoque_local_v2(p.id, 'buffet')) * p.custo
    ), 0)
     from public.produtos p
    where p.ativo and p.controla_estoque)                         as valor_estoque,
  (select count(*) from public.produtos p
    where p.ativo and p.controla_estoque and p.minimo > 0
      and public.saldo_estoque_local_v2(p.id, 'loja')
          + public.saldo_estoque_local_v2(p.id, 'geral') < p.minimo)
                                                                  as itens_abaixo_minimo;
alter view public.vw_resumo set (security_invoker = on);

notify pgrst, 'reload schema';
