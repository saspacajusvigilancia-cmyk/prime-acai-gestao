import { describe, it, expect, beforeEach, vi } from 'vitest'

const estado = vi.hoisted(() => ({
  chamadas: [],
  linhas: { tipos_venda: [], formas_pagamento: [] },
  resposta: null,
}))

vi.mock('login-projetos/neon', () => {
  const from = (tabela) => {
    const consulta = { tabela, filtros: [] }
    estado.chamadas.push(consulta)
    const query = {
      select: (colunas) => {
        consulta.colunas = colunas
        return query
      },
      order: (coluna) => {
        consulta.ordem = coluna
        return query
      },
      eq: (coluna, valor) => {
        consulta.filtros.push([coluna, valor])
        return query
      },
      insert: (registro) => {
        consulta.operacao = 'insert'
        consulta.registro = registro
        return query
      },
      update: (registro) => {
        consulta.operacao = 'update'
        consulta.registro = registro
        return query
      },
      single: async () => ({ data: estado.resposta, error: null }),
      then: (resolve, reject) =>
        Promise.resolve({ data: estado.linhas[tabela] ?? [], error: null }).then(resolve, reject),
    }
    return query
  }

  return { neonConfigurado: true, neon: { from } }
})

const {
  alterarFormaPagamentoAtivo,
  alterarTipoVendaAtivo,
  listarFormasPagamento,
  listarTiposVenda,
  salvarFormaPagamento,
  salvarTipoVenda,
} = await import('../src/services/config-vendas.js')

beforeEach(() => {
  estado.chamadas = []
  estado.linhas = { tipos_venda: [], formas_pagamento: [] }
  estado.resposta = null
})

describe('cadastros de venda e pagamento', () => {
  it('consulta catálogos ativos e inclui os inativos quando a configuração precisa gerenciá-los', async () => {
    estado.linhas.tipos_venda = [{ id: 'tipo-1', ativo: true }]
    await listarTiposVenda({ somenteAtivos: true })
    await listarFormasPagamento()

    expect(estado.chamadas[0]).toMatchObject({
      tabela: 'tipos_venda',
      filtros: [['ativo', true]],
      ordem: 'nome',
    })
    expect(estado.chamadas[1]).toMatchObject({
      tabela: 'formas_pagamento',
      filtros: [],
      ordem: 'nome',
    })
  })

  it('cria um tipo personalizado com código estável derivado do nome', async () => {
    estado.resposta = { id: 'tipo-1', codigo: 'retirada_no_local', nome: 'Retirada no local' }
    await salvarTipoVenda({ nome: 'Retirada no local', categoria: 'personalizado' })

    expect(estado.chamadas[0]).toMatchObject({
      tabela: 'tipos_venda',
      operacao: 'insert',
      registro: {
        codigo: 'retirada_no_local',
        nome: 'Retirada no local',
        categoria: 'personalizado',
        ativo: true,
      },
    })
  })

  it('edita um método já existente sem trocar seu código histórico', async () => {
    estado.resposta = { id: 'pag-1', codigo: 'pix', nome: 'PIX Loja' }
    await salvarFormaPagamento({
      id: 'pag-1',
      codigo: 'pix',
      nome: 'PIX Loja',
      categoria: 'pix',
      ativo: true,
    })

    expect(estado.chamadas[0]).toMatchObject({
      tabela: 'formas_pagamento',
      operacao: 'update',
      registro: { codigo: 'pix', nome: 'PIX Loja' },
    })
  })

  it('inativa em vez de excluir um registro potencialmente usado em vendas', async () => {
    estado.resposta = { id: 'tipo-1', ativo: false }
    await alterarTipoVendaAtivo({ id: 'tipo-1', ativo: false })
    estado.resposta = { id: 'pag-1', ativo: false }
    await alterarFormaPagamentoAtivo({ id: 'pag-1', ativo: false })

    expect(estado.chamadas.map(({ tabela, operacao, registro }) => [tabela, operacao, registro]))
      .toEqual([
        ['tipos_venda', 'update', { ativo: false }],
        ['formas_pagamento', 'update', { ativo: false }],
      ])
  })
})
