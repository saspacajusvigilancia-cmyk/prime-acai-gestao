import { afterEach, describe, expect, it, vi } from 'vitest'

const estado = vi.hoisted(() => ({
  chamadas: [],
  resposta: { data: [], error: null },
  registrarMovimentacao: vi.fn(),
}))

vi.mock('../src/services/base.js', () => ({
  carregar: async ({ consulta, exemplo }) => ({
    dados: consulta ? await consulta({ rpc: estado.rpc }) : exemplo,
    origem: 'neon',
  }),
  gravar: async ({ escrever }) => ({
    dados: await escrever({ rpc: estado.rpc }),
    origem: 'neon',
  }),
}))

vi.mock('../src/services/movimentacoes.js', () => ({
  registrarMovimentacao: estado.registrarMovimentacao,
}))

estado.rpc = async (nome, parametros) => {
  estado.chamadas.push({ nome, parametros })
  return estado.resposta
}

const {
  abastecerBuffet,
  devolverProdutoBuffet,
  listarOperacoesBuffet,
  mensagemErroBuffet,
  registrarPerdaBuffet,
  resumoFechamentoBuffet,
} = await import('../src/services/operacoes-buffet.js')

afterEach(() => {
  estado.chamadas = []
  estado.resposta = { data: [], error: null }
  estado.registrarMovimentacao.mockReset()
})

describe('operações do Estoque Buffet', () => {
  it('abastece apenas a partir dos estoques normais e usa o ledger existente', async () => {
    estado.registrarMovimentacao.mockResolvedValue({ origem: 'neon', dados: { id: 'm1' } })

    await abastecerBuffet({
      produtoId: 'p1',
      quantidade: '2.5',
      origem: 'estoque',
      motivo: 'Reposição',
      chaveIdempotencia: 'request-1',
    })

    expect(estado.registrarMovimentacao).toHaveBeenCalledWith({
      produtoId: 'p1',
      quantidade: '2.5',
      origem: 'estoque',
      destino: 'buffet',
      motivo: 'Reposição',
      chaveIdempotencia: 'request-1',
    })
    expect(() => abastecerBuffet({ origem: 'fornecedor' })).toThrow(/origem/i)
  })

  it('registra perda com chave idempotente e converte os valores retornados', async () => {
    estado.resposta = {
      data: [{
        id: 'loss1',
        movimentacao_id: 'move1',
        saldo_buffet: '7.25',
        criado_em: '2026-11-01T10:00:00Z',
      }],
      error: null,
    }

    const resultado = await registrarPerdaBuffet({
      produtoId: 'p1',
      quantidade: 1,
      motivo: 'vencimento',
      observacoes: 'Lote vencido',
      chaveIdempotencia: 'loss-key',
    })

    expect(estado.chamadas[0]).toEqual({
      nome: 'registrar_perda_buffet',
      parametros: {
        p_produto_id: 'p1',
        p_quantidade: 1,
        p_motivo: 'vencimento',
        p_observacoes: 'Lote vencido',
        p_chave_idempotencia: 'loss-key',
      },
    })
    expect(resultado.dados).toMatchObject({ id: 'loss1', saldoBuffet: 7.25 })
  })

  it('envia condição e motivo da devolução e valida antes da chamada', async () => {
    estado.resposta = {
      data: [{
        id: 'return1',
        movimentacao_id: 'move2',
        saldo_buffet: '3',
        saldo_loja: '12',
        criado_em: '2026-11-01T10:00:00Z',
      }],
      error: null,
    }
    const dados = {
      produtoId: 'p1',
      quantidade: 2,
      condicao: 'lacrado',
      motivo: 'Produto não utilizado',
      observacoes: '',
      chaveIdempotencia: 'return-key',
    }

    const resultado = await devolverProdutoBuffet(dados)
    expect(estado.chamadas[0]).toMatchObject({
      nome: 'devolver_produto_buffet',
      parametros: {
        p_produto_id: 'p1',
        p_condicao: 'lacrado',
        p_motivo: 'Produto não utilizado',
        p_chave_idempotencia: 'return-key',
      },
    })
    expect(resultado.dados).toMatchObject({ saldoBuffet: 3, saldoLoja: 12 })
    expect(() => devolverProdutoBuffet({ ...dados, condicao: 'descartado' }))
      .toThrow(/condição/i)
  })

  it('consulta operações filtradas e resume métricas numéricas do fechamento', async () => {
    estado.resposta = {
      data: [{
        id: 'op1',
        tipo: 'perda',
        produto_id: 'p1',
        produto_nome: 'Polpa',
        quantidade: '0.5',
        unidade: 'kg',
        origem: 'buffet',
        destino: 'perda',
        motivo: 'vencimento',
        criado_em: '2026-11-01T10:00:00Z',
      }],
      error: null,
    }
    const operacoes = await listarOperacoesBuffet({
      desde: '2026-11-01',
      ate: '2026-11-02',
      produtoId: 'p1',
    })
    expect(estado.chamadas[0]).toEqual({
      nome: 'listar_operacoes_buffet',
      parametros: { p_desde: '2026-11-01', p_ate: '2026-11-02', p_produto_id: 'p1' },
    })
    expect(operacoes.dados[0]).toMatchObject({ tipo: 'perda', quantidade: 0.5 })

    estado.resposta = {
      data: [{
        produto_id: 'p1',
        produto_nome: 'Polpa',
        unidade: 'kg',
        saldo_inicial: '5',
        abastecido: '3',
        devolvido: '1',
        perdas: '0.5',
        venda_direta: '0',
        saldo_sistema: '6.5',
        saldo_contado: '6',
        consumo_aparente: '1',
        consumo_estimado: '0.5',
        divergencia: '-0.5',
      }],
      error: null,
    }
    const resumo = await resumoFechamentoBuffet('f1')
    expect(resumo.dados[0]).toMatchObject({
      saldoInicial: 5,
      abastecido: 3,
      devolvido: 1,
      perdas: 0.5,
      consumoEstimado: 0.5,
    })
  })

  it('não expõe mensagens técnicas do banco na interface', () => {
    expect(mensagemErroBuffet({
      code: 'XX999',
      message: 'permission denied for relation perdas_buffet',
    })).toMatch(/permissão/i)
    expect(mensagemErroBuffet({
      code: 'XX999',
      message: 'SQLSTATE XX999: relation secret_table',
    })).not.toContain('secret_table')
  })
})
