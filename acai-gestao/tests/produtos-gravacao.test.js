import { beforeEach, describe, expect, it, vi } from 'vitest'

const { banco } = vi.hoisted(() => ({
  banco: {
    produtos: [],
    erroConsulta: null,
    respostaGravacao: { data: null, error: null },
    respostasGravacao: [],
    escritas: [],
    filtros: [],
    neon: { from: vi.fn(), rpc: vi.fn() },
  },
}))

vi.mock('../src/services/base.js', () => ({
  neonConfigurado: true,
  neon: banco.neon,
  gravar: async ({ escrever }) => ({
    dados: await escrever(banco.neon),
    origem: 'neon',
  }),
  paraBooleano: (valor, padrao = true) => {
    if ([true, 'true', 'sim', 1, '1'].includes(valor)) return true
    if ([false, 'false', 'nao', 'não', 0, '0'].includes(valor)) return false
    return padrao
  },
}))

vi.mock('../src/services/imagens-produtos.js', () => ({
  prepararImagemProduto: vi.fn(),
}))

const {
  atualizarProduto,
  criarProduto,
  sugerirCodigoProduto,
} = await import('../src/services/produtos.js')

const valores = {
  codigo: 'p001',
  nome: 'Produto de teste',
  categoria: 'Açaí',
  preco: 10,
}

const linhaGravada = {
  id: 'produto-1',
  codigo: 'P001',
  nome: 'Produto de teste',
  categoria: 'Açaí',
  quantidade: 0,
  minimo: 0,
  unidade: 'un',
  custo: 0,
  preco: 10,
  tipo_venda: 'unidade',
  metodo_peso: null,
  controla_estoque: true,
  metodo_estoque: 'movimentacoes',
  tipo_produto: 'outro',
  regra_baixa_estoque: 'legada',
  local_estoque_origem: 'estoque',
  permitir_estoque_negativo: false,
  ativo: true,
}

beforeEach(() => {
  banco.produtos = []
  banco.erroConsulta = null
  banco.respostaGravacao = { data: linhaGravada, error: null }
  banco.respostasGravacao = []
  banco.neon.rpc.mockReset()
  banco.escritas.length = 0
  banco.filtros.length = 0
  banco.neon.from.mockImplementation((tabela) => {
    const filtro = { tabela, operacao: 'select', condicoes: {} }
    banco.filtros.push(filtro)
    const consulta = {
      select: vi.fn(() => consulta),
      eq: vi.fn((chave, valor) => {
        filtro.condicoes[chave] = valor
        return consulta
      }),
      neq: vi.fn((chave, valor) => {
        filtro.excluir = [chave, valor]
        return consulta
      }),
      limit: vi.fn(() => consulta),
      insert: vi.fn((registro) => {
        filtro.operacao = 'insert'
        banco.escritas.push({ operacao: 'insert', registro })
        return consulta
      }),
      update: vi.fn((registro) => {
        filtro.operacao = 'update'
        banco.escritas.push({ operacao: 'update', registro })
        return consulta
      }),
      single: vi.fn(() => Promise.resolve(
        banco.respostasGravacao.length
          ? banco.respostasGravacao.shift()
          : banco.respostaGravacao,
      )),
      then(resolve, reject) {
        const data = banco.produtos.filter((produto) => {
          const igualdade = Object.entries(filtro.condicoes)
            .every(([chave, valor]) => produto[chave] === valor)
          const exclusao = filtro.excluir
            ? produto[filtro.excluir[0]] !== filtro.excluir[1]
            : true
          return igualdade && exclusao
        })
        return Promise.resolve({ data, error: banco.erroConsulta }).then(resolve, reject)
      },
    }
    return consulta
  })
})

it('aceita apenas uma gravação quando dois cadastros concorrentes recebem o conflito do banco', async () => {
  banco.respostasGravacao = [
    { data: linhaGravada, error: null },
    {
      data: null,
      error: {
        code: '23505',
        constraint: 'produtos_codigo_key',
        message: 'duplicate key value violates unique constraint "produtos_codigo_key"',
      },
    },
  ]

  const resultados = await Promise.allSettled([
    criarProduto(valores),
    criarProduto(valores),
  ])

  expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1)
  expect(resultados.find((resultado) => resultado.status === 'rejected').reason)
    .toMatchObject({ code: 'PRODUCT_CODE_DUPLICATE' })
})

describe('gravação de produtos', () => {
  it('reserva códigos distintos pela sequência do banco', async () => {
    banco.neon.rpc
      .mockResolvedValueOnce({ data: 'P011', error: null })
      .mockResolvedValueOnce({ data: 'P012', error: null })

    await expect(sugerirCodigoProduto([])).resolves.toBe('P011')
    await expect(sugerirCodigoProduto([])).resolves.toBe('P012')
    expect(banco.neon.rpc).toHaveBeenNthCalledWith(1, 'proximo_codigo_produto')
    expect(banco.neon.rpc).toHaveBeenNthCalledWith(2, 'proximo_codigo_produto')
  })

  it('cadastra normalmente quando o código está disponível', async () => {
    const resultado = await criarProduto(valores)

    expect(resultado.origem).toBe('neon')
    expect(resultado.dados.id).toBe('P001')
    expect(banco.escritas).toHaveLength(1)
    expect(banco.escritas[0].registro.codigo).toBe('P001')
  })

  it('valida o código antes do cadastro e impede uma inserção duplicada', async () => {
    banco.produtos = [{ id: 'produto-existente', codigo: 'P001' }]

    await expect(criarProduto(valores)).rejects.toMatchObject({
      code: 'PRODUCT_CODE_DUPLICATE',
    })
    expect(banco.escritas).toHaveLength(0)
  })

  it('traduz conflito de unicidade simultâneo na constraint de código', async () => {
    banco.respostaGravacao = {
      data: null,
      error: {
        code: '23505',
        constraint: 'produtos_codigo_key',
        message: 'duplicate key value violates unique constraint "produtos_codigo_key"',
      },
    }

    await expect(criarProduto(valores)).rejects.toMatchObject({
      code: 'PRODUCT_CODE_DUPLICATE',
      message: 'Este código já está sendo utilizado por outro produto.',
    })
  })

  it('também identifica o nome exato da constraint quando só vem no erro textual', async () => {
    banco.respostaGravacao = {
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key violates unique constraint "produtos_codigo_key"',
      },
    }

    await expect(criarProduto(valores)).rejects.toMatchObject({
      code: 'PRODUCT_CODE_DUPLICATE',
    })
  })

  it('não acusa duplicidade ao editar mantendo o próprio código', async () => {
    banco.produtos = [{ id: 'produto-1', codigo: 'P001' }]

    const resultado = await atualizarProduto('produto-1', valores)

    expect(resultado.dados.id).toBe('P001')
    expect(banco.filtros[0].condicoes).toEqual({ codigo: 'P001' })
    expect(banco.filtros[0].excluir).toEqual(['id', 'produto-1'])
    expect(banco.escritas[0].operacao).toBe('update')
  })

  it('bloqueia edição quando o código pertence a outro produto', async () => {
    banco.produtos = [
      { id: 'produto-1', codigo: 'P001' },
      { id: 'produto-2', codigo: 'P002' },
    ]

    await expect(atualizarProduto('produto-1', { ...valores, codigo: 'P002' }))
      .rejects.toMatchObject({ code: 'PRODUCT_CODE_DUPLICATE' })
    expect(banco.filtros[0].excluir).toEqual(['id', 'produto-1'])
    expect(banco.escritas).toHaveLength(0)
  })

  it('traduz conflito de código ocorrido durante uma edição concorrente', async () => {
    banco.respostaGravacao = {
      data: null,
      error: {
        code: '23505',
        constraint: 'produtos_codigo_key',
        message: 'duplicate key value violates unique constraint',
      },
    }

    await expect(atualizarProduto('produto-1', valores)).rejects.toMatchObject({
      code: 'PRODUCT_CODE_DUPLICATE',
    })
  })

  it('apresenta uma mensagem de conexão sem expor detalhes técnicos', async () => {
    banco.erroConsulta = { code: 'ETIMEDOUT', message: 'connection timed out to db.internal' }

    await expect(criarProduto(valores)).rejects.toMatchObject({
      message: 'Não foi possível conectar ao sistema. Verifique sua conexão e tente novamente.',
    })
  })

  it('não classifica outras violações de unicidade como código duplicado', async () => {
    banco.respostaGravacao = {
      data: null,
      error: {
        code: '23505',
        constraint: 'produtos_organization_id_id_unico',
        message: 'duplicate key value violates unique constraint',
      },
    }

    await expect(criarProduto(valores)).rejects.toMatchObject({
      message: 'Não foi possível salvar o produto. Tente novamente. Se o problema continuar, fale com o suporte.',
    })
  })

  it('substitui a mensagem do schema cache por uma orientação segura', async () => {
    banco.respostaGravacao = {
      data: null,
      error: {
        code: 'PGRST204',
        message: "Could not find the 'local_estoque_origem' column of 'produtos' in the schema cache",
      },
    }

    await expect(criarProduto(valores)).rejects.toMatchObject({
      message: 'O sistema precisa de uma atualização para salvar este produto. Fale com o suporte.',
    })
  })
})
