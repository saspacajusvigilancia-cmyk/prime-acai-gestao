-- ============================================================================
-- Diagnóstico (SOMENTE LEITURA) - RLS, privilégios, organização e filiais
-- ============================================================================
-- Rode no SQL Editor do Neon, na branch que estiver sendo analisada.
-- Nenhum comando abaixo altera schema, dados ou permissões.
--
-- Resultado esperado depois das migrações 29, 31, 32, 36 e 37:
--   * nenhuma tabela pública sem RLS;
--   * as sete tabelas internas (audit_logs, invites, invite_permissions,
--     user_permissions, estoque_operacoes_locais_v2,
--     estoque_operacoes_idempotencia e recebimentos_compra_idempotencia) com
--     RLS e sem política;
--   * zero políticas permissivas com qual/with_check = true em vendas,
--     itens_venda, clientes e lancamentos;
--   * zero privilégios diretos para o papel anonymous;
--   * unicidade de código/chave composta com organization_id.
--
-- As consultas 10–13 são um diagnóstico, não critérios de aprovação. Enquanto
-- não existir contexto operacional e RLS por filial ponta a ponta, elas
-- devem mostrar as lacunas; não use os resultados para liberar novas filiais.
-- ============================================================================

-- 1. Tabelas públicas que ainda estão sem RLS (o esperado é zero linhas).
select c.relname as tabela_sem_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and not c.relrowsecurity
 order by c.relname;

-- 2. Tabelas com RLS ligado e nenhuma política. As sete listadas são
--    intencionais: só são acessadas por funções security definer.
select c.relname as tabela_sem_politica
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and c.relrowsecurity
   and not exists (
     select 1
       from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = c.relname
   )
 order by c.relname;

-- 3. Políticas abertas nas tabelas de negócio (o esperado é zero linhas).
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('vendas', 'itens_venda', 'clientes', 'lancamentos')
   and (qual = 'true' or with_check = 'true')
 order by tablename, policyname;

-- 4. Políticas dessas tabelas que não mencionam organization_id. O esperado é
--    zero linhas: permissão sem organização ainda vazaria dados entre lojas.
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('vendas', 'itens_venda', 'clientes', 'lancamentos')
   and not (
     coalesce(qual, '') like '%organization_id%'
     or coalesce(with_check, '') like '%organization_id%'
   )
 order by tablename, policyname;

-- 5. Privilégios diretos do papel anonymous em tabelas públicas (esperado 0).
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee = 'anonymous'
 order by table_name, privilege_type;

-- 6. DML direto de authenticated nas cinco tabelas internas (esperado 0).
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee = 'authenticated'
   and table_name in (
     'audit_logs',
     'invites',
     'invite_permissions',
     'user_permissions',
     'estoque_operacoes_locais_v2',
     'estoque_operacoes_idempotencia',
     'recebimentos_compra_idempotencia'
   )
   and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
 order by table_name, privilege_type;

-- 7. Unicidade de código de venda e de cliente. O esperado são os índices
--    compostos, sem as constraints globais antigas.
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and indexname in (
     'vendas_organizacao_codigo_idx',
     'clientes_organizacao_codigo_idx',
     'vendas_organizacao_chave_idempotencia_idx',
     'vendas_codigo_key',
     'clientes_codigo_key',
     'vendas_chave_idempotencia_idx'
   )
 order by indexname;

-- 8. Contadores internos por organização (schema private, fora do Data API).
select organization_id, recurso, valor
  from private.organization_counters
 order by recurso, organization_id;

-- 9. Conferência de dados: nenhuma venda sem organização e nenhum código
--    repetido dentro da mesma organização. O esperado é 0 / 0.
select
  (select count(*)::int from public.vendas where organization_id is null)
    as vendas_sem_organizacao,
  (select count(*)::int
     from (
       select organization_id, codigo
         from public.vendas
        group by organization_id, codigo
       having count(*) > 1
     ) x) as codigos_repetidos_na_loja;

     -- 10. Dimensões presentes nas tabelas operacionais e nos cadastros compartilhados.
     --     A ausência de filial em catálogos pode ser intencional; use esta lista
     --     junto com a regra de negócio de cada módulo, não adicione colunas em lote.
     select table_name,
            bool_or(column_name = 'organization_id') as tem_organization_id,
            bool_or(column_name = 'filial_id') as tem_filial_id
       from information_schema.columns
      where table_schema = 'public'
        and table_name in (
          'profiles', 'produtos', 'categorias_produtos', 'clientes', 'fornecedores',
          'formas_pagamento', 'compras', 'compras_itens', 'vendas', 'itens_venda',
          'venda_detalhes', 'venda_pagamentos', 'movimentacoes_estoque',
          'transferencias_estoque', 'estoque_locais', 'depositos', 'lancamentos',
          'titulos_financeiros', 'parcelas_financeiras', 'baixas_financeiras',
          'caixas', 'sessoes_caixa', 'movimentos_caixa', 'recebimentos_compra',
          'recebimentos_compra_itens', 'fichas_tecnicas', 'fichas_tecnicas_itens',
          'fechamentos_buffet', 'fechamentos_buffet_abertura',
          'fechamentos_buffet_itens', 'perdas_buffet', 'devolucoes_buffet'
        )
      group by table_name
      order by table_name;

     -- 11. Registros operacionais sem filial. Resultado diferente de zero precisa
     --     de análise de origem; não atribua automaticamente à matriz.
     select 'profiles' as tabela, count(*)::int as registros_sem_filial
       from public.profiles where filial_id is null
     union all
     select 'vendas', count(*)::int from public.vendas where filial_id is null
     union all
     select 'itens_venda', count(*)::int from public.itens_venda where filial_id is null
     union all
     select 'venda_detalhes', count(*)::int from public.venda_detalhes where filial_id is null
     union all
     select 'venda_pagamentos', count(*)::int from public.venda_pagamentos where filial_id is null
     union all
     select 'compras', count(*)::int from public.compras where filial_id is null
     union all
     select 'recebimentos_compra', count(*)::int from public.recebimentos_compra where filial_id is null
     union all
     select 'recebimentos_compra_itens', count(*)::int from public.recebimentos_compra_itens where filial_id is null
     union all
     select 'movimentacoes_estoque', count(*)::int from public.movimentacoes_estoque where filial_id is null
     union all
     select 'transferencias_estoque', count(*)::int from public.transferencias_estoque where filial_id is null
     union all
     select 'lancamentos', count(*)::int from public.lancamentos where filial_id is null
     union all
     select 'titulos_financeiros', count(*)::int from public.titulos_financeiros where filial_id is null
     union all
     select 'parcelas_financeiras', count(*)::int from public.parcelas_financeiras where filial_id is null
     union all
     select 'baixas_financeiras', count(*)::int from public.baixas_financeiras where filial_id is null
     union all
     select 'caixas', count(*)::int from public.caixas where filial_id is null
     union all
     select 'sessoes_caixa', count(*)::int from public.sessoes_caixa where filial_id is null
     union all
     select 'movimentos_caixa', count(*)::int from public.movimentos_caixa where filial_id is null
     union all
     select 'estoque_locais', count(*)::int from public.estoque_locais where filial_id is null
     union all
     select 'depositos', count(*)::int from public.depositos where filial_id is null
     union all
     select 'fichas_tecnicas', count(*)::int from public.fichas_tecnicas where filial_id is null
     order by tabela;

     -- 12. Movimentos sem filial com vínculo documental suficiente para análise.
     --     A consulta só retorna contagens; não exibe dados financeiros nem nomes.
     select count(*)::int as movimentos_sem_filial,
            count(*) filter (where m.venda_id is not null)::int as com_venda,
            count(*) filter (where m.compra_id is not null)::int as com_compra,
            count(*) filter (where m.documento_id is not null)::int as com_documento,
            count(*) filter (
              where m.venda_id is null
                and m.compra_id is null
                and m.documento_id is null
            )::int as sem_vinculo_documental,
            count(*) filter (
              where v.id is not null
                and v.organization_id = m.organization_id
                and v.filial_id is not null
            )::int as filial_comprovada_pela_venda
       from public.movimentacoes_estoque m
       left join public.vendas v on v.id = m.venda_id
      where m.filial_id is null;

     -- 13. Políticas existentes que não mencionam filial. Depois da migration
     --     38, interprete-as junto com a política restritiva
     --     isolamento_filial_ativo; esta consulta sozinha nao prova isolamento.
     select tablename, policyname, cmd
       from pg_policies
      where schemaname = 'public'
        and tablename in (
          'vendas', 'itens_venda', 'venda_detalhes', 'venda_pagamentos', 'compras',
          'recebimentos_compra', 'recebimentos_compra_itens',
          'movimentacoes_estoque', 'transferencias_estoque', 'estoque_locais',
          'depositos', 'lancamentos', 'titulos_financeiros', 'parcelas_financeiras',
          'baixas_financeiras', 'caixas', 'sessoes_caixa', 'movimentos_caixa'
        )
        and coalesce(qual, '') !~* 'filial_id'
        and coalesce(with_check, '') !~* 'filial_id'
      order by tablename, policyname;

     -- 14. Inventario individual dos movimentos historicos ainda sem filial.
     --     Classificacao e apenas evidencia: nenhuma linha e atualizada.
     select m.id as movimentacao_id,
            m.criado_em,
            m.organization_id,
            m.produto_id,
            p.nome as produto,
            m.quantidade,
            m.origem,
            m.destino,
            m.motivo,
            m.venda_id,
            v.codigo as venda_codigo,
            v.filial_id as venda_filial_id,
            fv.nome as venda_filial,
            m.item_venda_id,
            m.compra_id,
            c.filial_id as compra_filial_id,
            fc.nome as compra_filial,
            m.compra_item_id,
            m.recebimento_compra_id,
            m.recebimento_item_id,
            m.documento_tipo,
            m.documento_id,
            case
              when v.id is not null and v.organization_id = m.organization_id
                   and v.filial_id is not null
                then 'EVIDENCIA_PELA_VENDA; requer aprovacao administrativa'
              when c.id is not null and c.organization_id = m.organization_id
                   and c.filial_id is not null
                then 'EVIDENCIA_PELA_COMPRA; requer aprovacao administrativa'
              else 'SEM_VINCULO_DOCUMENTAL_COM_FILIAL; manter sem atribuicao'
            end as classificacao_provisoria
       from public.movimentacoes_estoque m
       join public.produtos p on p.id = m.produto_id
       left join public.vendas v
         on v.id = m.venda_id
        and v.organization_id = m.organization_id
       left join public.filiais fv
         on fv.id = v.filial_id
        and fv.organization_id = v.organization_id
       left join public.compras c
         on c.id = m.compra_id
        and c.organization_id = m.organization_id
       left join public.filiais fc
         on fc.id = c.filial_id
        and fc.organization_id = c.organization_id
      where m.filial_id is null
      order by m.criado_em, m.id;

     -- 15. Perfis e filiacao atual. A filial do perfil e o contexto selecionado;
     --     a lista de acessos explicitos passa a existir na migration 38.
     --     Nao atribua filial por papel, organizacao ou e-mail.
     select p.id as usuario_id,
            p.full_name,
            p.email,
            p.role,
            p.is_active,
            p.organization_id,
            o.nome as organizacao,
            p.filial_id,
            f.nome as filial_atual
       from public.profiles p
       left join public.organizations o on o.id = p.organization_id
       left join public.filiais f
         on f.id = p.filial_id
        and f.organization_id = p.organization_id
      order by o.nome, p.full_name, p.id;

     -- 16. Inventario de funcoes SECURITY DEFINER. E necessario revisar a
     --     definicao completa de cada funcao antes de liberar o isolamento.
     select n.nspname as esquema,
            p.proname as funcao,
            pg_get_function_identity_arguments(p.oid) as argumentos,
            pg_get_userbyid(p.proowner) as proprietario,
            coalesce((
              select regexp_replace(config, '^search_path=', '')
                from unnest(p.proconfig) as config
               where config like 'search_path=%'
               limit 1
            ), '(padrao do banco)') as search_path,
            has_function_privilege('authenticated', p.oid, 'EXECUTE')
              as authenticated_pode_executar,
            exists (
              select 1
                from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
               where acl.grantee = 0
                 and acl.privilege_type = 'EXECUTE'
            ) as public_pode_executar,
            p.prosrc ilike '%filial_id%' as menciona_filial,
            p.prosrc ilike '%minha_organizacao%' as menciona_organizacao,
            p.prosrc ilike '%public.pode(%' as menciona_permissao
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and p.prosecdef
      order by p.proname, pg_get_function_identity_arguments(p.oid);

     -- 17. Politica restritiva por filial instalada nas tabelas que possuem
     --     filial_id. Resultado diferente de zero precisa de revisao antes
     --     de habilitar operacao multifilial.
     select c.relname as tabela_sem_isolamento_restritivo
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a
         on a.attrelid = c.oid
        and a.attname = 'filial_id'
        and not a.attisdropped
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity
        and c.relname not in ('profiles', 'acessos_filiais')
        and not exists (
          select 1
            from pg_policies pol
           where pol.schemaname = 'public'
             and pol.tablename = c.relname
             and pol.permissive = 'RESTRICTIVE'
             and pol.policyname = 'isolamento_filial_ativo'
             and coalesce(pol.qual, '') ilike '%filial_ativa%'
             and coalesce(pol.with_check, '') ilike '%filial_ativa%'
        )
      order by c.relname;
