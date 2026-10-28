-- ============================================================================
-- 31 · RPC de permissões por perfil + índices das FKs compostas restantes
-- ============================================================================
-- Esta migração fecha duas lacunas encontradas na auditoria de 28/10/2026:
--
-- 1. `public.definir_permissao_perfil(text, text, text, boolean)` existia no
--    banco de produção, mas não em nenhuma migração. Num banco criado do zero
--    pela cadeia `neon/*.sql` a tela Configurações → Permissões falhava em
--    todo clique (a RPC não existia). A definição abaixo é a que já roda em
--    produção, agora versionada e idempotente.
--
--    A função é `security definer` com `search_path = ''`, exige
--    `public.eh_admin()`, recusa alterar o perfil `admin`, valida perfil e
--    permissão no catálogo e registra a mudança em `audit_logs`. Nada é
--    concedido a `anon`: só `authenticated` executa.
--
-- 2. Duas chaves estrangeiras compostas continuavam sem índice no lado filho
--    (`tipos_venda` e `movimentacoes_estoque`). A migração 30 cobriu as
--    colunas simples; estas duas exigem índice na ordem exata da FK.
--
-- Reversão: `reverter_31_permissoes_perfil_e_indices_compostos.sql`.

-- --------------------------------------------------------- 1. RPC ----------
create or replace function public.definir_permissao_perfil(
  p_role text,
  p_modulo text,
  p_acao text,
  p_permitido boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_perm_id uuid;
begin
  if not public.eh_admin() then
    raise exception 'Apenas administradores podem alterar permissoes de perfis.' using errcode = '42501';
  end if;
  if p_role = 'admin' then
    raise exception 'O perfil administrador nao pode ser alterado.' using errcode = '42501';
  end if;
  select id into v_role_id from public.roles where name = p_role;
  if v_role_id is null then
    raise exception 'Perfil invalido: %', p_role using errcode = '22023';
  end if;
  select id into v_perm_id from public.permissions where module_key = p_modulo and action_key = p_acao;
  if v_perm_id is null then
    raise exception 'Permissao inexistente: %.%', p_modulo, p_acao using errcode = 'P0002';
  end if;
  if p_permitido then
    insert into public.role_permissions (role_id, permission_id) values (v_role_id, v_perm_id)
    on conflict do nothing;
  else
    delete from public.role_permissions where role_id = v_role_id and permission_id = v_perm_id;
  end if;
  insert into public.audit_logs (organization_id, actor_user_id, target_user_id, action, details)
  values (public.minha_organizacao(), (select auth.uid()), null, 'permissao_perfil_alterada',
          jsonb_build_object('role', p_role, 'modulo', p_modulo, 'acao', p_acao, 'permitido', p_permitido));
end;
$$;

-- `from public` cobre o EXECUTE padrão concedido a todos; depois só o papel
-- autenticado recebe. (O Neon tem o papel `anon`, o harness local não; revogar
-- de PUBLIC é equivalente e funciona nos dois.)
revoke all on function public.definir_permissao_perfil(text, text, text, boolean) from public;
grant execute on function public.definir_permissao_perfil(text, text, text, boolean) to authenticated;

comment on function public.definir_permissao_perfil(text, text, text, boolean) is
  'Concede ou remove uma permissão de um perfil. Exige administrador e audita a alteração.';

-- ------------------------------------------- 2. índices das FKs compostas --
create index if not exists tipos_venda_categoria_org_idx
  on public.tipos_venda (organization_id, categoria);

create index if not exists movimentacoes_estoque_produto_organizacao_idx
  on public.movimentacoes_estoque (organization_id, produto_id);

notify pgrst, 'reload schema';
