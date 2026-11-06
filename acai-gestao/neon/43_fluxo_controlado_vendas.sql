-- 43 · Criacao pendente, transicoes auditadas e validacao dos canais de venda.
-- Aditiva: nao altera vendas historicas, itens, pagamentos ou movimentos.

alter table public.vendas
  alter column status set default 'Aguardando';

-- A venda nova sempre nasce pendente. Concluir, preparar ou cancelar sao
-- operacoes distintas, autorizadas pelas RPCs abaixo.
create or replace function public.validar_status_inicial_venda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from 'Aguardando' then
    raise exception 'Uma venda nova deve iniciar como Aguardando. Use a ação apropriada para alterar o status.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists vendas_status_inicial on public.vendas;
create trigger vendas_status_inicial
  before insert on public.vendas
  for each row execute function public.validar_status_inicial_venda();

create or replace function public.validar_detalhes_canal_venda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_categoria text;
begin
  if new.tipo_venda_id is null then
    return new;
  end if;

  select t.categoria into v_categoria
    from public.tipos_venda t
   where t.id = new.tipo_venda_id
     and t.organization_id = new.organization_id;

  if not found then
    raise exception 'Tipo de venda não pertence à organização da venda.';
  end if;

  if v_categoria in ('balcao', 'personalizado')
     and (
       coalesce(new.taxa_entrega, 0) <> 0
       or nullif(btrim(coalesce(new.endereco_entrega, '')), '') is not null
       or nullif(btrim(coalesce(new.plataforma, '')), '') is not null
       or nullif(btrim(coalesce(new.pedido_externo, '')), '') is not null
       or coalesce(new.comissao_percentual, 0) <> 0
       or coalesce(new.taxa_aplicativo, 0) <> 0
     ) then
    raise exception 'Balcão e tipo personalizado não aceitam campos de entrega ou aplicativo.';
  end if;

  if v_categoria = 'delivery'
     and (
       nullif(btrim(coalesce(new.plataforma, '')), '') is not null
       or nullif(btrim(coalesce(new.pedido_externo, '')), '') is not null
       or coalesce(new.comissao_percentual, 0) <> 0
       or coalesce(new.taxa_aplicativo, 0) <> 0
     ) then
    raise exception 'Delivery próprio não aceita taxas ou identificadores de aplicativo.';
  end if;

  return new;
end;
$$;

drop trigger if exists validar_detalhes_canal_venda on public.venda_detalhes;
create trigger validar_detalhes_canal_venda
  before insert or update on public.venda_detalhes
  for each row execute function public.validar_detalhes_canal_venda();

-- Toda transicao deixa um rastro imutavel na trilha de auditoria existente.
create or replace function public.auditar_status_venda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anterior text;
  v_motivo text;
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.estornada_em is not distinct from old.estornada_em then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_anterior := null;
  else
    v_anterior := old.status;
  end if;

  select m.motivo into v_motivo
    from public.movimentacoes_estoque m
   where m.venda_id = new.id
     and m.estorno_de_id is not null
   order by m.criado_em desc
   limit 1;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, details
  )
  values (
    new.organization_id,
    coalesce(auth.uid(), new.usuario_id),
    'venda_status_alterado',
    jsonb_build_object(
      'venda_id', new.id,
      'codigo', new.codigo,
      'status_anterior', v_anterior,
      'status_novo', new.status,
      'motivo', v_motivo
    )
  );

  return new;
end;
$$;

drop trigger if exists auditar_status_venda on public.vendas;
create trigger auditar_status_venda
  after insert or update of status, estornada_em on public.vendas
  for each row execute function public.auditar_status_venda();

create or replace function public.atualizar_status_venda(
  p_venda_id uuid,
  p_novo_status text
)
returns table (
  venda_id uuid,
  codigo text,
  status text,
  ja_estava_atualizado boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
  v_venda public.vendas%rowtype;
begin
  if auth.uid() is null or v_org is null or v_filial is null then
    raise exception 'Sessão ou filial ativa inválida.'
      using errcode = '42501';
  end if;
  if not public.pode('vendas', 'editar') then
    raise exception 'Sua conta não tem permissão para alterar o status da venda.'
      using errcode = '42501';
  end if;
  if p_novo_status not in ('Em preparo', 'Concluída') then
    raise exception 'Status de destino inválido.';
  end if;

  select v.* into v_venda
    from public.vendas v
   where v.id = p_venda_id
     and v.organization_id = v_org
     and v.filial_id = v_filial
   for update;
  if not found then
    raise exception 'Venda não encontrada na filial ativa.'
      using errcode = '42501';
  end if;
  if v_venda.estornada_em is not null or v_venda.status = 'Cancelada' then
    raise exception 'Venda cancelada ou estornada não pode mudar de status.';
  end if;
  if v_venda.status = p_novo_status then
    return query select v_venda.id, v_venda.codigo, v_venda.status, true;
    return;
  end if;
  if not (
    (v_venda.status = 'Aguardando' and p_novo_status in ('Em preparo', 'Concluída'))
    or (v_venda.status = 'Em preparo' and p_novo_status = 'Concluída')
  ) then
    raise exception 'Transição de status inválida: % para %.', v_venda.status, p_novo_status
      using errcode = '22023';
  end if;

  update public.vendas
     set status = p_novo_status
   where id = v_venda.id
  returning * into v_venda;

  return query select v_venda.id, v_venda.codigo, v_venda.status, false;
end;
$$;

create or replace function public.cancelar_venda_pendente(
  p_venda_id uuid,
  p_motivo text
)
returns table (
  venda_id uuid,
  codigo text,
  status text,
  movimentos integer,
  ja_cancelada boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
  v_usuario uuid := auth.uid();
  v_venda public.vendas%rowtype;
  v_motivo text := nullif(btrim(p_motivo), '');
  v_mov integer := 0;
  v_reg record;
begin
  if v_usuario is null or v_org is null or v_filial is null then
    raise exception 'Sessão ou filial ativa inválida.'
      using errcode = '42501';
  end if;
  if not public.pode('vendas', 'editar') then
    raise exception 'Sua conta não tem permissão para cancelar a venda.'
      using errcode = '42501';
  end if;
  if p_venda_id is null or v_motivo is null then
    raise exception 'Informe a venda e o motivo do cancelamento.';
  end if;

  select v.* into v_venda
    from public.vendas v
   where v.id = p_venda_id
     and v.organization_id = v_org
     and v.filial_id = v_filial
   for update;
  if not found then
    raise exception 'Venda não encontrada na filial ativa.'
      using errcode = '42501';
  end if;

  if v_venda.status = 'Cancelada' and v_venda.estornada_em is null then
    return query select v_venda.id, v_venda.codigo, v_venda.status, 0, true;
    return;
  end if;
  if v_venda.status not in ('Aguardando', 'Em preparo') or v_venda.estornada_em is not null then
    raise exception 'Somente vendas aguardando ou em preparo podem ser canceladas sem estorno.';
  end if;

  for v_reg in
    select m.id, m.produto_id, m.quantidade, m.origem, m.destino, m.filial_id
      from public.movimentacoes_estoque m
     where m.venda_id = v_venda.id
       and m.estorno_de_id is null
     order by m.criado_em
     for update
  loop
    insert into public.movimentacoes_estoque (
      organization_id, filial_id, produto_id, quantidade, origem, destino,
      motivo, venda_id, item_venda_id, usuario_id, estorno_de_id
    )
    values (
      v_org, v_reg.filial_id, v_reg.produto_id, v_reg.quantidade,
      v_reg.destino, v_reg.origem,
      'Cancelamento ' || v_venda.codigo || ': ' || v_motivo,
      v_venda.id, null, v_usuario, v_reg.id
    );
    v_mov := v_mov + 1;
  end loop;

  update public.vendas
     set status = 'Cancelada'
   where id = v_venda.id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, details
  )
  values (
    v_org, v_usuario, 'venda_cancelamento_motivo',
    jsonb_build_object('venda_id', v_venda.id, 'motivo', v_motivo)
  );

  return query select v_venda.id, v_venda.codigo, 'Cancelada'::text, v_mov, false;
end;
$$;

create or replace function public.historico_status_venda(p_venda_id uuid)
returns table (
  status_anterior text,
  status_novo text,
  motivo text,
  actor_user_id uuid,
  criado_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
begin
  if auth.uid() is null or v_org is null or v_filial is null
     or not public.pode('vendas', 'consultar') then
    raise exception 'Sua conta não pode consultar o histórico da venda.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.vendas v
     where v.id = p_venda_id
       and v.organization_id = v_org
       and v.filial_id = v_filial
  ) then
    raise exception 'Venda não encontrada na filial ativa.'
      using errcode = '42501';
  end if;

  return query
    select a.details ->> 'status_anterior',
           a.details ->> 'status_novo',
           coalesce(
             a.details ->> 'motivo',
             (
               select m.details ->> 'motivo'
                 from public.audit_logs m
                where m.organization_id = v_org
                  and m.action = 'venda_cancelamento_motivo'
                  and m.details ->> 'venda_id' = p_venda_id::text
                  and m.created_at >= a.created_at
                order by m.created_at
                limit 1
             )
           ),
           a.actor_user_id,
           a.created_at
      from public.audit_logs a
     where a.organization_id = v_org
       and a.action = 'venda_status_alterado'
       and a.details ->> 'venda_id' = p_venda_id::text
     order by a.created_at;
end;
$$;

revoke all on function public.validar_status_inicial_venda() from public, anonymous, authenticated;
revoke all on function public.validar_detalhes_canal_venda() from public, anonymous, authenticated;
revoke all on function public.auditar_status_venda() from public, anonymous, authenticated;
revoke all on function public.atualizar_status_venda(uuid, text) from public, anonymous;
revoke all on function public.cancelar_venda_pendente(uuid, text) from public, anonymous;
revoke all on function public.historico_status_venda(uuid) from public, anonymous;
grant execute on function public.atualizar_status_venda(uuid, text) to authenticated;
grant execute on function public.cancelar_venda_pendente(uuid, text) to authenticated;
grant execute on function public.historico_status_venda(uuid) to authenticated;

notify pgrst, 'reload schema';
