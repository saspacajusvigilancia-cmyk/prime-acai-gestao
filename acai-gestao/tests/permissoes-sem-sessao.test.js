import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/base.js', () => ({
  neon: { rpc: vi.fn() },
  neonConfigurado: true,
}))

import { estadoSessao } from 'login-projetos/sessao'
import { neon } from '../src/services/base.js'
import { carregarPermissoes } from '../src/services/permissoes.js'

describe('carregarPermissoes sem sessão', () => {
  beforeEach(() => {
    estadoSessao.usuario = null
    estadoSessao.perfil = null
    estadoSessao.permissoes = new Set(['vendas.consultar'])
    vi.clearAllMocks()
  })

  it('limpa permissões antigas sem chamar a Data API', async () => {
    await expect(carregarPermissoes()).resolves.toEqual(new Set())

    expect(estadoSessao.permissoes).toEqual(new Set())
    expect(neon.rpc).not.toHaveBeenCalled()
  })
})
