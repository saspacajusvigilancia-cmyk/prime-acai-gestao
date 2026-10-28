-- ============================================================================
-- Diagnóstico (SOMENTE LEITURA) — dados de demonstração misturados à produção
-- ============================================================================
-- Execute este arquivo no SQL Editor do Neon, na branch que estiver sendo
-- analisada. Nenhum comando abaixo altera dados.
--
-- O objetivo é mostrar, com números, o que veio de seed/demonstração e o que
-- foi lançado depois. A limpeza é um passo separado e exige autorização
-- explícita (`limpar_dados_demonstracao.sql`).

-- 1. Vendas por mês, separando o período de seed do período real.
--    Em 28/10/2026 o seed terminava em 2026-10-19 e as vendas reais
--    começavam em 2026-10-22. Ajuste a data de corte se o seu caso for outro.
with corte as (
  select timestamptz '2026-10-20 00:00:00-03' as limite
)
select
  date_trunc('month', v.criado_em)::date as mes,
  count(*)                               as vendas,
  sum(v.total)::numeric(14,2)            as total,
  (select count(*) from public.itens_venda i where i.venda_id = v.id) as itens,
  case when v.criado_em < (select limite from corte) then 'seed/antes do corte' else 'real/depois do corte' end as origem
from public.vendas v
group by 1, v.criado_em < (select limite from corte)
order by 1 desc, 5;

-- 2. Vendas cujo total não bate com a soma dos itens.
--    As linhas de seed têm totais propositalmente aleatórios; vendas reais
--    devem fechar. Se aparecer divergência DEPOIS do corte, é bug de venda.
with corte as (
  select timestamptz '2026-10-20 00:00:00-03' as limite
),
divergentes as (
  select
    v.id,
    v.codigo,
    v.criado_em,
    v.total,
    coalesce(sum(i.total), 0) as soma_itens,
    round(v.total - coalesce(sum(i.total), 0), 2) as diferenca
  from public.vendas v
  left join public.itens_venda i on i.venda_id = v.id
  group by v.id, v.codigo, v.criado_em, v.total
  having abs(v.total - coalesce(sum(i.total), 0)) > 0.01
)
select
  case when d.criado_em < (select limite from corte) then 'seed/antes do corte' else 'real/depois do corte' end as origem,
  count(*) as vendas_divergentes,
  min(d.criado_em) as primeira,
  max(d.criado_em) as ultima
from divergentes d
group by 1;

-- 3. Amostra das vendas reais (depois do corte), que NÃO devem ser apagadas.
with corte as (
  select timestamptz '2026-10-20 00:00:00-03' as limite
)
select v.codigo, v.status, v.total, v.criado_em,
       (select count(*) from public.itens_venda i where i.venda_id = v.id) as itens
from public.vendas v
where v.criado_em >= (select limite from corte)
order by v.criado_em;

-- 4. Produtos e clientes criados no mesmo instante do seed.
--    Eles podem estar referenciados por vendas reais: NÃO apague por data sem
--    conferir as referências.
select 'produto' as tipo, codigo as referencia, nome, criado_em
from public.produtos
where criado_em < timestamptz '2026-10-18 00:00:00-03'
union all
select 'cliente', codigo, nome, criado_em
from public.clientes
where criado_em < timestamptz '2026-10-18 00:00:00-03'
order by criado_em, tipo, referencia;

-- 5. Referências que impedem apagar produtos/clientes antigos.
select 'itens de venda' as referencia, count(distinct produto_id) as produtos_usados
from public.itens_venda
union all
select 'vendas', count(distinct cliente_id) from public.vendas where cliente_id is not null;

-- 6. Integridade do estoque: saldo em cache x soma do livro-razão.
select count(*) as produtos_com_saldo_divergente
from public.produtos p
where p.controla_estoque
  and coalesce(p.quantidade, 0) <> coalesce((
    select sum(
      case
        when m.destino in ('estoque') then m.quantidade
        when m.origem in ('estoque') then -m.quantidade
        else 0
      end
    )
    from public.movimentacoes_estoque m
    where m.produto_id = p.id
  ), 0);

-- 7. RLS: tabelas públicas sem política (revisão de segurança).
select c.relname as tabela_sem_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
  )
order by 1;
