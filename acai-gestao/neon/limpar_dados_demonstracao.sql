-- ============================================================================
-- Limpeza GUARDADA de vendas de demonstração (NÃO execute sem autorização)
-- ============================================================================
-- Este arquivo NÃO roda sozinho em CI nem em `validar:migracoes`. Ele apaga
-- vendas antigas de seed/demonstração, com várias travas:
--
--   1. exige `acai.organization_id`, `acai.limpar_ate` e
--      `acai.confirmar = 'SIM'`;
--   2. recusa se o corte não preservar pelo menos uma venda real da organização;
--   3. mostra quantas vendas/itens/movimentos serão afetados;
--   4. apaga o livro-razão das vendas de seed e recalcula o saldo em cache dos
--      produtos afetados a partir do livro que sobrou;
--   5. roda em transação: o COMMIT só acontece no fim.
--
-- PRÉ-REQUISITOS, na ordem:
--   a) criar uma branch/backup do Neon e confirmar que ela abre;
--   b) rodar `diagnostico_dados_demonstracao.sql` e revisar os números;
--   c) escolher um corte que não atinja nenhuma venda real;
--   d) executar este arquivo numa sessão do SQL Editor, com os três SET abaixo.
--
-- Exemplo (confirme a organização e a data no seu banco):
--
--   set acai.organization_id = '<uuid-da-organizacao>';
--   set acai.limpar_ate      = '2026-10-20 00:00:00-03';
--   set acai.confirmar       = 'SIM';
--   \i limpar_dados_demonstracao.sql
--
-- Sem os três SET, o script levanta exceção e não altera nada.

begin;

do $$
declare
  v_limite text := current_setting('acai.limpar_ate', true);
  v_ok     text := current_setting('acai.confirmar', true);
  v_org_tx text := current_setting('acai.organization_id', true);
  v_org    uuid;
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
  if coalesce(v_org_tx, '') = '' then
    raise exception 'Limpeza bloqueada: defina acai.organization_id com a organização que será limpa.';
  end if;

  v_data := v_limite::timestamptz;
  v_org := v_org_tx::uuid;

  select count(*) into v_reais
    from public.vendas
   where organization_id = v_org
     and criado_em >= v_data;

  select count(*), coalesce(sum((select count(*) from public.itens_venda i where i.venda_id = v.id)), 0)
    into v_vendas, v_itens
    from public.vendas v
   where v.organization_id = v_org
     and v.criado_em < v_data;

  select count(*) into v_movs
    from public.movimentacoes_estoque m
    join public.vendas v on v.id = m.venda_id
   where v.organization_id = v_org
     and v.criado_em < v_data;

  -- Uma data de corte no futuro não pode apagar a base inteira. A limpeza só
  -- faz sentido se sobrar pelo menos uma venda real depois do corte.
  if v_reais = 0 then
    raise exception 'Limpeza bloqueada: o corte % não preserva nenhuma venda da organização. Escolha uma data anterior à venda real mais antiga.', v_data;
  end if;

  -- Se o corte for posterior à venda real mais antiga, o operador escolheu a
  -- data errada. Aborta antes de apagar qualquer coisa.
  if v_data > (
    select min(criado_em)
      from public.vendas
     where organization_id = v_org
       and criado_em >= v_data
  ) then
    raise exception 'Limpeza bloqueada: o corte % é posterior a uma venda mantida (%). Escolha uma data anterior.',
      v_data,
      (
        select min(criado_em)
          from public.vendas
         where organization_id = v_org
           and criado_em >= v_data
      );
  end if;

  raise notice 'Corte: % · vendas a apagar: % · itens: % · movimentos: % · vendas mantidas (reais): %',
    v_data, v_vendas, v_itens, v_movs, v_reais;
end;
$$;

-- Guarda os produtos que terão o cache recalculado depois de remover o livro.
create temporary table acai_produtos_afetados on commit drop as
select distinct m.produto_id
  from public.movimentacoes_estoque m
  join public.vendas v on v.id = m.venda_id
 where v.organization_id = current_setting('acai.organization_id')::uuid
   and v.criado_em < current_setting('acai.limpar_ate')::timestamptz;

-- 1. O livro-razão é imutável por trigger. Esta limpeza é uma manutenção
--    explícita de dados de demonstração, já confirmada e com backup: desliga
--    apenas o trigger de imutabilidade dentro desta transação. Se qualquer
--    passo falhar, o ROLLBACK reativa o trigger.
alter table public.movimentacoes_estoque
  disable trigger movimentacoes_estoque_imutavel;

-- O recálculo do cache também roda como owner nesta manutenção; desligar o
-- trigger específico evita que ele exija uma sessão JWT. O trigger volta no fim.
alter table public.produtos
  disable trigger produtos_saldo_do_livro;

-- 2. Remove os movimentos ligados às vendas de seed (FK é ON DELETE RESTRICT).
delete from public.movimentacoes_estoque m
 using public.vendas v
 where m.venda_id = v.id
   and v.organization_id = current_setting('acai.organization_id')::uuid
   and v.criado_em < current_setting('acai.limpar_ate')::timestamptz;

-- 3. Remove as vendas. Itens e detalhes caem por ON DELETE CASCADE.
delete from public.vendas
 where organization_id = current_setting('acai.organization_id')::uuid
   and criado_em < current_setting('acai.limpar_ate')::timestamptz;

-- 4. Recalcula o saldo em cache dos produtos afetados a partir do livro que
--    sobrou. Como os movimentos de venda foram removidos, o saldo volta ao
--    valor anterior à demonstração.
update public.produtos p
   set quantidade = public.saldo_estoque(p.id)
 where p.organization_id = current_setting('acai.organization_id')::uuid
   and p.id in (select produto_id from acai_produtos_afetados);

-- 5. Religa os triggers antes do COMMIT. Eles também seriam religados por um
--    ROLLBACK se qualquer passo acima falhasse.
alter table public.produtos
  enable trigger produtos_saldo_do_livro;

alter table public.movimentacoes_estoque
  enable trigger movimentacoes_estoque_imutavel;

-- 6. Conferência final: nada antes do corte naquela organização, e as vendas
--    reais continuam lá.
do $$
declare
  v_org      uuid := current_setting('acai.organization_id')::uuid;
  v_limite   timestamptz := current_setting('acai.limpar_ate')::timestamptz;
  v_restantes integer;
  v_reais    integer;
begin
  select count(*) into v_restantes
    from public.vendas
   where organization_id = v_org
     and criado_em < v_limite;
  select count(*) into v_reais
    from public.vendas
   where organization_id = v_org
     and criado_em >= v_limite;

  if v_restantes > 0 then
    raise exception 'A limpeza não removeu todas as vendas antigas da organização (% restantes). Rollback aplicado.', v_restantes;
  end if;

  raise notice 'Limpeza concluída. Vendas reais preservadas: %', v_reais;
end;
$$;

-- Troque por ROLLBACK se quiser apenas simular numa transação.
commit;
