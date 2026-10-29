-- ============================================================================
-- Reversao da migracao 33 (ERP: empresas, filiais, depositos e financeiro)
-- ============================================================================
-- Remove somente o que a 33 criou. As tabelas e dados anteriores permanecem.
-- A ordem importa: gatilhos e funcoes primeiro, depois as tabelas que possuem
-- chaves estrangeiras para as tabelas antigas.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Gatilhos
-- ---------------------------------------------------------------------------
drop trigger if exists financeiro_venda_status on public.vendas;
drop trigger if exists financeiro_venda_detalhe on public.venda_detalhes;
drop trigger if exists financeiro_recebimento_compra on public.recebimentos_compra;
drop trigger if exists aplicar_baixa_financeira on public.baixas_financeiras;
drop trigger if exists after_parcela_financeira on public.parcelas_financeiras;
drop trigger if exists atualizar_status_parcela on public.parcelas_financeiras;
drop trigger if exists criar_parcela_do_titulo on public.titulos_financeiros;
drop trigger if exists preencher_contexto_movimento on public.movimentacoes_estoque;
drop trigger if exists criar_depositos_da_filial on public.filiais;

drop trigger if exists preencher_filial_padrao on public.vendas;
drop trigger if exists preencher_filial_padrao on public.itens_venda;
drop trigger if exists preencher_filial_padrao on public.venda_detalhes;
drop trigger if exists preencher_filial_padrao on public.compras;
drop trigger if exists preencher_filial_padrao on public.transferencias_estoque;
drop trigger if exists preencher_filial_padrao on public.lancamentos;

-- ---------------------------------------------------------------------------
-- 2. Views
-- ---------------------------------------------------------------------------
drop view if exists public.vw_saldos_por_filial_deposito;
drop view if exists public.vw_resultado_mensal;
drop view if exists public.vw_financeiro_resumo;
drop view if exists public.vw_titulos_financeiros;

-- ---------------------------------------------------------------------------
-- 3. Funcoes
-- ---------------------------------------------------------------------------
drop function if exists public.baixar_parcela_financeira(uuid, numeric, date, uuid, text, text);
drop function if exists public.financeiro_venda_status();
drop function if exists public.financeiro_venda_detalhe();
drop function if exists public.cancelar_financeiro_venda(uuid);
drop function if exists public.garantir_financeiro_venda(uuid);
drop function if exists public.financeiro_recebimento_compra();
drop function if exists public.garantir_financeiro_recebimento(uuid);
drop function if exists public.saldo_parcela(uuid);
drop function if exists public.aplicar_baixa_financeira();
drop function if exists public.after_parcela_financeira();
drop function if exists public.atualizar_status_parcela();
drop function if exists public.recalcular_titulo_financeiro(uuid);
drop function if exists public.criar_parcela_do_titulo();
drop function if exists public.custo_ficha_tecnica(uuid);
drop function if exists public.criar_depositos_da_filial();
drop function if exists public.preencher_filial_padrao();
drop function if exists public.preencher_contexto_movimento();
drop function if exists public.deposito_por_codigo(uuid, uuid, text);
drop function if exists public.filial_padrao(uuid);

-- ---------------------------------------------------------------------------
-- 4. Tabelas novas (dependentes primeiro)
-- ---------------------------------------------------------------------------
drop table if exists public.fichas_tecnicas_itens;
drop table if exists public.fichas_tecnicas;

drop table if exists public.movimentos_caixa;
drop table if exists public.sessoes_caixa;
drop table if exists public.caixas;

drop table if exists public.baixas_financeiras;
drop table if exists public.parcelas_financeiras;
drop table if exists public.titulos_financeiros;
drop table if exists public.venda_pagamentos;

drop table if exists public.recebimentos_compra_itens;
drop table if exists public.recebimentos_compra;

-- ---------------------------------------------------------------------------
-- 5. Colunas acrescentadas nas tabelas antigas
-- ---------------------------------------------------------------------------
drop index if exists public.lancamentos_chave_idempotencia_unica;

alter table public.lancamentos
  drop constraint if exists lancamentos_plano_conta_fk;
alter table public.lancamentos
  drop column if exists plano_conta_id,
  drop column if exists origem_tipo,
  drop column if exists origem_id,
  drop column if exists natureza,
  drop column if exists chave_idempotencia,
  drop column if exists filial_id;

alter table public.vendas drop column if exists filial_id;
alter table public.itens_venda drop column if exists filial_id;
alter table public.venda_detalhes drop column if exists filial_id;
alter table public.compras drop column if exists filial_id;
alter table public.transferencias_estoque drop column if exists filial_id;

drop index if exists public.idx_movimentos_origem_deposito;
drop index if exists public.idx_movimentos_destino_deposito;
drop index if exists public.idx_movimentos_compra;
drop index if exists public.movimentos_recebimento_item_unico;

alter table public.movimentacoes_estoque
  drop constraint if exists movimentos_origem_deposito_fk,
  drop constraint if exists movimentos_destino_deposito_fk;
alter table public.movimentacoes_estoque
  drop column if exists origem_deposito_id,
  drop column if exists destino_deposito_id,
  drop column if exists recebimento_compra_id,
  drop column if exists recebimento_item_id,
  drop column if exists compra_id,
  drop column if exists compra_item_id,
  drop column if exists custo_unitario,
  drop column if exists valor_total,
  drop column if exists documento_tipo,
  drop column if exists documento_id,
  drop column if exists filial_id;

alter table public.estoque_locais
  drop constraint if exists estoque_locais_deposito_fk;
alter table public.estoque_locais
  drop column if exists deposito_id,
  drop column if exists filial_id;

alter table public.profiles
  drop constraint if exists profiles_filial_fk;
alter table public.profiles drop column if exists filial_id;

-- ---------------------------------------------------------------------------
-- 6. Estrutura de empresas/filiais/depositos e plano de contas
-- ---------------------------------------------------------------------------
drop table if exists public.depositos;
drop table if exists public.filiais;
drop table if exists public.empresas;
drop table if exists public.plano_contas;

drop sequence if exists public.recebimentos_compra_numero_seq;

notify pgrst, 'reload schema';
