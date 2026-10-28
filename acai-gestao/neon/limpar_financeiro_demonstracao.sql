-- ============================================================================
-- Limpeza GUARDADA de lançamentos financeiros de demonstração
-- ============================================================================
-- Este arquivo NÃO roda sozinho em CI, deploy ou `validar:migracoes`.
-- Ele apaga os lançamentos antigos de seed/demonstração de UMA organização.
--
-- Travas:
--   1. exige `acai.organization_id`, `acai.limpar_ate`,
--      `acai.lancamentos_esperados` e `acai.confirmar = 'SIM'`;
--   2. só apaga lançamentos anteriores ao corte, daquela organização;
--   3. exige que a quantidade encontrada seja exatamente a esperada;
--   4. roda em transação e confere o resultado antes do COMMIT.
--
-- Exemplo (confirme os números no diagnóstico e tenha backup):
--
--   set acai.organization_id     = '<uuid-da-organizacao>';
--   set acai.limpar_ate          = '2026-10-20 00:00:00-03';
--   set acai.lancamentos_esperados = '518';
--   set acai.confirmar           = 'SIM';
--   \i limpar_financeiro_demonstracao.sql
--
-- Não apaga vendas, clientes, produtos nem movimentos de estoque.

begin;

do $$
declare
  v_org_tx  text := current_setting('acai.organization_id', true);
  v_limite  text := current_setting('acai.limpar_ate', true);
  v_esperado text := current_setting('acai.lancamentos_esperados', true);
  v_ok      text := current_setting('acai.confirmar', true);
  v_org     uuid;
  v_data    timestamptz;
  v_antes   integer;
  v_depois  integer;
  v_restam  integer;
begin
  if coalesce(v_ok, '') <> 'SIM' then
    raise exception 'Limpeza bloqueada: defina acai.confirmar = ''SIM'' depois de revisar o diagnóstico.';
  end if;
  if coalesce(v_org_tx, '') = '' then
    raise exception 'Limpeza bloqueada: defina acai.organization_id.';
  end if;
  if coalesce(v_limite, '') = '' then
    raise exception 'Limpeza bloqueada: defina acai.limpar_ate.';
  end if;
  if coalesce(v_esperado, '') = '' then
    raise exception 'Limpeza bloqueada: defina acai.lancamentos_esperados com a quantidade revisada.';
  end if;

  v_org := v_org_tx::uuid;
  v_data := v_limite::timestamptz;

  select count(*) into v_antes
    from public.lancamentos
   where organization_id = v_org
     and criado_em < v_data;

  if v_antes <> v_esperado::integer then
    raise exception 'Limpeza bloqueada: encontrei % lançamento(s), mas o esperado era %. Revise o diagnóstico.',
      v_antes, v_esperado;
  end if;
  if v_antes = 0 then
    raise exception 'Limpeza bloqueada: não há lançamentos anteriores ao corte.';
  end if;

  select count(*) into v_depois
    from public.lancamentos
   where organization_id = v_org
     and criado_em >= v_data;

  raise notice 'Corte: % · lançamentos a apagar: % · lançamentos mantidos: %',
    v_data, v_antes, v_depois;
end;
$$;

delete from public.lancamentos
 where organization_id = current_setting('acai.organization_id')::uuid
   and criado_em < current_setting('acai.limpar_ate')::timestamptz;

do $$
declare
  v_org    uuid := current_setting('acai.organization_id')::uuid;
  v_limite timestamptz := current_setting('acai.limpar_ate')::timestamptz;
  v_restam integer;
  v_depois integer;
begin
  select count(*) into v_restam
    from public.lancamentos
   where organization_id = v_org
     and criado_em < v_limite;
  select count(*) into v_depois
    from public.lancamentos
   where organization_id = v_org
     and criado_em >= v_limite;

  if v_restam > 0 then
    raise exception 'A limpeza não removeu todos os lançamentos antigos (% restantes). Rollback aplicado.', v_restam;
  end if;

  raise notice 'Limpeza financeira concluída. Lançamentos preservados: %', v_depois;
end;
$$;

-- Troque por ROLLBACK se quiser apenas simular numa transação.
commit;
