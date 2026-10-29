/**
 * Teste da carga de demonstração protegida (migrações 33 e 34).
 *
 * Roda em PGlite, aplica a cadeia `neon/NN_*.sql` inteira e prova, sem tocar
 * em nenhum banco real:
 *   - as travas de token, `app.demo_isolada` e administrador;
 *   - a carga completa (empresas, filiais, depósitos, compras, recebimentos,
 *     contas a pagar/receber, baixas, vendas, caixa e ficha técnica);
 *   - a idempotência de uma segunda chamada;
 *   - as regras de consistência da seção 8 do pedido de reestruturação.
 *
 * Uso: npm run testar:demonstracao
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const PASTA = join(dirname(fileURLToPath(import.meta.url)))
const ADMIN = 'a0000000-0000-4000-8000-000000000001'
const TOKEN = 'PRIME-ACAI-DEMO-2026'

let falhas = 0

function ok(nome, condicao, detalhe = '') {
  console.log(`  ${condicao ? 'ok    ' : 'FALHOU'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`)
  if (!condicao) falhas += 1
}

function titulo(texto) {
  console.log(`\n== ${texto} ==`)
}

const db = new PGlite()

await db.exec(`
  create role anonymous;
  create role authenticated;
  create schema if not exists auth;
  create schema if not exists neon_auth;
  create table if not exists neon_auth.user (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  $$;
`)

const dispensar = (sql) => sql.replace(/create extension if not exists "pgcrypto";/i, '-- pgcrypto')
for (const nome of readdirSync(PASTA).filter((n) => /^\d+_.*\.sql$/i.test(n)).sort()) {
  await db.exec('begin')
  await db.exec(dispensar(readFileSync(join(PASTA, nome), 'utf8')))
  await db.exec('commit')
}
console.log('  Migrações aplicadas.')

// Base vazia, mas com o usuário de autenticação e o administrador preservados.
const tabelas = [
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
await db.exec(`truncate table ${tabelas.map((t) => `public."${t}"`).join(', ')} restart identity`)

await db.exec(`
  insert into neon_auth.user (id, email)
  values ('${ADMIN}', 'admin-demo@exemplo.invalid')
  on conflict (id) do nothing
`)

await db.exec(`
  insert into public.profiles (id, full_name, organization_id, role, is_active)
  select '${ADMIN}', 'Admin Demo', id, 'admin', true from public.organizations limit 1
  on conflict (id) do update set role = 'admin', is_active = true
`)

const claims = JSON.stringify({ sub: ADMIN, role: 'authenticated' })

async function prepararSessao({ isolada, admin = true } = {}) {
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
  await db.query(`select set_config('app.demo_isolada', $1, false)`, [isolada ? 'true' : ''])
  await db.query(`update public.profiles set is_active = $1 where id = $2`, [admin, ADMIN])
}

async function erroDe(consulta) {
  try {
    await db.query(consulta)
    return null
  } catch (erro) {
    return erro.message
  }
}

const contagens = `select
  (select count(*) from public.vendas where organization_id = $1)::int as vendas,
  (select count(*) from public.itens_venda)::int as itens,
  (select count(*) from public.titulos_financeiros where organization_id = $1)::int as titulos,
  (select count(*) from public.parcelas_financeiras where organization_id = $1)::int as parcelas,
  (select count(*) from public.baixas_financeiras where organization_id = $1)::int as baixas,
  (select count(*) from public.recebimentos_compra where organization_id = $1)::int as recebimentos,
  (select count(*) from public.movimentacoes_estoque where organization_id = $1)::int as movimentos,
  (select count(*) from public.lancamentos where organization_id = $1)::int as lancamentos,
  (select count(*) from public.produtos where organization_id = $1 and codigo like 'DEMO-%')::int as produtos,
  (select count(*) from public.clientes where organization_id = $1 and codigo like 'DEMO-%')::int as clientes`

titulo('Travas de segurança')

await prepararSessao({ isolada: true })
let erro = await erroDe(`select public.demo_carregar('token-errado')`)
ok('token inválido é recusado', /token inválido/i.test(erro ?? ''), erro ?? 'passou')

await prepararSessao({ isolada: false })
erro = await erroDe(`select public.demo_carregar('${TOKEN}')`)
ok('sem app.demo_isolada a carga é recusada', /app\.demo_isolada/.test(erro ?? ''), erro ?? 'passou')

await prepararSessao({ isolada: true, admin: false })
erro = await erroDe(`select public.demo_carregar('${TOKEN}')`)
ok('sem administrador ativo a carga é recusada', /administrador ativo/i.test(erro ?? ''), erro ?? 'passou')

await prepararSessao({ isolada: true })

titulo('Carga da demonstração')

const org = (await db.query('select id from public.organizations order by created_at limit 1')).rows[0]
  .id

const carga = (await db.query(`select public.demo_carregar('${TOKEN}') as r`)).rows[0].r
ok('primeira carga não é marcada como existente', carga.ja_existia === false)
ok('2 empresas', carga.empresas === 2, String(carga.empresas))
ok('2 filiais', carga.filiais === 2, String(carga.filiais))
ok('10 depósitos (5 por filial)', carga.depositos === 10, String(carga.depositos))
ok('8 produtos DEMO', carga.produtos === 8, String(carga.produtos))
ok('20 clientes DEMO', carga.clientes === 20, String(carga.clientes))
ok('4 fornecedores DEMO', carga.fornecedores === 4, String(carga.fornecedores))
ok('6 compras', carga.compras === 6, String(carga.compras))
ok('6 recebimentos', carga.recebimentos === 6, String(carga.recebimentos))
ok('60 vendas', carga.vendas === 60, String(carga.vendas))
ok('66 títulos (60 vendas + 6 compras)', carga.titulos === 66, String(carga.titulos))
ok('62 lançamentos de caixa', carga.lancamentos === 62, String(carga.lancamentos))
ok('1 ficha técnica', carga.fichas === 1, String(carga.fichas))

const antes = (await db.query(contagens, [org])).rows[0]
ok('60 itens de venda', antes.itens === 60, String(antes.itens))
ok('66 parcelas', antes.parcelas === 66, String(antes.parcelas))
ok('62 baixas (60 vendas + 2 compras)', antes.baixas === 62, String(antes.baixas))
ok('82 movimentos (10 aberturas + 12 recebimentos + 60 vendas)', antes.movimentos === 82, String(antes.movimentos))

titulo('Idempotência')

const segunda = (await db.query(`select public.demo_carregar('${TOKEN}') as r`)).rows[0].r
ok('segunda chamada devolve ja_existia', segunda.ja_existia === true)
const depois = (await db.query(contagens, [org])).rows[0]
ok(
  'segunda chamada não duplica nada',
  JSON.stringify(antes) === JSON.stringify(depois),
  `${JSON.stringify(antes)} -> ${JSON.stringify(depois)}`,
)

titulo('Regras de consistência')

const consistencia = (
  await db.query(
    `select
      (select count(*) from public.produtos p
        where p.quantidade is distinct from public.saldo_estoque(p.id))::int as cache_divergente,
      (select count(*) from public.produtos p where p.quantidade < 0)::int as saldo_negativo,
      (select count(*) from public.vendas v where v.status = 'Concluída'
         and not exists (select 1 from public.itens_venda i where i.venda_id = v.id))::int as venda_sem_item,
      (select count(*) from public.vendas v where v.status = 'Concluída'
         and not exists (select 1 from public.movimentacoes_estoque m where m.venda_id = v.id))::int as venda_sem_movimento,
      (select count(*) from public.vendas v where v.estornada_em is null
         and not exists (select 1 from public.titulos_financeiros t
                          where t.origem_tipo = 'venda' and t.origem_id = v.id))::int as venda_sem_titulo,
      (select count(*) from public.vendas v where v.estornada_em is null
         and not exists (select 1 from public.baixas_financeiras b
                          where b.chave_idempotencia = 'venda:' || v.id::text))::int as venda_sem_baixa,
      (select count(*) from public.titulos_financeiros t
         where not exists (select 1 from public.parcelas_financeiras p where p.titulo_id = t.id))::int as titulo_sem_parcela,
      (select count(*) from public.recebimentos_compra r
         where not exists (select 1 from public.recebimentos_compra_itens i where i.recebimento_id = r.id))::int as recebimento_sem_item,
      (select count(*) from public.recebimentos_compra_itens i where i.movimento_id is null)::int as item_recebido_sem_movimento,
      (select count(*) from public.movimentacoes_estoque m
         where m.organization_id = $1 and m.origem <> 'abertura'
           and m.venda_id is null and m.recebimento_item_id is null)::int as movimento_sem_origem,
      (select count(*) from (
         select organization_id, chave_idempotencia from public.lancamentos
          where chave_idempotencia is not null
          group by 1, 2 having count(*) > 1) x)::int as lancamento_duplicado,
      (select count(*) from public.vendas v
         where abs(v.total - coalesce((select sum(round(i.quantidade * i.preco_unitario, 2))
                                         from public.itens_venda i where i.venda_id = v.id), 0)) > 0.02)::int as venda_total_divergente,
      (select count(*) from public.vendas v
         where v.filial_id is distinct from
               (select i.filial_id from public.itens_venda i where i.venda_id = v.id limit 1))::int as venda_filial_divergente,
      (select count(*) from public.vendas v where v.filial_id is null)::int as venda_sem_filial,
      (select count(*) from public.movimentacoes_estoque m where m.filial_id is null)::int as movimento_sem_filial,
      (select count(*) from public.titulos_financeiros t where t.filial_id is null)::int as titulo_sem_filial`,
    [org],
  )
).rows[0]

for (const [regra, valor] of Object.entries(consistencia)) {
  ok(regra.replaceAll('_', ' '), valor === 0, String(valor))
}

titulo('Estoque e recebimento parcial')

const estoque = (
  await db.query(`select
    (select count(*) from public.compras where status = 'recebimento_parcial')::int as parciais,
    (select count(*) from public.recebimentos_compra_itens i
       join public.movimentacoes_estoque m on m.id = i.movimento_id
      where round(i.quantidade_base::numeric, 3) <> round(m.quantidade::numeric, 3))::int as quantidade_divergente,
    (select count(*) from public.recebimentos_compra r
      where round(r.valor_total::numeric, 2) <>
            round((select sum(i.valor) from public.recebimentos_compra_itens i where i.recebimento_id = r.id), 2))::int as valor_divergente`)
).rows[0]
ok('há compra com recebimento parcial', estoque.parciais >= 1, String(estoque.parciais))
ok('item recebido e movimento têm a mesma quantidade', estoque.quantidade_divergente === 0)
ok('valor do recebimento bate com os itens', estoque.valor_divergente === 0)

titulo('Financeiro reflete as operações')

const financeiro = (
  await db.query(`select
    (select count(*) from public.titulos_financeiros t where t.origem_tipo = 'venda' and t.tipo = 'receber')::int as titulos_venda,
    (select count(*) from public.titulos_financeiros t where t.origem_tipo = 'recebimento_compra' and t.tipo = 'pagar')::int as titulos_compra,
    (select count(*) from public.titulos_financeiros t
      where t.tipo = 'pagar' and t.status = 'liquidado')::int as pagos,
    (select count(*) from public.titulos_financeiros t
      where t.tipo = 'receber' and t.status = 'liquidado')::int as recebidos,
    (select count(*) from public.parcelas_financeiras p
      where p.valor_liquidado > p.valor + 0.0001)::int as liquidado_maior,
    (select count(*) from public.parcelas_financeiras p
      where p.status = 'liquidado' and p.valor_liquidado + 0.0001 < p.valor)::int as status_incoerente,
    (select count(*) from public.lancamentos l
      where l.valor <= 0 or l.tipo not in ('entrada', 'saida'))::int as lancamento_invalido`)
).rows[0]
ok('60 contas a receber de venda', financeiro.titulos_venda === 60, String(financeiro.titulos_venda))
ok('6 contas a pagar de compra', financeiro.titulos_compra === 6, String(financeiro.titulos_compra))
ok('2 contas a pagar liquidadas', financeiro.pagos === 2, String(financeiro.pagos))
ok('60 contas a receber liquidadas', financeiro.recebidos === 60, String(financeiro.recebidos))
ok('nenhuma parcela liquidada acima do valor', financeiro.liquidado_maior === 0)
ok('status das parcelas coerente', financeiro.status_incoerente === 0)
ok('lançamentos de caixa válidos', financeiro.lancamento_invalido === 0)

await db.close()

if (falhas > 0) {
  console.error(`\n${falhas} verificação(ões) falharam.\n`)
  process.exitCode = 1
} else {
  console.log('\n== TUDO OK ==\n')
}
