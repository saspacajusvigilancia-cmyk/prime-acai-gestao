-- ============================================================================
-- 35 · Corrige o JOIN de filiais na view de títulos financeiros
-- ============================================================================
-- A view `vw_titulos_financeiros` (migração 33) fazia `join` INNER em
-- `filiais`, cuja política de leitura exige `configuracoes.ver`. Como a view é
-- `security_invoker`, um usuário com `financeiro.consultar` mas SEM
-- `configuracoes.ver` via a lista "Contas a receber e a pagar" vazia: o RLS
-- de `filiais` filtrava a linha e o INNER JOIN descartava o título inteiro.
--
-- A coluna `filial_nome` nem é lida pelo app (src/services/financeiro.js),
-- então o vínculo é apenas informativo. O `left join` mantém o título visível
-- mesmo quando o leitor não enxerga a filial, preservando o isolamento por
-- organização (o RLS de `titulos_financeiros`/`parcelas_financeiras` continua
-- sendo a porta de entrada, e segue exigindo `financeiro.consultar`).
--
-- Idempotente: recria a view com o mesmo shape, apenas trocando o INNER por
-- LEFT no join de `filiais`. Seguro para bancos que já aplicaram a 33.
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
left join public.filiais f on f.id = t.filial_id
join public.parcelas_financeiras p on p.titulo_id = t.id
left join public.clientes c on c.id = t.cliente_id
left join public.fornecedores fo on fo.id = t.fornecedor_id;

alter view public.vw_titulos_financeiros set (security_invoker = on);

revoke all on public.vw_titulos_financeiros from public, anonymous;
grant select on public.vw_titulos_financeiros to authenticated;

notify pgrst, 'reload schema';
