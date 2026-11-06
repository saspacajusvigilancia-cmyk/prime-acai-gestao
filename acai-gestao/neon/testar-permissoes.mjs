/**
 * Teste E2E do módulo de permissões — pelo caminho REAL do navegador.
 *
 * O Managed Better Auth guarda a sessão num cookie opaco e devolve o JWT no
 * header `set-auth-jwt` da resposta de `get-session`. É esse JWT que o SDK manda
 * no `Authorization` para o Data API. Este script replica exatamente isso:
 *
 *   1. cadastra um usuário descartável (signup) e guarda o cookie;
 *   2. chama `get-session` e lê o JWT do header `set-auth-jwt`;
 *   3. confirma a negação padrão do perfil inativo e sem filial;
 *   4. prepara uma filial para o usuário descartável via DATABASE_URL;
 *   5. usa o JWT no Data API para conferir permissões positivas e negativas.
 *
 * A escrita privilegiada é somente preparação da fixture sintética e não
 * comprova o fluxo administrativo da aplicação.
 *
 * Uso:
 *   node neon/testar-permissoes.mjs
 *
 * Somente o UID sintético é impresso (para apagar com
 * `neon neon-auth user delete <user-id>`).
 */

import { carregarAmbiente, exigirDestinoSintetico } from './ambiente-teste.js'
import pg from 'pg'

function derivar(base) {
  const url = new URL(base)
  const [primeiro, ...resto] = url.hostname.split('.')
  const porta = url.port ? `:${url.port}` : ''
  const caminho = url.pathname.replace(/\/+$/, '')
  return {
    auth: `${url.protocol}//${[primeiro, 'neonauth', ...resto].join('.')}${porta}${caminho}/auth`,
    data: `${url.protocol}//${[primeiro, 'apirest', ...resto].join('.')}${porta}${caminho}/rest/v1`,
  }
}

const env = carregarAmbiente('test')
if (!env.VITE_NEON_URL) {
  throw new Error('Teste de permissões bloqueado: configure o endpoint sintético.')
}
exigirDestinoSintetico(env)

const ORIGEM = env.VITE_APP_URL || 'http://localhost:5173'
const { auth: authBase, data: dataBase } = derivar(env.VITE_NEON_URL)

let falhas = 0
const ok = (rotulo, cond, detalhe = '') => {
  if (!cond) falhas++
  console.log(`  ${cond ? 'OK   ' : 'FALHA'} ${rotulo.padEnd(46)} ${detalhe}`)
}

const stamp = Date.now()
const email = `e2e.${stamp}@primeacai.local`
const senha = `Teste!${stamp}`

console.log('\nAmbiente sintético autorizado; iniciando teste autenticado de permissões.')

const H = { 'Content-Type': 'application/json', Origin: ORIGEM }

// 1) cadastro + cookie de sessão
const sign = await fetch(`${authBase}/sign-up/email`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ email, password: senha, name: 'E2E Permissões', callbackURL: `${ORIGEM}/` }),
})
const signJson = await sign.json().catch(() => null)
ok('sign-up', sign.ok, `HTTP ${sign.status} ${signJson?.message ?? ''}`)
const uid = signJson?.user?.id
if (!sign.ok || !uid) throw new Error(`Teste interrompido: signup não criou usuário sintético (HTTP ${sign.status}).`)
console.log(`  UID=${uid}`)
const cookie = (sign.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')

// 2) JWT do header set-auth-jwt
const sess = await fetch(`${authBase}/get-session`, { headers: { Origin: ORIGEM, cookie } })
const jwt = sess.headers.get('set-auth-jwt')
ok('get-session devolve set-auth-jwt', Boolean(jwt && jwt.split('.').length === 3), jwt ? 'JWT recebido (redigido)' : 'sem JWT')
if (!jwt) { console.log('\n  Sem JWT; abortando.\n'); process.exit(1) }
const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
ok('subject do JWT corresponde à conta', claims.sub === uid, claims.sub === uid ? 'correspondente' : 'divergente')
if (claims.sub !== uid) throw new Error('Teste interrompido: subject do JWT não corresponde ao usuário criado.')

const req = async (caminho, init = {}) => {
  const r = await fetch(dataBase + caminho, { ...init, headers: { Authorization: `Bearer ${jwt}`, ...(init.headers || {}) } })
  const texto = await r.text()
  let json = null
  try { json = JSON.parse(texto) } catch { /* vazio */ }
  return { status: r.status, json, texto }
}
const rpc = (fn, body = {}) =>
  req(`/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

async function concederFilialSintetica(uid) {
  const db = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  })
  await db.connect()
  try {
    await db.query('begin')
    const filial = await db.query(`
      select p.organization_id, f.id as filial_id
        from public.profiles p
        join public.filiais f
          on f.organization_id = p.organization_id
         and f.ativo
       where p.id = $1
       order by f.numero, f.id
       limit 1
    `, [uid])
    if (!filial.rowCount) {
      throw new Error('Teste sintético sem filial ativa na organização do usuário.')
    }

    const { organization_id: organizationId, filial_id: filialId } = filial.rows[0]
    const ativacao = await db.query(
      'update public.profiles set is_active = true where id = $1',
      [uid],
    )
    if (ativacao.rowCount !== 1) {
      throw new Error('Teste sintético não encontrou o perfil a ser ativado.')
    }
    await db.query(`
      insert into public.acessos_filiais (
        organization_id, filial_id, usuario_id, ativo
      ) values ($1, $2, $3, true)
      on conflict (usuario_id, filial_id)
      do update set ativo = true, atualizado_em = now()
    `, [organizationId, filialId, uid])
    await db.query('commit')
    return filialId
  } catch (error) {
    await db.query('rollback')
    throw error
  } finally {
    await db.end()
  }
}

// 3) cria o perfil (como o app faz ao abrir)
console.log('\n1) Sessão e perfil')
const perfil = await rpc('garantir_perfil')
ok('garantir_perfil() cria o perfil', perfil.status === 200, `HTTP ${perfil.status} ${String(perfil.texto).slice(0, 80)}`)
ok('perfil nasceu como cashier', perfil.json?.role === 'cashier', `role=${perfil.json?.role}`)
ok('perfil corresponde ao subject autenticado', perfil.json?.id === claims.sub, perfil.json?.id === claims.sub ? 'correspondente' : 'divergente')
const meuPerfil = await rpc('meu_perfil')
ok('meu_perfil() encontra a conta autenticada', meuPerfil.status === 200 && meuPerfil.json?.id === claims.sub, `HTTP ${meuPerfil.status} · ${meuPerfil.json?.role ?? 'sem perfil'}`)
ok('perfil novo aguarda aprovação', meuPerfil.status === 200 && meuPerfil.json?.is_active === false, `ativo=${meuPerfil.json?.is_active}`)

// 4) permissões efetivas do caixa
console.log('\n2) Permissões do operador de caixa')
const filiais = await rpc('minhas_filiais_autorizadas')
ok('operador sem filial autorizada', filiais.status === 200 && Array.isArray(filiais.json) && filiais.json.length === 0, `HTTP ${filiais.status} · ${(filiais.json || []).length} filial(is)`)
const selecaoNaoAutorizada = await rpc('selecionar_filial', { p_filial_id: crypto.randomUUID() })
ok('não seleciona filial não autorizada', selecaoNaoAutorizada.status >= 400, `HTTP ${selecaoNaoAutorizada.status}`)
const minhas = await rpc('minhas_permissoes')
const lista = Array.isArray(minhas.json) ? minhas.json.map((x) => `${x.modulo}.${x.acao}`) : []
ok('minhas_permissoes() sem filial não concede acesso', minhas.status === 200 && lista.length === 0, `HTTP ${minhas.status} · ${lista.length} permissões efetivas`)
ok('NÃO tem financeiro', !lista.some((m) => m.startsWith('financeiro.')), lista.filter((m) => m.startsWith('financeiro')).join(',') || 'nenhuma')
ok('NÃO tem usuarios', !lista.some((m) => m.startsWith('usuarios.')), '')
ok('NÃO tem permissoes', !lista.some((m) => m.startsWith('permissoes.')), '')

// 5) pode() pelo servidor
console.log('\n3) pode() pelo servidor')
const p1 = await rpc('pode', { p_modulo: 'vendas', p_acao: 'criar' })
const p2 = await rpc('pode', { p_modulo: 'financeiro', p_acao: 'ver' })
ok('bloqueia vendas sem filial ativa', p1.json === false, JSON.stringify(p1.json))
ok('pode(financeiro,ver) = false', p2.json === false, JSON.stringify(p2.json))

// O SQL privilegiado só prepara o acesso sintético; a seleção e as permissões
// são verificadas em seguida pelo JWT descartável através da Data API.
console.log('\n4) Acesso autorizado à filial sintética')
const filialId = await concederFilialSintetica(uid)
const selecionar = await rpc('selecionar_filial', { p_filial_id: filialId })
ok('seleciona filial autorizada', selecionar.status === 200 && selecionar.json?.id === filialId, `HTTP ${selecionar.status}`)
const filiaisAposSelecao = await rpc('minhas_filiais_autorizadas')
ok('filial autorizada aparece como atual', filiaisAposSelecao.status === 200 && filiaisAposSelecao.json?.some((f) => f.id === filialId && f.atual), `HTTP ${filiaisAposSelecao.status}`)
const minhasAposSelecao = await rpc('minhas_permissoes')
const listaAposSelecao = Array.isArray(minhasAposSelecao.json) ? minhasAposSelecao.json.map((x) => `${x.modulo}.${x.acao}`) : []
ok('permissões operacionais após seleção', minhasAposSelecao.status === 200 && listaAposSelecao.includes('vendas.criar') && listaAposSelecao.includes('dashboard.ver'), `HTTP ${minhasAposSelecao.status} · ${listaAposSelecao.length} permissões`)
const podeVender = await rpc('pode', { p_modulo: 'vendas', p_acao: 'criar' })
ok('pode(vendas,criar) com filial autorizada', podeVender.json === true, JSON.stringify(podeVender.json))

// 6) catálogo liberado, dados sensíveis bloqueados
console.log('\n5) Leitura direta')
const roles = await req('/roles?select=name&order=name')
ok('lê o catálogo de perfis', roles.status === 200 && (roles.json || []).length === 3, `HTTP ${roles.status}`)
const roleCatalog = await req('/roles?select=id,name')
const rolePermissions = await req('/role_permissions?select=role_id,permission_id')
const permissionCatalog = await req('/permissions?select=id,module_key,action_key')
const cashierId = roleCatalog.json?.find((role) => role.name === 'cashier')?.id
const cashierPermissionIds = new Set((rolePermissions.json || []).filter((row) => row.role_id === cashierId).map((row) => row.permission_id))
const cashierPermissionKeys = (permissionCatalog.json || [])
  .filter((permission) => cashierPermissionIds.has(permission.id))
  .map((permission) => `${permission.module_key}.${permission.action_key}`)
ok('catálogo de permissões de perfil legível', roleCatalog.status === 200 && rolePermissions.status === 200 && permissionCatalog.status === 200, `HTTP ${rolePermissions.status}/${permissionCatalog.status} · ${cashierPermissionKeys.length} permissões de cashier`)
ok('catálogo concede vendas.criar ao cashier', cashierPermissionKeys.includes('vendas.criar'), cashierPermissionKeys.includes('vendas.criar') ? 'presente' : 'ausente')
const up = await req('/user_permissions?select=*')
ok('NÃO lê user_permissions', up.status !== 200, `HTTP ${up.status}`)
const inv = await req('/invites?select=*')
ok('NÃO lê invites', inv.status !== 200, `HTTP ${inv.status}`)
const aud = await req('/audit_logs?select=*')
ok('NÃO lê audit_logs', aud.status !== 200, `HTTP ${aud.status}`)

// 7) escrita direta proibida
console.log('\n6) Escrita direta proibida')
const ins = await req('/permissions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ module_key: 'hack', action_key: 'x' }) })
ok('NÃO insere em permissions', ins.status >= 400, `HTTP ${ins.status}`)

// 8) RPCs administrativas negadas ao caixa
console.log('\n7) Administração bloqueada')
const conv = await rpc('convidar_usuario', { p_email: 'x@y.com', p_nome: 'X', p_role: 'admin' })
ok('convidar_usuario bloqueado', conv.status >= 400, `HTTP ${conv.status} ${conv.json?.message?.slice(0, 50) ?? ''}`)
const lst = await rpc('listar_usuarios')
ok('listar_usuarios bloqueado', lst.status >= 400, `HTTP ${lst.status}`)
const dp = await rpc('definir_permissao_usuario', { alvo: uid, p_modulo: 'usuarios', p_acao: 'ver', p_permitido: true })
ok('definir_permissao_usuario bloqueado', dp.status >= 400, `HTTP ${dp.status}`)

// 9) RLS: só o próprio perfil
console.log('\n8) RLS')
const pr = await req('/profiles?select=id,role,is_active&order=created_at')
ok('só vê o próprio perfil', pr.status === 200 && (pr.json || []).length === 1, `HTTP ${pr.status} · ${(pr.json || []).length} linha(s)`)

console.log(falhas === 0 ? '\n  Tudo certo.\n' : `\n  ${falhas} falha(s).\n`)
process.exit(falhas === 0 ? 0 : 1)
