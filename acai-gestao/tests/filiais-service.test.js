import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/base.js', () => ({
  carregar: vi.fn(),
  neon: { rpc: vi.fn() },
  neonConfigurado: true,
}))

const base = await import('../src/services/base.js')
const {
  gerenciarAcessoFilial,
  gerenciarFilial,
  listarAcessosFiliais,
  listarFiliais,
  minhasFiliaisAutorizadas,
  selecionarFilial,
} = await import('../src/services/filiais.js')

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

  it('consulta somente filiais explicitamente autorizadas pelo banco', async () => {
    const filiais = [{ id: 'f1', atual: true }, { id: 'f2', atual: false }]
    base.neon.rpc.mockResolvedValue({ data: filiais, error: null })

    await expect(minhasFiliaisAutorizadas()).resolves.toEqual(filiais)
    expect(base.neon.rpc).toHaveBeenCalledWith('minhas_filiais_autorizadas')
  })

  it('troca a filial somente pela RPC que valida a permissão no servidor', async () => {
    const filial = { id: 'f2', numero: 2 }
    base.neon.rpc.mockResolvedValue({ data: filial, error: null })

    await expect(selecionarFilial('f2')).resolves.toEqual(filial)
    expect(base.neon.rpc).toHaveBeenCalledWith('selecionar_filial', {
      p_filial_id: 'f2',
    })
  })

  it('lista a matriz de acessos e delega a concessão para a RPC auditável', async () => {
    const acessos = [{ usuario_id: 'u1', filial_id: 'f1', ativo: true }]
    base.neon.rpc.mockResolvedValue({ data: acessos, error: null })

    await expect(listarAcessosFiliais()).resolves.toEqual(acessos)
    await gerenciarAcessoFilial('u1', 'f2', true)
    expect(base.neon.rpc).toHaveBeenNthCalledWith(1, 'listar_acessos_filiais')
    expect(base.neon.rpc).toHaveBeenNthCalledWith(2, 'gerenciar_acesso_filial', {
      p_usuario_id: 'u1',
      p_filial_id: 'f2',
      p_ativo: true,
    })
  })
})
