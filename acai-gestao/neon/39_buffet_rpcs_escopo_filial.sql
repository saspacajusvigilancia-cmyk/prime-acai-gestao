-- ============================================================================
-- 39 - Leitura do Buffet restrita à filial ativa também nas RPCs SECURITY DEFINER
-- ============================================================================

create or replace function public.listar_fechamentos_buffet()
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
       and f.filial_id = public.filial_ativa()
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
declare
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar fechamentos.'
      using errcode = '42501';
  end if;
  if v_org is null or v_filial is null or not exists (
    select 1
      from public.fechamentos_buffet f
     where f.id = p_id
       and f.organization_id = v_org
       and f.filial_id = v_filial
  ) then
    raise exception 'Fechamento não encontrado nesta filial.';
  end if;
  return query
    select i.produto_id, p.nome, i.saldo_sistema, i.saldo_contado,
           i.diferenca, i.movimentacao_id
      from public.fechamentos_buffet_itens i
      join public.fechamentos_buffet f
        on f.id = i.fechamento_id
       and f.organization_id = i.organization_id
       and f.filial_id = v_filial
      join public.produtos p
        on p.id = i.produto_id
       and p.organization_id = i.organization_id
     where i.fechamento_id = p_id
       and i.organization_id = v_org
       and i.filial_id = v_filial
     order by p.nome;
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
declare
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
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
        on l.movimentacao_id = mv.id
       and l.organization_id = mv.organization_id
       and l.filial_id = v_filial
      left join public.devolucoes_buffet d
        on d.movimentacao_id = mv.id
       and d.organization_id = mv.organization_id
       and d.filial_id = v_filial
      left join public.profiles pr on pr.id = mv.usuario_id
     where mv.organization_id = v_org
       and mv.filial_id = v_filial
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
declare
  v_org uuid := public.minha_organizacao();
  v_filial uuid := public.filial_ativa();
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar o fechamento do Buffet.'
      using errcode = '42501';
  end if;
  if v_org is null or v_filial is null or not exists (
    select 1
      from public.fechamentos_buffet f
     where f.id = p_id
       and f.organization_id = v_org
       and f.filial_id = v_filial
  ) then
    raise exception 'Fechamento não encontrado nesta filial.';
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
       and f.filial_id = v_filial
      join public.fechamentos_buffet_abertura a
        on a.fechamento_id = i.fechamento_id
       and a.produto_id = i.produto_id
       and a.organization_id = f.organization_id
       and a.filial_id = v_filial
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
           and mv.filial_id = v_filial
           and mv.produto_id = i.produto_id
           and mv.criado_em >= f.aberto_em
           and mv.criado_em <= f.fechado_em
           and mv.id is distinct from i.movimentacao_id
      ) m on true
     where i.fechamento_id = p_id
       and i.organization_id = v_org
       and i.filial_id = v_filial
     order by p.nome;
end;
$$;

revoke all on function public.listar_fechamentos_buffet() from public, anonymous;
revoke all on function public.listar_itens_fechamento_buffet(uuid) from public, anonymous;
revoke all on function public.listar_operacoes_buffet(date, date, uuid) from public, anonymous;
revoke all on function public.resumo_fechamento_buffet(uuid) from public, anonymous;

grant execute on function public.listar_fechamentos_buffet() to authenticated;
grant execute on function public.listar_itens_fechamento_buffet(uuid) to authenticated;
grant execute on function public.listar_operacoes_buffet(date, date, uuid) to authenticated;
grant execute on function public.resumo_fechamento_buffet(uuid) to authenticated;

notify pgrst, 'reload schema';
