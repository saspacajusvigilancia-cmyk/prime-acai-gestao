import { afterEach, describe, expect, it, vi } from 'vitest'
import viteConfig from '../vite.config.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('variáveis públicas do Vite', () => {
  it('expõe apenas a lista de configuração pública aprovada', () => {
    vi.stubEnv('VITE_NEON_URL', '')
    vi.stubEnv('VITE_NEON_AUTH_URL', '')
    vi.stubEnv('VITE_NEON_DATA_API_URL', '')
    vi.stubEnv('DATABASE_URL', '')
    const config = viteConfig({ mode: 'demo' })
    expect(config.envPrefix).toEqual([
      'VITE_NEON_URL',
      'VITE_NEON_AUTH_URL',
      'VITE_NEON_DATA_API_URL',
      'VITE_CADASTRO_PUBLICO',
      'VITE_CADASTRO_POR_CONVITE',
      'VITE_APP_URL',
      'VITE_DADOS_TESTE',
    ])
    expect(config.envPrefix).not.toContain('VITE_TESTE_EMAIL')
    expect(config.envPrefix).not.toContain('VITE_TESTE_SENHA')
  })
})
