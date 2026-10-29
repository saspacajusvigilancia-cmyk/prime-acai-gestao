-- ============================================================================
-- Reversao da migracao 35: restaura o JOIN INNER de filiais na view de títulos.
-- ============================================================================
-- A correcao da 35 trocou o INNER por LEFT em `filiais` para nao esconder
-- títulos de quem tem `financeiro.consultar` sem `configuracoes.ver`. Esta
-- reversao devolve o comportamento original (INNER), caso seja preciso voltar
-- atrás. Nao apaga dados: apenas recria a view.
-- ============================================================================

drop view if exists public.vw_titulos_financeiros;

create or replace view public.vw_titulos_financeiros as
select
  t.id,
  t.organization_id,
  t.filial_id,
  f.nome as filial_nome,
  t.tipo,
  t.origem_tipo,
  t.origem_id,
  t.numero,
  t.descricao,
  t.status,
  t.data_emissao,
  t.data_vencimento,
  t.valor_original,
  t.valor_liquidado,
  p.id as parcela_id,
  p.numero as parcela_numero,
  p.vencimento as parcela_vencimento,
  p.valor as parcela_valor,
  p.valor_liquidado as parcela_liquidado,
  p.status as parcela_status,
  greatest(0, round(p.valor - p.valor_liquidado, 2)) as saldo,
  c.nome as cliente,
  fo.nome as fornecedor
from public.titulos_financeiros t
join public.filiais f on f.id = t.filial_id
join public.parcelas_financeiras p on p.titulo_id = t.id
left join public.clientes c on c.id = t.cliente_id
left join public.fornecedores fo on fo.id = t.fornecedor_id;

alter view public.vw_titulos_financeiros set (security_invoker = on);

revoke all on public.vw_titulos_financeiros from public, anonymous;
grant select on public.vw_titulos_financeiros to authenticated;

notify pgrst, 'reload schema';
