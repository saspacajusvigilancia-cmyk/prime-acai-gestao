import { beforeEach, describe, expect, it, vi } from 'vitest'

const { banco } = vi.hoisted(() => {
  const banco = {
    rpc: vi.fn(),
    from: vi.fn(),
    insert: null,
  }

  banco.neon = { rpc: banco.rpc, from: banco.from }
  return { banco }
})

vi.mock('../src/services/base.js', () => ({
  neonConfigurado: true,
  neon: banco.neon,
  hoje: () => '2026-10-26',
  gravar: async ({ escrever }) => ({ dados: await escrever(banco.neon), origem: 'neon' }),
}))

const { criarCliente, proximoCodigoCliente, sugerirCodigoCliente } = await import(
  '../src/services/clientes.js'
)

beforeEach(() => {
  banco.rpc.mockReset()
  banco.from.mockReset()
  banco.insert = null

  banco.from.mockImplementation(() => {
    const consulta = {
      insert: vi.fn((registro) => {
        banco.insert = registro
        return consulta
      }),
      select: vi.fn(() => consulta),
      single: vi.fn(async () => ({
        data: {
          id: 'cliente-uuid',
          codigo: banco.insert.codigo,
          nome: banco.insert.nome,
          telefone: banco.insert.telefone,
          email: banco.insert.email,
          desde: banco.insert.desde,
          tier: banco.insert.tier,
        },
        error: null,
      })),
    }

    return consulta
  })
})

describe('código do cliente', () => {
  it('reserva o próximo código na RPC do banco', async () => {
    banco.rpc.mockResolvedValue({ data: 'C-1532', error: null })

    await expect(sugerirCodigoCliente([])).resolves.toBe('C-1532')
    expect(banco.rpc).toHaveBeenCalledWith('proximo_codigo_cliente')
  })

  it('traduz a falha da RPC em uma mensagem para o usuário', async () => {
    banco.rpc.mockResolvedValue({ data: null, error: new Error('function does not exist') })

    await expect(sugerirCodigoCliente([])).rejects.toThrow(
      'Não foi possível gerar um código de cliente. Atualize o sistema e tente novamente.',
    )
  })

  it('calcula o próximo código no modo demonstração', () => {
    expect(proximoCodigoCliente([{ id: 'C-0912' }, { id: 'C-1531' }])).toBe('C-1532')
  })
})

describe('criarCliente', () => {
  const valores = {
    codigo: 'c-1532',
    nome: 'Ana Souza',
    telefone: '',
    email: '',
    desde: '2026-10-26',
    tier: 'Novo',
    observacoes: '',
  }

  it('grava o código reservado em maiúsculas, sem pedir edição ao usuário', async () => {
    const { dados } = await criarCliente(valores)

    expect(banco.insert).toMatchObject({
      codigo: 'C-1532',
      nome: 'Ana Souza',
      telefone: null,
      email: null,
      observacoes: null,
    })
    expect(dados.id).toBe('C-1532')
  })

  it('recusa gravar sem código gerado', () => {
    expect(() => criarCliente({ ...valores, codigo: '' })).toThrow(
      'O código do cliente não foi gerado. Feche e abra o cadastro novamente.',
    )
    expect(banco.from).not.toHaveBeenCalled()
  })
})
