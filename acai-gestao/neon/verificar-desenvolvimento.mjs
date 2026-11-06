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
  console.error(`\n  Verificação bloqueada antes da conexão: ${erro.message}\n`)
  process.exit(1)
}

const nomes = readdirSync(pasta)
  .filter((nome) => /^\d+_.*\.sql$/i.test(nome))
  .filter((nome) => nome !== arquivoDadosEstudo)
  .sort()
nomes.push('garantir_perfil_novo.sql')

const client = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED })
const falhas = []

try {
  await client.connect()
  await client.query('begin read only')
  console.log(`\n  Branch de desenvolvimento validada: ${endpointId}.`)

  const historicoExiste = await client.query(
    `select to_regclass('app_private.schema_migrations') is not null as existe`,
  )
  if (!historicoExiste.rows[0].existe) {
    falhas.push('histórico de migrations ausente; execute npm run db:migrate')
  } else {
    const historico = await client.query(
      'select filename, sha256 from app_private.schema_migrations order by filename',
    )
    const aplicadas = new Map(historico.rows.map((linha) => [linha.filename, linha.sha256]))
    const pendentes = []
    const divergentes = []

    for (const nome of nomes) {
      const sql = readFileSync(join(pasta, nome), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      if (!aplicadas.has(nome)) pendentes.push(nome)
      else if (aplicadas.get(nome) !== checksum) divergentes.push(nome)
    }

    if (pendentes.length) falhas.push(`migrations pendentes: ${pendentes.join(', ')}`)
    if (divergentes.length) falhas.push(`checksums divergentes: ${divergentes.join(', ')}`)
    if (!pendentes.length && !divergentes.length) {
      console.log(`  OK ${nomes.length} migrations aplicadas e sem drift de checksum.`)
    }
  }

  const tabelas = await client.query(`
    select c.relname as nome,
           c.relrowsecurity as rls_habilitado,
           exists (
             select 1
               from pg_attribute a
              where a.attrelid = c.oid
                and a.attname = 'filial_id'
                and a.attnum > 0
                and not a.attisdropped
           ) as tem_filial,
           exists (
             select 1
               from pg_policies p
              where p.schemaname = 'public'
                and p.tablename = c.relname
                and p.policyname = 'isolamento_filial_ativo'
                and p.permissive = 'RESTRICTIVE'
                and p.roles @> array['authenticated']::name[]
                and lower(coalesce(p.qual, '')) like '%filial_ativa%'
                and lower(coalesce(p.with_check, '')) like '%filial_ativa%'
                and (
                  not exists (
                    select 1
                      from pg_attribute a
                     where a.attrelid = c.oid
                       and a.attname = 'organization_id'
                       and a.attnum > 0
                       and not a.attisdropped
                  )
                  or (
                    lower(coalesce(p.qual, '')) like '%minha_organizacao%'
                    and lower(coalesce(p.with_check, '')) like '%minha_organizacao%'
                  )
                )
           ) as isolamento_filial
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname not in ('profiles', 'acessos_filiais')
       and exists (
         select 1
           from pg_attribute a
          where a.attrelid = c.oid
            and a.attnum > 0
            and not a.attisdropped
            and a.attname in ('organization_id', 'filial_id')
       )
     order by c.relname
  `)
  const semRls = tabelas.rows.filter((tabela) => !tabela.rls_habilitado).map((tabela) => tabela.nome)
  const semFilial = tabelas.rows
    .filter((tabela) => tabela.tem_filial && !tabela.isolamento_filial)
    .map((tabela) => tabela.nome)
  if (semRls.length) falhas.push(`RLS desabilitado em: ${semRls.join(', ')}`)
  if (semFilial.length) falhas.push(`isolamento por filial incompleto em: ${semFilial.join(', ')}`)
  if (!semRls.length && !semFilial.length && tabelas.rowCount) {
    console.log(`  OK RLS ativo e isolamento por filial verificado em ${tabelas.rowCount} tabelas.`)
  }

  const contagens = await client.query(`
    select (select count(*) from public.organizations) as organizacoes,
           (select count(*) from public.profiles) as perfis,
           (select count(*) from public.produtos) as produtos,
           (select count(*) from public.vendas) as vendas
  `)
  const linhas = contagens.rows[0]
  console.log(
    `  Estado persistido: organizações=${linhas.organizacoes}, perfis=${linhas.perfis}, produtos=${linhas.produtos}, vendas=${linhas.vendas}.`,
  )
  await client.query('commit')
} catch (erro) {
  await client.query('rollback').catch(() => {})
  falhas.push(`consulta de verificação falhou: ${erro.message}`)
} finally {
  await client.end().catch((erro) => {
    falhas.push(`falha ao encerrar a conexão do banco: ${erro.message}`)
  })
}

if (falhas.length) {
  console.error('\n  Verificação falhou:')
  for (const falha of falhas) console.error(`  - ${falha}`)
  console.error('\n')
  process.exit(1)
}
console.log('\n  Verificação do banco de desenvolvimento aprovada.\n')
