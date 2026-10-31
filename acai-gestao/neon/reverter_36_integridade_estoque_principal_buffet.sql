-- Reverte a aplicação 36 sem apagar movimentos, recebimentos nem chaves
-- idempotentes já gravados. As tabelas de idempotência são mantidas como
-- histórico operacional e podem ser reutilizadas se a migração for reaplicada.

drop trigger if exists movimentacao_transferencia_exige_saldo
  on public.movimentacoes_estoque;
drop trigger if exists movimentacao_compra_exige_estoque_principal
  on public.movimentacoes_estoque;

drop function if exists public.impedir_transferencia_com_saldo_insuficiente();
drop function if exists public.impedir_compra_direta_buffet();
drop function if exists public.registrar_movimentacao_local_v3(
  uuid, numeric, text, text, text, text
);
drop function if exists public.confirmar_recebimento_compra_idempotente(
  uuid, jsonb, text
);

alter table public.estoque_operacoes_idempotencia
  drop constraint if exists estoque_operacoes_idempotencia_movimentacao_fk;

grant execute on function public.registrar_movimentacao_local_v2(
  uuid, numeric, text, text, text
) to authenticated;
grant execute on function public.registrar_movimentacao(
  uuid, numeric, text, text, text
) to authenticated;
grant execute on function public.confirmar_recebimento_compra(uuid, jsonb)
  to authenticated;

create or replace view public.vw_resumo as
select
  (select coalesce(sum(v.total + coalesce(d.taxa_entrega, 0)), 0)
     from public.vendas v left join public.venda_detalhes d on d.venda_id = v.id
    where v.status <> 'Cancelada' and v.criado_em >= date_trunc('month', current_date)) as faturamento_mes,
  (select coalesce(sum(v.total + coalesce(d.taxa_entrega, 0)), 0)
     from public.vendas v left join public.venda_detalhes d on d.venda_id = v.id
    where v.status <> 'Cancelada' and v.criado_em::date = current_date) as faturamento_hoje,
  (select count(*) from public.vendas where criado_em::date = current_date) as vendas_hoje,
  (select count(*) from public.vendas
    where status = 'Cancelada' and criado_em::date = current_date) as cancelamentos_hoje,
  (select coalesce(avg(v.total + coalesce(d.taxa_entrega, 0)), 0)
     from public.vendas v left join public.venda_detalhes d on d.venda_id = v.id
    where v.status <> 'Cancelada') as ticket_medio,
  (select count(*) from public.clientes) as total_clientes,
  (select count(*) from public.clientes where desde >= current_date - 30) as novos_clientes,
  (select count(*) from public.clientes where tier = 'VIP') as clientes_vip,
  (select coalesce(sum(quantidade * custo), 0) from public.produtos where ativo) as valor_estoque,
  (select count(*) from public.produtos where ativo and quantidade < minimo) as itens_abaixo_minimo;
alter view public.vw_resumo set (security_invoker = on);

comment on table public.estoque_operacoes_idempotencia is
  'Histórico idempotente da migration 36; mantido intencionalmente após reversão para preservar chaves já usadas.';
comment on table public.recebimentos_compra_idempotencia is
  'Histórico idempotente da migration 36; mantido intencionalmente após reversão para preservar chaves já usadas.';

notify pgrst, 'reload schema';
