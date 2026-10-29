/**
 * Zera os dados OPERACIONAIS de uma branch comprovadamente descartável.
 *
 * Não é um comando de produção. O script:
 *   - só lê `RESET_DATABASE_URL` (nunca DATABASE_URL/VITE_NEON_URL);
 *   - exige confirmação, backup verificado e declaração de branch descartável;
 *   - recusa o host de produção por SHA-256;
 *   - preserva autenticação, usuários, papéis/permissões, configurações,
 *     empresas/filiais/depósitos base, plano de contas, catálogos e auditoria;
 *   - usa uma lista EXPLÍCITA de tabelas operacionais (sem CASCADE).
 *
 * Uso (PowerShell):
 *   $env:RESET_DATABASE_URL="postgresql://...@ep-branch-descartavel.../neondb?sslmode=require"
 *   $env:RESET_HOST="ep-branch-descartavel..."
 *   $env:RESET_CONFIRMAR="SIM"
 *   $env:RESET_BACKUP_OK="SIM"
 *   $env:RESET_BRANCH_DESCARTAVEL="SIM"
 *   npm run zerar:operacional
 *
 * Depois da zeragem, rode `npm run carregar:demonstracao` na MESMA branch.
 * Nada aqui é executado automaticamente pelo deploy.
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
const url = (process.env.RESET_DATABASE_URL || env.RESET_DATABASE_URL || '').trim()
const hostEsperado = (process.env.RESET_HOST || env.RESET_HOST || '').trim().toLowerCase()
const confirmar = (process.env.RESET_CONFIRMAR || env.RESET_CONFIRMAR || '').trim()
const backupOk = (process.env.RESET_BACKUP_OK || env.RESET_BACKUP_OK || '').trim()
const descartavel = (process.env.RESET_BRANCH_DESCARTAVEL || env.RESET_BRANCH_DESCARTAVEL || '').trim()

const HOSTS_PROIBIDOS = new Set([
  '6b0c404a7ed4578d05b8c40a912b338eec30639daebeb83cee53bba76c1321c8',
  'f6284643c82fc8ec4dfde2f2889ef34674f11058c0c12c9ec96e365d67c1ce05',
])

/**
 * Somente tabelas de movimento/cadastro operacional. O que não está aqui é
 * preservado de propósito. A lista usa nomes conhecidos: uma tabela nova exige
 * revisão consciente deste arquivo, em vez de ser apagada por um curinga.
 */
const TABELAS_OPERACIONAIS = [
  'imagens_produtos',
  'fichas_tecnicas_itens',
  'fichas_tecnicas',
  'venda_pagamentos',
  'itens_venda',
  'venda_detalhes',
  'vendas',
  'baixas_financeiras',
  'parcelas_financeiras',
  'titulos_financeiros',
  'recebimentos_compra_itens',
  'recebimentos_compra',
  'movimentacoes_estoque',
  'estoque_operacoes_locais_v2',
  'transferencias_estoque',
  'compras_itens',
  'compras',
  'devolucoes_buffet',
  'perdas_buffet',
  'fechamentos_buffet_itens',
  'fechamentos_buffet_abertura',
  'fechamentos_buffet',
  'movimentos_caixa',
  'sessoes_caixa',
  'caixas',
  'lancamentos',
  'notifications',
  'clientes',
  'fornecedores',
  'produtos',
]

const apenasHost = (valor) => {
  try {
    return new URL(valor).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const host = apenasHost(url)
const hash = (texto) => createHash('sha256').update(texto).digest('hex')

function abortar(mensagem) {
  console.error(`\n  ${mensagem}\n`)
  process.exit(1)
}

if (!url) abortar('Falta RESET_DATABASE_URL da branch descartável.')
if (!host) abortar('RESET_DATABASE_URL inválida.')
if (HOSTS_PROIBIDOS.has(hash(host))) {
  abortar('Host de PRODUÇÃO recusado. Esta rotina só roda em branch descartável.')
}
if (!hostEsperado || hostEsperado !== host) {
  abortar(
    'Confirme o host: defina RESET_HOST exatamente igual ao host da RESET_DATABASE_URL. ' +
      `Host recebido: ${host}`,
  )
}
if (confirmar !== 'SIM' || backupOk !== 'SIM' || descartavel !== 'SIM') {
  abortar(
    'Faltam confirmações. Defina RESET_CONFIRMAR=SIM, RESET_BACKUP_OK=SIM e ' +
      'RESET_BRANCH_DESCARTAVEL=SIM depois de conferir a branch e o backup.',
  )
}
if (host.includes('production') || host.includes('prod')) {
  abortar('O host parece de produção. Use a branch descartável.')
}

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})

const listaSql = TABELAS_OPERACIONAIS.map((t) => `'${t}'`).join(', ')

try {
  await client.connect()

  const meta = await client.query(`
    select current_database() as banco, current_user as usuario
  `)
  console.log('\n  Zeragem de dados operacionais')
  console.log(`  Host: ${host}`)
  console.log(`  Banco: ${meta.rows[0].banco} · usuário: ${meta.rows[0].usuario}`)

  const existentes = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [TABELAS_OPERACIONAIS],
  )
  const tabelas = existentes.rows.map((r) => r.table_name)

  if (tabelas.length === 0) {
    abortar('Nenhuma tabela operacional conhecida existe nesta branch. Confira o schema.')
  }

  const faltando = TABELAS_OPERACIONAIS.filter((t) => !tabelas.includes(t))
  if (faltando.length) {
    console.log(`  Aviso: tabelas ausentes nesta versão: ${faltando.join(', ')}`)
  }

  const antes = await client.query(`
    select
      (select count(*) from public.vendas)::int as vendas,
      (select count(*) from public.compras)::int as compras,
      (select count(*) from public.produtos)::int as produtos,
      (select count(*) from public.clientes)::int as clientes,
      (select count(*) from public.movimentacoes_estoque)::int as movimentos,
      (select count(*) from public.lancamentos)::int as lancamentos
  `)
  console.log('  Antes:', JSON.stringify(antes.rows[0]))

  await client.query('begin')
  await client.query(
    `truncate table ${tabelas.map((t) => `public."${t}"`).join(', ')} restart identity`,
  )
  await client.query('commit')

  const depois = await client.query(`
    select
      (select count(*) from public.vendas)::int as vendas,
      (select count(*) from public.compras)::int as compras,
      (select count(*) from public.produtos)::int as produtos,
      (select count(*) from public.clientes)::int as clientes,
      (select count(*) from public.movimentacoes_estoque)::int as movimentos,
      (select count(*) from public.lancamentos)::int as lancamentos,
      (select count(*) from public.profiles)::int as perfis,
      (select count(*) from public.audit_logs)::int as auditoria
  `)
  console.log('  Depois:', JSON.stringify(depois.rows[0]))
  console.log('\n  Zeragem concluída. A autenticação, as permissões e a auditoria foram preservadas.')
  console.log('  Agora rode a carga de demonstração na MESMA branch.\n')
} catch (erro) {
  await client.query('rollback').catch(() => {})
  console.error(`\n  Falhou: ${erro.message}\n`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
