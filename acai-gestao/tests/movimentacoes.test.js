import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * O serviço do livro-razão, com os dois lados presos na mesma régua:
 *
 *   • o vocabulário de locais do frontend tem que ser EXATAMENTE o que o
 *     CHECK da migração 06 aceita — e o que a RPC da 07 aceita;
 *   • a validação de tela (quantidade, motivo, origem/destino) recusa antes de
 *     gastar uma viagem, sem substituir a do banco;
 *   • o RPC é chamado com os nomes de parâmetro que a função declara — trocar um
 *     deles é falha silenciosa no Data API, e este teste pega.
 */

const estado = vi.hoisted(() => ({
  rpc: [],
  from: [],
  rpcResposta: { data: [], error: null },
}))

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: true,
  neon: {
    rpc: async (nome, params) => {
      estado.rpc.push({ nome, params })
      return estado.rpcResposta
    },
    from: () => {
      const resposta = estado.from.length ? estado.from.shift() : { data: [], error: null }
      const encadeavel = {
        select: () => encadeavel,
        eq: () => encadeavel,
        order: () => encadeavel,
        limit: () => encadeavel,
        then: (ok) => ok(resposta),
      }
      return encadeavel
    },
  },
}))

const {
  LOCAIS,
  LOCAIS_CONTAGEM,
  LOCAIS_MOVIMENTO,
  OPERACOES,
  ajustarSaldo,
  listarMovimentacoes,
  locaisDaOperacao,
  registrarMovimentacao,
} = await import('../src/services/movimentacoes.js')

const sql06 = readFileSync(new URL('../neon/06_movimentacoes_estoque.sql', import.meta.url), 'utf8')
const sql07 = readFileSync(new URL('../neon/07_movimentacoes_rpc.sql', import.meta.url), 'utf8')

/** Lê a lista de um `check (coluna in (...))` da migração. */
const locaisDe = (sql, coluna) => {
  const trecho = new RegExp(`check \\(${coluna} in \\(([^)]*)\\)\\)`).exec(sql)
  return [...trecho[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

const movimentoValido = {
  produtoId: 'p1',
  quantidade: 10,
  origem: 'fornecedor',
  destino: 'estoque',
  motivo: 'Compra da semana',
}

beforeEach(() => {
  estado.rpc = []
  estado.from = []
  estado.rpcResposta = { data: [], error: null }
})

describe('vocabulário de locais', () => {
  it('o frontend conhece exatamente os locais do CHECK da migração 06', () => {
    const doBanco = [...new Set([...locaisDe(sql06, 'origem'), ...locaisDe(sql06, 'destino')])].sort()

    expect(Object.keys(LOCAIS).sort()).toEqual(doBanco)
    expect(LOCAIS_MOVIMENTO.length).toBe(6)
    expect([...LOCAIS_MOVIMENTO].sort()).toEqual(
      doBanco.filter((local) => !['abertura', 'contagem'].includes(local)),
    )
    expect([...LOCAIS_CONTAGEM].sort()).toEqual(['abertura', 'contagem'])
  })

  it('a RPC aceita os mesmos locais que a tela oferece', () => {
    const trecho = /p_origem not in \(([^)]*)\)/.exec(sql07)
    const daRpc = [...trecho[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()

    expect([...LOCAIS_MOVIMENTO].sort()).toEqual(daRpc)
  })

  it('todo atalho usa locais válidos e diferentes entre si', () => {
    for (const op of OPERACOES) {
      if (op.valor === 'outro') continue
      expect(LOCAIS_MOVIMENTO, `origem de ${op.valor}`).toContain(op.origem)
      expect(LOCAIS_MOVIMENTO, `destino de ${op.valor}`).toContain(op.destino)
      expect(op.origem, `destino igual à origem em ${op.valor}`).not.toBe(op.destino)
    }
  })

  it('o atalho "compra" é fornecedor → estoque, e "outro" deixa escolher', () => {
    expect(locaisDaOperacao('compra')).toEqual({ origem: 'fornecedor', destino: 'estoque' })
    expect(locaisDaOperacao('perda')).toEqual({ origem: 'estoque', destino: 'perda' })
    expect(locaisDaOperacao('outro')).toEqual({ origem: '', destino: '' })
    expect(locaisDaOperacao('inexistente')).toEqual({ origem: '', destino: '' })
  })
})

describe('registrarMovimentacao', () => {
  it('recusa antes de sair da tela: quantidade, motivo, lugar repetido', () => {
    expect(() => registrarMovimentacao({ ...movimentoValido, quantidade: 0 })).toThrow(/maior que zero/i)
    expect(() => registrarMovimentacao({ ...movimentoValido, quantidade: -5 })).toThrow(/maior que zero/i)
    expect(() => registrarMovimentacao({ ...movimentoValido, motivo: '   ' })).toThrow(/motivo/i)
    expect(() => registrarMovimentacao({ ...movimentoValido, destino: 'fornecedor' })).toThrow(/diferentes/i)
    expect(() => registrarMovimentacao({ ...movimentoValido, produtoId: null })).toThrow(/escolha o item/i)
  })

  it("não deixa a tela inventar 'abertura' — isso é contagem, não movimento", () => {
    expect(() => registrarMovimentacao({ ...movimentoValido, origem: 'abertura' })).toThrow(/origem/i)
    expect(() => registrarMovimentacao({ ...movimentoValido, destino: 'deposito' })).toThrow(/origem/i)
  })

  it('chama o RPC com os nomes de parâmetro que a função declara', async () => {
    estado.rpcResposta = {
      data: [
        {
          id: 'm1',
          produto_id: 'p1',
          quantidade: '10',
          origem: 'fornecedor',
          destino: 'estoque',
          motivo: 'Compra da semana',
          saldo: '31',
          criado_em: '2026-10-19T10:00:00.000Z',
        },
      ],
      error: null,
    }

    const { dados, origem } = await registrarMovimentacao({ ...movimentoValido, motivo: '  Compra da semana  ' })

    expect(origem).toBe('neon')
    expect(estado.rpc.at(-1)).toEqual({
      nome: 'registrar_movimentacao',
      params: {
        p_produto_id: 'p1',
        p_qtd: 10,
        p_origem: 'fornecedor',
        p_destino: 'estoque',
        p_motivo: 'Compra da semana',
      },
    })
    expect(dados.quantidade).toBe(10)
    expect(dados.saldo).toBe(31)
    expect(dados.quando).toBe('2026-10-19T10:00:00.000Z')
  })

  it('deixa a mensagem do banco subir (é ela que o usuário lê)', async () => {
    estado.rpcResposta = {
      data: null,
      error: { message: 'Saldo insuficiente para "Banana prata": o livro-razão fecharia em -5.000 kg.' },
    }

    await expect(registrarMovimentacao(movimentoValido)).rejects.toThrow(/saldo insuficiente/i)
  })
})

describe('ajustarSaldo', () => {
  it('manda o local escolhido e devolve o antes e o depois', async () => {
    estado.rpcResposta = {
      data: [{ saldo_anterior: '21', saldo: '31', movimentacao_id: 'm9' }],
      error: null,
    }

    const { dados } = await ajustarSaldo({
      produtoId: 'p1',
      contado: 31,
      motivo: 'Contagem de fechamento',
      local: 'contagem',
    })

    expect(estado.rpc.at(-1)).toEqual({
      nome: 'ajustar_saldo',
      params: {
        p_produto_id: 'p1',
        p_contado: 31,
        p_motivo: 'Contagem de fechamento',
        p_local: 'contagem',
      },
    })
    expect(dados).toEqual({ saldoAnterior: 21, saldo: 31, movimentacaoId: 'm9' })
  })

  it('assume "contagem" por padrão e recusa contagem inválida', async () => {
    estado.rpcResposta = { data: [{ saldo_anterior: '0', saldo: '10', movimentacao_id: 'm1' }], error: null }
    await ajustarSaldo({ produtoId: 'p1', contado: 10, motivo: 'Saldo inicial' })
    expect(estado.rpc.at(-1).params.p_local).toBe('contagem')

    expect(() => ajustarSaldo({ produtoId: 'p1', contado: -1, motivo: 'x' })).toThrow(/negativo/i)
    expect(() => ajustarSaldo({ produtoId: 'p1', contado: 1, motivo: 'x', local: 'deposito' })).toThrow(/contagem/i)
    expect(() => ajustarSaldo({ produtoId: 'p1', contado: 1, motivo: '  ' })).toThrow(/motivo/i)
  })
})

describe('listarMovimentacoes', () => {
  it('traz quem registrou, pelo embed em profiles', async () => {
    estado.from = [
      {
        data: [
          {
            id: 'm1',
            produto_id: 'p1',
            quantidade: '2',
            origem: 'estoque',
            destino: 'perda',
            motivo: 'Venceu',
            venda_id: null,
            criado_em: '2026-10-19T10:00:00.000Z',
            quem: { full_name: 'Maria Souza' },
          },
        ],
        error: null,
      },
    ]

    const { dados, origem } = await listarMovimentacoes('p1')

    expect(origem).toBe('neon')
    expect(dados).toHaveLength(1)
    expect(dados[0]).toMatchObject({ origem: 'estoque', destino: 'perda', quantidade: 2, quem: 'Maria Souza' })
  })

  it('se o embed falhar, o histórico ainda aparece (sem o autor)', async () => {
    estado.from = [
      { data: null, error: { message: 'relationship not found' } },
      {
        data: [
          {
            id: 'm1',
            produto_id: 'p1',
            quantidade: '2',
            origem: 'estoque',
            destino: 'perda',
            motivo: 'Venceu',
            venda_id: null,
            criado_em: '2026-10-19T10:00:00.000Z',
          },
        ],
        error: null,
      },
    ]

    const { dados, origem } = await listarMovimentacoes('p1')

    expect(origem).toBe('neon')
    expect(dados).toHaveLength(1)
    expect(dados[0].quem).toBeNull()
  })
})
