/**
 * Carga da base fictícia de demonstração em uma branch DESCARTÁVEL.
 *
 * Esta rotina NÃO é um reset e NÃO roda no deploy. Ela:
 *   - só lê `DEMO_DATABASE_URL` (nunca `DATABASE_URL`/`VITE_NEON_URL`);
 *   - exige `DEMO_CONFIRMAR=SIM`;
 *   - recusa o host de produção por SHA-256;
 *   - exige uma organização, um admin ativo e ZERO vendas/compras;
 *   - chama `public.demo_carregar()` dentro de uma transação, com o token e a
 *     trava `app.demo_isolada=true`.
 *
 * Uso (PowerShell):
 *   $env:DEMO_DATABASE_URL="postgresql://...@ep-branch-descartavel.../neondb?sslmode=require"
 *   $env:DEMO_CONFIRMAR="SIM"
 *   npm run carregar:demonstracao
 *
 * A senha da URL é segredo: não comite, não cole em issue e não use a URL da
 * produção. Para descartar a demonstração, descarte a branch inteira; não há
 * promessa de limpeza seletiva (movimentos de estoque são imutáveis).
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

function lerEnv() {
  try {
    const texto = readFileSync(join(raiz, '.env'), 'utf8')
    const env = {}
    for (const linha of texto.split(/\r?\n/)) {
      if (linha.trim().startsWith('#')) continue
      const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    return env
  } catch {
    return {}
  }
}

const env = lerEnv()
const url = (process.env.DEMO_DATABASE_URL || env.DEMO_DATABASE_URL || '').trim()
const confirmacao = (process.env.DEMO_CONFIRMAR || env.DEMO_CONFIRMAR || '').trim()

/**
 * SHA-256 do host de produção. Mantemos o hash, não o host, para que este
 * arquivo não vire uma pista de infraestrutura. Inclui a variação pooled.
 */
const HOSTS_PROIBIDOS = new Set([
  '6b0c404a7ed4578d05b8c40a912b338eec30639daebeb83cee53bba76c1321c8', // produção
  'f6284643c82fc8ec4dfde2f2889ef34674f11058c0c12c9ec96e365d67c1ce05', // produção pooled
])

const TOKEN_DEMO = 'PRIME-ACAI-DEMO-2026'

const apenasHost = (valor) => {
  try {
    return new URL(valor).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const hash = (texto) => createHash('sha256').update(texto).digest('hex')

function abortar(mensagem) {
  console.error(`\n  ${mensagem}\n`)
  process.exit(1)
}

if (!url) {
  abortar(
    'Falta DEMO_DATABASE_URL. Use a conexão direta de uma branch NOVA e descartável;\n' +
      '  este script não aceita DATABASE_URL para não confundir com produção.',
  )
}

if (confirmacao !== 'SIM') {
  abortar('Confirmação ausente. Defina DEMO_CONFIRMAR=SIM somente depois de conferir a branch.')
}

const host = apenasHost(url)
if (!host) {
  abortar('DEMO_DATABASE_URL inválida.')
}

if (HOSTS_PROIBIDOS.has(hash(host))) {
  abortar('Host de PRODUÇÃO recusado. Crie uma branch descartável e use o host dela.')
}

if (host.includes('production') || host.includes('prod')) {
  abortar('O host parece ser de produção. Use uma branch explicitamente descartável.')
}

console.log('\n  Demonstração protegida')
console.log(`  Host: ${host}`)
console.log('  A carga só será aceita se a base tiver zero vendas e zero compras.\n')

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()

  const versao = await client.query(
    "select current_database() as banco, current_user as usuario, to_regclass('public.demo_carregar') as funcao",
  )
  const { banco, usuario, funcao } = versao.rows[0]
  console.log(`  Banco: ${banco} · usuário: ${usuario}`)

  if (!funcao) {
    abortar('A função public.demo_carregar() não existe. Aplique a migração 34 nesta branch antes.')
  }

  const orgs = await client.query('select id, nome from public.organizations order by criado_em')
  if (orgs.rowCount !== 1) {
    abortar(
      `Esperava exatamente 1 organização na branch descartável, encontrei ${orgs.rowCount}. ` +
        'Não prossiga sem conferir o ambiente.',
    )
  }

  const org = orgs.rows[0]
  const contagens = await client.query(`
    select
      (select count(*) from public.vendas where organization_id = $1)::int as vendas,
      (select count(*) from public.compras where organization_id = $1)::int as compras,
      (select count(*) from public.profiles where organization_id = $1 and is_active and role = 'admin')::int as admins
  `, [org.id])

  const { vendas, compras, admins } = contagens.rows[0]
  console.log(`  Organização: ${org.nome}`)
  console.log(`  Vendas: ${vendas} · compras: ${compras} · admins ativos: ${admins}`)

  if (vendas !== 0 || compras !== 0) {
    abortar(
      'A branch não está vazia. Esta carga NÃO apaga dados. ' +
        'Crie uma branch nova, aplique o schema e rode de novo.',
    )
  }

  if (admins < 1) {
    abortar('Não há administrador ativo nesta branch. A carga exige um admin autenticado.')
  }

  const admin = await client.query(`
    select id, full_name
      from public.profiles
     where organization_id = $1
       and is_active
       and role = 'admin'
     order by criado_em
     limit 1
  `, [org.id])

  const adminId = admin.rows[0].id

  await client.query('begin')
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: adminId, role: 'authenticated' }),
  ])
  await client.query("select set_config('app.demo_isolada', 'true', true)")

  const resultado = await client.query('select public.demo_carregar($1) as resultado', [TOKEN_DEMO])
  await client.query('commit')

  console.log('\n  Carga concluída:')
  console.log(JSON.stringify(resultado.rows[0].resultado, null, 2))
  console.log('\n  Lembrete: os dados são FICTÍCIOS. Descarte a branch inteira ao terminar.\n')
} catch (erro) {
  await client.query('rollback').catch(() => {})
  console.error(`\n  Falhou: ${erro.message}\n`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
