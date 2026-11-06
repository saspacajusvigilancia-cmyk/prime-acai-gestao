import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENDPOINT_PRODUCAO_ID } from '../neon/ambiente-teste.js'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(raiz, 'neon', 'aplicar.mjs')

function executarMigrations(env) {
  try {
    execFileSync(process.execPath, [script, '39'], {
      cwd: raiz,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 10_000,
    })
    throw new Error('O aplicador deveria bloquear antes da conexão.')
  } catch (erro) {
    if (erro.message === 'O aplicador deveria bloquear antes da conexão.') throw erro
    return `${erro.stdout ?? ''}${erro.stderr ?? ''}`
  }
}

describe('preflight do aplicador de migrations', () => {
  it('preserva a validação de certificado TLS configurada na connection string', () => {
    const codigo = readFileSync(script, 'utf8')

    expect(codigo).toMatch(/new pg\.Client\(\{\s*connectionString:\s*url,?\s*\}\)/)
    expect(codigo).not.toMatch(/rejectUnauthorized\s*:\s*false/)
  })

  it('bloqueia sem configuração sintética antes de abrir o PostgreSQL', () => {
    const saida = executarMigrations({
      VITE_NEON_URL: '',
      DATABASE_URL: '',
      NEON_TEST_PROJECT_ID: '',
      NEON_TEST_BRANCH_ID: '',
      NEON_TEST_ENDPOINT_ID: '',
      NEON_TEST_DATASET: '',
    })

    expect(saida).toContain('Migrations bloqueadas antes da conexão')
    expect(saida).not.toContain('Aplicando em:')
    expect(saida).not.toContain('Arquivos:')
  })

  it('bloqueia explicitamente o endpoint de produção antes da conexão', () => {
    const urlProducao = `https://${ENDPOINT_PRODUCAO_ID}.c-2.sa-east-1.aws.neon.tech/neondb`
    const saida = executarMigrations({
      VITE_NEON_URL: urlProducao,
      DATABASE_URL: `postgresql://test:test@${ENDPOINT_PRODUCAO_ID}.c-2.sa-east-1.aws.neon.tech/neondb`,
      NEON_TEST_PROJECT_ID: 'nameless-tooth-87377816',
      NEON_TEST_BRANCH_ID: 'br-steep-truth-b610am4p',
      NEON_TEST_ENDPOINT_ID: ENDPOINT_PRODUCAO_ID,
      NEON_TEST_DATASET: 'synthetic',
    })

    expect(saida).toContain('Migrations bloqueadas antes da conexão')
    expect(saida).toContain('produção')
    expect(saida).not.toContain(ENDPOINT_PRODUCAO_ID)
    expect(saida).not.toContain('Aplicando em:')
    expect(saida).not.toContain('Arquivos:')
  })
})
