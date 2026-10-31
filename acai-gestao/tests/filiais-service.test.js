import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/base.js', () => ({
  carregar: vi.fn(),
  neon: { rpc: vi.fn() },
  neonConfigurado: true,
}))

const base = await import('../src/services/base.js')
const { gerenciarFilial, listarFiliais } = await import('../src/services/filiais.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('serviço de filiais', () => {
  it('lista as unidades ordenadas pelo número gerado no banco', async () => {
    const filiais = [{ id: 'f1', numero: 1 }, { id: 'f2', numero: 2 }]
    const order = vi.fn().mockResolvedValue({ data: filiais, error: null })
    const select = vi.fn(() => ({ order }))
    const from = vi.fn(() => ({ select }))
    base.carregar.mockImplementation(async ({ consulta }) => ({
      dados: await consulta({ from }),
      origem: 'neon',
    }))

    await expect(listarFiliais()).resolves.toEqual({ dados: filiais, origem: 'neon' })
    expect(from).toHaveBeenCalledWith('filiais')
    expect(order).toHaveBeenCalledWith('numero', { ascending: true })
  })

  it('envia operação, filial e dados para a RPC protegida', async () => {
    const filial = { id: 'f2', numero: 2, codigo: 'LOJA 02' }
    base.neon.rpc.mockResolvedValue({ data: filial, error: null })

    await expect(
      gerenciarFilial('editar', 'f2', { nome: 'Loja Centro' }),
    ).resolves.toEqual(filial)
    expect(base.neon.rpc).toHaveBeenCalledWith('gerenciar_filial', {
      p_operacao: 'editar',
      p_filial_id: 'f2',
      p_dados: { nome: 'Loja Centro' },
    })
  })

  it('propaga a falha do banco sem apresentar uma resposta de sucesso', async () => {
    const erro = { code: '42501', name: 'PostgrestError' }
    base.neon.rpc.mockResolvedValue({ data: null, error: erro })
    const consoleErro = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(gerenciarFilial('criar', null, { nome: 'Loja Centro' })).rejects.toBe(erro)
    expect(consoleErro).toHaveBeenCalledWith(
      '[filiais] Falha ao gerenciar filial.',
      expect.objectContaining({ code: '42501', operacao: 'criar' }),
    )
    consoleErro.mockRestore()
  })
})
