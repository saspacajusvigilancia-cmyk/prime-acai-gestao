-- ============================================================================
-- Diagnóstico (SOMENTE LEITURA) - RLS, privilégios e chaves por organização
-- ============================================================================
-- Rode no SQL Editor do Neon, na branch que estiver sendo analisada.
-- Nenhum comando abaixo altera schema, dados ou permissões.
--
-- Resultado esperado depois das migrações 29, 31 e 32:
--   * nenhuma tabela pública sem RLS;
--   * as cinco tabelas internas (audit_logs, invites, invite_permissions,
--     user_permissions, estoque_operacoes_locais_v2) com RLS e sem política;
--   * zero políticas permissivas com qual/with_check = true em vendas,
--     itens_venda, clientes e lancamentos;
--   * zero privilégios diretos para o papel anonymous;
--   * unicidade de código/chave composta com organization_id.
-- ============================================================================

-- 1. Tabelas públicas que ainda estão sem RLS (o esperado é zero linhas).
select c.relname as tabela_sem_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and not c.relrowsecurity
 order by c.relname;

-- 2. Tabelas com RLS ligado e nenhuma política. As cinco listadas são
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
     'estoque_operacoes_locais_v2'
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
