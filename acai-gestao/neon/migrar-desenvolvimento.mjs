import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { carregarAmbiente, exigirDestinoDesenvolvimento } from './ambiente-teste.js'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const pasta = join(raiz, 'neon')
const arquivoDadosEstudo = '12_vendas_17_19_out.sql'
const env = carregarAmbiente('development')

let endpointId
try {
  endpointId = exigirDestinoDesenvolvimento(env)
} catch (erro) {
  console.error(`\n  Migrations bloqueadas antes da conexão: ${erro.message}\n`)
  process.exit(1)
}

const nomes = readdirSync(pasta)
  .filter((nome) => /^\d+_.*\.sql$/i.test(nome))
  .filter((nome) => nome !== arquivoDadosEstudo)
  .sort()
nomes.push('garantir_perfil_novo.sql')

const client = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED })
let falhou = false

try {
  await client.connect()
  await client.query('create schema if not exists app_private')
  await client.query('revoke all on schema app_private from public')
  await client.query(`
    create table if not exists app_private.schema_migrations (
      filename text primary key,
      sha256 text not null,
      applied_at timestamptz not null default now()
    )
  `)
  await client.query('revoke all on app_private.schema_migrations from public')

  console.log(`\n  Branch de desenvolvimento validada: ${endpointId}.`)
  console.log(`  Migrations versionadas: ${nomes.length}; seed de estudo 12 excluído.\n`)

  for (const nome of nomes) {
    const sql = readFileSync(join(pasta, nome), 'utf8')
    const sha256 = createHash('sha256').update(sql).digest('hex')
    const existente = await client.query(
      'select sha256 from app_private.schema_migrations where filename = $1',
      [nome],
    )

    if (existente.rowCount) {
      if (existente.rows[0].sha256 !== sha256) {
        throw new Error(`Checksum divergente para ${nome}; nenhuma reexecução foi feita.`)
      }
      console.log(`  ignorada ${nome} (já aplicada e íntegra)`)
      continue
    }

    process.stdout.write(`  aplicando ${nome} ... `)
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query(
        'insert into app_private.schema_migrations (filename, sha256) values ($1, $2)',
        [nome, sha256],
      )
      await client.query('commit')
      console.log('OK')
    } catch (erro) {
      await client.query('rollback')
      console.log('FALHA')
      throw new Error(`Migration ${nome} falhou: ${erro.message}`, { cause: erro })
    }
  }
} catch (erro) {
  falhou = true
  console.error(`\n  Migrations interrompidas: ${erro.message}\n`)
} finally {
  await client.end().catch((erro) => {
    if (!falhou) {
      falhou = true
      console.error(`\n  Falha ao encerrar a conexão do banco: ${erro.message}\n`)
    }
  })
}

if (falhou) process.exit(1)
console.log('\n  Migrations de desenvolvimento concluídas com histórico e checksum.\n')
