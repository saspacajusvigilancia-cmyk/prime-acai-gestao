-- ============================================================================
-- Limpeza GUARDADA de vendas de demonstração (NÃO execute sem autorização)
-- ============================================================================
-- Este arquivo NÃO roda sozinho em CI nem em `validar:migracoes`. Ele apaga
-- vendas antigas de seed/demonstração, com várias travas:
--
--   1. exige `acai.limpar_ate` (data de corte) e `acai.confirmar = 'SIM'`;
--   2. recusa se o corte não for anterior à venda real mais antiga;
--   3. mostra quantas vendas/itens/movimentos serão afetados;
--   4. repõe no saldo em cache apenas a quantidade dos movimentos de venda
--      apagados (os únicos que o livro-razão liga a uma venda);
--   5. roda em transação: o COMMIT só acontece no fim.
--
-- PRÉ-REQUISITOS, na ordem:
--   a) criar uma branch/backup do Neon e confirmar que ela abre;
--   b) rodar `diagnostico_dados_demonstracao.sql` e revisar os números;
--   c) escolher um corte que não atinja nenhuma venda real;
--   d) executar este arquivo numa sessão do SQL Editor, com os dois SET abaixo.
--
-- Exemplo (a data é do seed encontrado em 28/10/2026 — confirme a sua):
--
--   set acai.limpar_ate = '2026-10-20 00:00:00-03';
--   set acai.confirmar   = 'SIM';
--   \i limpar_dados_demonstracao.sql
--
-- Sem os dois SET, o script levanta exceção e não altera nada.

begin;

do $$
declare
  v_limite text := current_setting('acai.limpar_ate', true);
  v_ok     text := current_setting('acai.confirmar', true);
  v_data   timestamptz;
  v_reais  integer;
  v_vendas integer;
  v_itens  integer;
  v_movs   integer;
begin
  if coalesce(v_ok, '') <> 'SIM' then
    raise exception 'Limpeza bloqueada: defina acai.confirmar = ''SIM'' depois de revisar o diagnóstico.';
  end if;
  if coalesce(v_limite, '') = '' then
    raise exception 'Limpeza bloqueada: defina acai.limpar_ate com a data de corte (ex.: 2026-10-20 00:00:00-03).';
  end if;

  v_data := v_limite::timestamptz;

  select count(*) into v_reais
    from public.vendas
   where criado_em >= v_data;

  select count(*), coalesce(sum((select count(*) from public.itens_venda i where i.venda_id = v.id)), 0)
    into v_vendas, v_itens
    from public.vendas v
   where v.criado_em < v_data;

  select count(*) into v_movs
    from public.movimentacoes_estoque m
    join public.vendas v on v.id = m.venda_id
   where v.criado_em < v_data;

  raise notice 'Corte: % · vendas a apagar: % · itens: % · movimentos: % · vendas mantidas (reais): %',
    v_data, v_vendas, v_itens, v_movs, v_reais;

  -- Trava de segurança: se o corte for posterior à venda real mais antiga, o
  -- operador escolheu a data errada. Aborta antes de apagar qualquer coisa.
  if v_reais > 0 and exists (
    select 1 from public.vendas where criado_em < v_data
  ) and v_data > (select min(criado_em) from public.vendas where criado_em >= v_data) then
    raise exception 'Limpeza bloqueada: o corte % é posterior a uma venda mantida (%). Escolha uma data anterior.',
      v_data, (select min(criado_em) from public.vendas where criado_em >= v_data);
  end if;
end;
$$;

-- 1. Repõe o saldo em cache dos produtos afetados por movimentos de venda
--    que serão apagados. Vender baixou o estoque; apagar a venda devolve.
with removidos as (
  select m.produto_id,
         m.quantidade,
         m.origem,
         m.destino
    from public.movimentacoes_estoque m
    join public.vendas v on v.id = m.venda_id
   where v.criado_em < current_setting('acai.limpar_ate')::timestamptz
),
ajuste as (
  select produto_id,
         sum(case
               when origem = 'estoque' then quantidade
               when destino = 'estoque' then -quantidade
               else 0
             end) as delta
    from removidos
   group by produto_id
)
update public.produtos p
   set quantidade = p.quantidade + a.delta
  from ajuste a
 where p.id = a.produto_id
   and a.delta <> 0;

-- 2. Remove os movimentos ligados às vendas de seed (FK é ON DELETE RESTRICT).
delete from public.movimentacoes_estoque m
 using public.vendas v
 where m.venda_id = v.id
   and v.criado_em < current_setting('acai.limpar_ate')::timestamptz;

-- 3. Remove as vendas. Itens e detalhes caem por ON DELETE CASCADE.
delete from public.vendas
 where criado_em < current_setting('acai.limpar_ate')::timestamptz;

-- 4. Conferência final: nada antes do corte, e as vendas reais continuam lá.
do $$
declare
  v_restantes integer;
  v_reais integer;
begin
  select count(*) into v_restantes
    from public.vendas
   where criado_em < current_setting('acai.limpar_ate')::timestamptz;
  select count(*) into v_reais
    from public.vendas
   where criado_em >= current_setting('acai.limpar_ate')::timestamptz;

  if v_restantes > 0 then
    raise exception 'A limpeza não removeu todas as vendas antigas (% restantes). Rollback aplicado.', v_restantes;
  end if;

  raise notice 'Limpeza concluída. Vendas reais preservadas: %', v_reais;
end;
$$;

-- Troque por ROLLBACK se quiser apenas simular numa transação.
commit;
