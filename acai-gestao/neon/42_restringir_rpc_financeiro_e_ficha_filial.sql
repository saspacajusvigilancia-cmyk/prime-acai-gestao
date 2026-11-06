-- Restringe RPCs SECURITY DEFINER por permissao, organizacao e filial ativa.

create or replace function public.saldo_parcela_interno(p_parcela_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, round(p.valor - p.valor_liquidado, 2))
    from public.parcelas_financeiras p
   where p.id = p_parcela_id
$$;

revoke all on function public.saldo_parcela_interno(uuid)
  from public, anonymous, authenticated;

create or replace function public.saldo_parcela(p_parcela_id uuid)
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
  if auth.uid() is null
     or v_org is null
     or v_filial is null
     or not public.pode('financeiro', 'ver') then
    raise exception 'Saldo financeiro indisponivel para esta conta.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.parcelas_financeiras p
     where p.id = p_parcela_id
       and p.organization_id = v_org
       and p.filial_id = v_filial
  ) then
    raise exception 'Parcela nao encontrada.'
      using errcode = '42501';
  end if;

  return public.saldo_parcela_interno(p_parcela_id);
end;
$$;

create or replace function public.garantir_financeiro_venda(p_venda_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venda     public.vendas%rowtype;
  v_detalhe   public.venda_detalhes%rowtype;
  v_titulo    public.titulos_financeiros%rowtype;
  v_parcela   public.parcelas_financeiras%rowtype;
  v_forma_id  uuid;
  v_plano     uuid;
  v_filial    uuid;
  v_valor     numeric(14, 2);
  v_status    text;
  v_baixa     uuid;
begin
  select * into v_venda from public.vendas where id = p_venda_id;
  if not found then
    return null;
  end if;

  select * into v_detalhe from public.venda_detalhes where venda_id = p_venda_id;
  if not found then
    return null;
  end if;

  v_filial := coalesce(v_venda.filial_id, public.filial_padrao(v_venda.organization_id));
  v_valor := round(coalesce(v_detalhe.total_cobrado, v_venda.total), 2);

  if v_valor <= 0 then
    return null;
  end if;

  select id into v_plano
    from public.plano_contas
   where organization_id = v_venda.organization_id and codigo = '3.1';

  insert into public.titulos_financeiros
    (organization_id, filial_id, tipo, origem_tipo, origem_id, numero, descricao,
     plano_conta_id, cliente_id, data_emissao, data_competencia, data_vencimento,
     valor_original, status)
  values
    (v_venda.organization_id, v_filial, 'receber', 'venda', v_venda.id,
     'VR-' || v_venda.codigo,
     'Venda ' || v_venda.codigo || coalesce(' - ' || v_detalhe.tipo_venda_nome, ''),
     v_plano, v_venda.cliente_id,
     coalesce(v_venda.criado_em::date, current_date),
     coalesce(v_venda.criado_em::date, current_date),
     coalesce(v_venda.criado_em::date, current_date),
     v_valor,
     case when v_venda.status = 'Cancelada' or v_venda.estornada_em is not null
          then 'cancelado' else 'aberto' end)
  on conflict (organization_id, origem_tipo, origem_id, tipo) do nothing;

  select * into v_titulo
    from public.titulos_financeiros
   where organization_id = v_venda.organization_id
     and origem_tipo = 'venda'
     and origem_id = v_venda.id
     and tipo = 'receber';

  if not found then
    return null;
  end if;

  select id into v_forma_id
    from public.formas_pagamento
   where organization_id = v_venda.organization_id
     and (
       id = v_detalhe.forma_pagamento_id
       or (v_detalhe.forma_pagamento_id is null
           and lower(nome) = lower(v_detalhe.forma_pagamento_nome))
     )
   limit 1;

  insert into public.venda_pagamentos
    (organization_id, filial_id, venda_id, forma_pagamento_id, forma, valor,
     valor_recebido, troco, status, confirmado_em)
  values
    (v_venda.organization_id, v_filial, v_venda.id,
     v_detalhe.forma_pagamento_id, v_detalhe.forma_pagamento_nome, v_valor,
     v_detalhe.valor_recebido, v_detalhe.troco,
     case when v_venda.status = 'Concluída' and v_venda.estornada_em is null
          then 'confirmado' else 'pendente' end,
     case when v_venda.status = 'Concluída' and v_venda.estornada_em is null
          then now() else null end)
  on conflict (venda_id, forma, valor) do nothing;

  if v_venda.status = 'Cancelada' or v_venda.estornada_em is not null then
    update public.titulos_financeiros
       set status = 'cancelado', atualizado_em = now()
     where id = v_titulo.id;
    update public.parcelas_financeiras
       set status = 'cancelado'
     where titulo_id = v_titulo.id and valor_liquidado <= 0.0001;
    update public.venda_pagamentos
       set status = 'estornado'
     where venda_id = v_venda.id;
    return v_titulo.id;
  end if;

  if v_venda.status = 'Concluída' then
    select * into v_parcela
      from public.parcelas_financeiras
     where titulo_id = v_titulo.id and numero = 1;

    if found and public.saldo_parcela_interno(v_parcela.id) > 0.0001
       and not exists (
         select 1 from public.baixas_financeiras b
          where b.organization_id = v_venda.organization_id
            and b.chave_idempotencia = 'venda:' || v_venda.id::text
       ) then
      insert into public.baixas_financeiras
        (organization_id, filial_id, parcela_id, tipo, valor, data,
         forma_pagamento_id, forma, chave_idempotencia, criado_por)
      values
        (v_venda.organization_id, v_filial, v_parcela.id, 'recebimento',
         public.saldo_parcela_interno(v_parcela.id), coalesce(v_venda.criado_em::date, current_date),
         v_detalhe.forma_pagamento_id, v_detalhe.forma_pagamento_nome,
         'venda:' || v_venda.id::text, coalesce(v_venda.usuario_id, auth.uid()))
      returning id into v_baixa;
    end if;

    update public.venda_pagamentos
       set status = 'confirmado', confirmado_em = coalesce(confirmado_em, now())
     where venda_id = v_venda.id and status = 'pendente';
  end if;

  return v_titulo.id;
end;
$$;

create or replace function public.baixar_parcela_financeira(
  p_parcela_id uuid,
  p_valor numeric default null,
  p_data date default current_date,
  p_forma_pagamento_id uuid default null,
  p_observacoes text default '',
  p_chave text default null
)
returns table (
  baixa_id uuid,
  titulo_id uuid,
  status text,
  saldo numeric,
  ja_existia boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid := public.minha_organizacao();
  v_usuario  uuid := auth.uid();
  v_filial   uuid := public.filial_ativa();
  v_parcela  public.parcelas_financeiras%rowtype;
  v_titulo   public.titulos_financeiros%rowtype;
  v_forma    public.formas_pagamento%rowtype;
  v_saldo    numeric(14, 2);
  v_valor    numeric(14, 2);
  v_tipo     text;
  v_baixa    public.baixas_financeiras%rowtype;
  v_chave    text := nullif(btrim(coalesce(p_chave, '')), '');
begin
  if v_usuario is null then
    raise exception 'Sessao expirada. Entre novamente para baixar o titulo.';
  end if;

  if v_org is null or v_filial is null then
    raise exception 'Selecione uma filial autorizada para baixar o titulo.'
      using errcode = '42501';
  end if;

  if not public.pode('financeiro', 'editar') then
    raise exception 'Sua conta nao tem permissao para baixar titulos financeiros.'
      using errcode = '42501';
  end if;

  select * into v_parcela
    from public.parcelas_financeiras
   where id = p_parcela_id
     and organization_id = v_org
     and filial_id = v_filial
   for update;

  if not found then
    raise exception 'Parcela nao encontrada na filial ativa.'
      using errcode = '42501';
  end if;

  select * into v_titulo
    from public.titulos_financeiros
   where id = v_parcela.titulo_id
     and organization_id = v_org
     and filial_id = v_filial
   for update;

  if not found then
    raise exception 'Titulo nao encontrado na filial ativa.'
      using errcode = '42501';
  end if;

  if v_titulo.status = 'cancelado' then
    raise exception 'Titulo cancelado nao recebe baixa.';
  end if;

  if v_chave is not null then
    select * into v_baixa
      from public.baixas_financeiras
     where organization_id = v_org and chave_idempotencia = v_chave;

    if found then
      return query
        select v_baixa.id, v_titulo.id, v_titulo.status,
               public.saldo_parcela_interno(v_parcela.id), true;
      return;
    end if;
  end if;

  v_saldo := public.saldo_parcela_interno(v_parcela.id);
  v_valor := round(coalesce(p_valor, v_saldo), 2);

  if v_valor <= 0 then
    raise exception 'O valor da baixa precisa ser maior que zero.';
  end if;

  if v_valor > v_saldo + 0.0001 then
    raise exception 'O valor de % ultrapassa o saldo de % da parcela.', v_valor, v_saldo;
  end if;

  if p_forma_pagamento_id is not null then
    select * into v_forma
      from public.formas_pagamento
     where id = p_forma_pagamento_id
       and organization_id = v_org
       and ativo;

    if not found then
      raise exception 'Forma de pagamento nao encontrada ou inativa.';
    end if;
  end if;

  v_tipo := case when v_titulo.tipo = 'receber' then 'recebimento' else 'pagamento' end;

  insert into public.baixas_financeiras
    (organization_id, filial_id, parcela_id, tipo, valor, data,
     forma_pagamento_id, forma, observacoes, chave_idempotencia, criado_por)
  values
    (v_org, v_titulo.filial_id, v_parcela.id, v_tipo, v_valor,
     coalesce(p_data, current_date), p_forma_pagamento_id,
     coalesce(v_forma.nome, case when v_tipo = 'recebimento' then 'Recebimento' else 'Pagamento' end),
     coalesce(btrim(p_observacoes), ''), v_chave, v_usuario)
  returning * into v_baixa;

  select * into v_titulo from public.titulos_financeiros where id = v_titulo.id;

  return query
    select v_baixa.id, v_titulo.id, v_titulo.status,
           public.saldo_parcela_interno(v_parcela.id), false;
end;
$$;

create or replace function public.custo_ficha_tecnica(p_ficha_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
  v_ficha public.fichas_tecnicas%rowtype;
  v_custo numeric;
begin
  if auth.uid() is null
     or v_org is null
     or v_filial is null
     or not public.pode('estoque', 'ver') then
    raise exception 'Ficha tecnica indisponivel para esta conta.'
      using errcode = '42501';
  end if;

  select f.* into v_ficha
    from public.fichas_tecnicas f
   where f.id = p_ficha_id
     and f.organization_id = v_org
     and coalesce(f.filial_id, public.filial_padrao(f.organization_id)) = v_filial;

  if not found then
    raise exception 'Ficha tecnica nao encontrada.'
      using errcode = '42501';
  end if;

  select coalesce(sum(
           (i.quantidade / v_ficha.rendimento)
           * (1 + i.perda_percentual / 100)
           * coalesce(p.custo, 0)
         ), 0)
    into v_custo
    from public.fichas_tecnicas_itens i
    join public.produtos p
      on p.id = i.componente_id
     and p.organization_id = v_org
   where i.ficha_id = v_ficha.id
     and i.organization_id = v_org;

  return v_custo;
end;
$$;

revoke all on function public.saldo_parcela(uuid) from public, anonymous;
revoke all on function public.custo_ficha_tecnica(uuid) from public, anonymous;
grant execute on function public.saldo_parcela(uuid) to authenticated;
grant execute on function public.custo_ficha_tecnica(uuid) to authenticated;

comment on function public.saldo_parcela(uuid) is
  'Retorna saldo apenas com financeiro.ver e para a organizacao e filial ativa do usuario.';
comment on function public.saldo_parcela_interno(uuid) is
  'Calculo interno sem acesso RPC; executavel somente por funcoes SECURITY DEFINER autorizadas.';
comment on function public.custo_ficha_tecnica(uuid) is
  'Retorna custo apenas com estoque.ver e para a organizacao e filial ativa do usuario.';
