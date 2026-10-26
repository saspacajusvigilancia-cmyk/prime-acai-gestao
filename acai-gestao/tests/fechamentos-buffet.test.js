import { afterEach, describe, expect, it, vi } from 'vitest'

const estado = vi.hoisted(() => ({
  chamadas: [],
  resposta: { data: [], error: null },
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

estado.rpc = async (nome, parametros) => {
  estado.chamadas.push({ nome, parametros })
  return estado.resposta
}

const {
  abrirFechamentoBuffet,
  fecharFechamentoBuffet,
  listarFechamentosBuffet,
  listarItensFechamentoBuffet,
  reabrirFechamentoBuffet,
} = await import('../src/services/fechamentos-buffet.js')

afterEach(() => {
  estado.chamadas = []
  estado.resposta = { data: [], error: null }
})

describe('serviço de fechamento do Buffet', () => {
  it('abre um ciclo pela RPC autorizada do banco', async () => {
    estado.resposta = { data: [{ id: 'c1', status: 'aberto', aberto_em: '2026-11-01T10:00:00Z', turno: 'Noite' }], error: null }

    const resultado = await abrirFechamentoBuffet('Noite')

    expect(estado.chamadas).toEqual([{
      nome: 'abrir_fechamento_buffet_turno',
      parametros: { p_turno: 'Noite' },
    }])
    expect(resultado.dados).toMatchObject({ id: 'c1', status: 'aberto', turno: 'Noite' })
    expect(() => abrirFechamentoBuffet(' '.repeat(41))).toThrow(/turno/i)
  })

  it('normaliza a contagem e recusa quantidade negativa ou produto repetido', async () => {
    estado.resposta = {
      data: [{ id: 'c1', status: 'fechado', itens: 1, ajustes: 1, fechado_em: '2026-11-01T11:00:00Z' }],
      error: null,
    }

    await fecharFechamentoBuffet('c1', [{ produtoId: 'p1', quantidade: '2.5' }])
    expect(estado.chamadas[0]).toEqual({
      nome: 'fechar_fechamento_buffet',
      parametros: { p_id: 'c1', p_itens: [{ produto_id: 'p1', quantidade: 2.5 }] },
    })
    expect(() => fecharFechamentoBuffet('c1', [{ produtoId: 'p1', quantidade: -1 }]))
      .toThrow(/quantidades contadas/i)
    expect(() => fecharFechamentoBuffet('c1', [
      { produtoId: 'p1', quantidade: 1 },
      { produtoId: 'p1', quantidade: 1 },
    ])).toThrow(/mais de uma vez/i)
  })

  it('registra o motivo de reabertura e lista os dados de auditoria', async () => {
    estado.resposta = {
      data: [{ id: 'c1', status: 'reaberto', reaberto_em: '2026-11-01T12:00:00Z' }],
      error: null,
    }
    await reabrirFechamentoBuffet('c1', 'Ajuste após conferência')
    expect(estado.chamadas[0]).toEqual({
      nome: 'reabrir_fechamento_buffet',
      parametros: { p_id: 'c1', p_motivo: 'Ajuste após conferência' },
    })
    expect(() => reabrirFechamentoBuffet('c1', '  ')).toThrow(/motivo/i)

    estado.resposta = {
      data: [{
        id: 'c1',
        status: 'reaberto',
        aberto_em: '2026-11-01T10:00:00Z',
        motivo_reabertura: 'Ajuste após conferência',
        data_operacional: '2026-11-01',
        turno: 'Noite',
      }],
      error: null,
    }
    const historico = await listarFechamentosBuffet()
    expect(historico.dados[0]).toMatchObject({
      id: 'c1',
      status: 'reaberto',
      motivoReabertura: 'Ajuste após conferência',
      dataOperacional: '2026-11-01',
      turno: 'Noite',
    })
  })

  it('consulta o detalhe do fechamento por RPC e converte os saldos para número', async () => {
    estado.resposta = {
      data: [{
        produto_id: 'p1',
        produto_nome: 'Açaí',
        saldo_sistema: '10',
        saldo_contado: '8',
        diferenca: '-2',
        movimentacao_id: 'm1',
      }],
      error: null,
    }

    const resultado = await listarItensFechamentoBuffet('c1')
    expect(estado.chamadas[0]).toEqual({
      nome: 'listar_itens_fechamento_buffet',
      parametros: { p_id: 'c1' },
    })
    expect(resultado.dados[0]).toMatchObject({
      produtoId: 'p1',
      produtoNome: 'Açaí',
      saldoSistema: 10,
      saldoContado: 8,
      diferenca: -2,
      movimentacaoId: 'm1',
    })
  })
})
