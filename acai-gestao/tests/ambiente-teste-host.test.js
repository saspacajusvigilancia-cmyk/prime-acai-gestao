import { describe, expect, it } from 'vitest'
import { exigirDestinoSintetico } from '../neon/ambiente-teste.js'

const ambienteValido = () => ({
  VITE_NEON_URL: 'https://ep-winter-cloud-bdqhu8ca.c-8.us-east-2.aws.neon.tech/neondb',
  DATABASE_URL:
    'postgresql://test:test@ep-winter-cloud-bdqhu8ca.c-8.us-east-2.aws.neon.tech/neondb?sslmode=verify-full',
  NEON_TEST_PROJECT_ID: 'divine-moon-14111763',
  NEON_TEST_BRANCH_ID: 'br-shy-scene-bdvqzyg4',
  NEON_TEST_ENDPOINT_ID: 'ep-winter-cloud-bdqhu8ca',
  NEON_TEST_DATASET: 'synthetic',
})

describe('destino remoto sintético', () => {
  it('aceita somente URLs Neon com SSL PostgreSQL verificado', () => {
    expect(exigirDestinoSintetico(ambienteValido())).toBe('ep-winter-cloud-bdqhu8ca')
  })

  it('rejeita hostname externo que imita o endpoint autorizado', () => {
    const env = ambienteValido()
    env.VITE_NEON_URL = 'https://ep-winter-cloud-bdqhu8ca.attacker.example/neondb'

    expect(() => exigirDestinoSintetico(env)).toThrow(/Host ou protocolo não autorizado/)
  })

  it('rejeita Data API sem HTTPS', () => {
    const env = ambienteValido()
    env.VITE_NEON_URL = env.VITE_NEON_URL.replace('https:', 'http:')

    expect(() => exigirDestinoSintetico(env)).toThrow(/Host ou protocolo não autorizado/)
  })

  it('rejeita PostgreSQL sem verificação completa de certificado', () => {
    const env = ambienteValido()
    env.DATABASE_URL = env.DATABASE_URL.replace('verify-full', 'require')

    expect(() => exigirDestinoSintetico(env)).toThrow(/sslmode=verify-full/)
  })
})
