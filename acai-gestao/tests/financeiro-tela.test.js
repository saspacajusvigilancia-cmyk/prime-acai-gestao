// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBaixar, mockListarTitulos, mockResumo } = vi.hoisted(() => ({
  mockBaixar: vi.fn(),
  mockListarTitulos: vi.fn(),
  mockResumo: vi.fn(),
}))

vi.mock('chart.js/auto', () => ({
  default: class {
    constructor() {
      this.data = { labels: [], datasets: [{ data: [] }, { data: [] }] }
    }
    update() {}
    destroy() {}
  },
}))

vi.mock('../src/services/lancamentos.js', () => ({
  listarLancamentos: async () => ({ dados: [], origem: 'neon' }),
  carregarFluxoMensal: async () => ({
    dados: { labels: [], entradas: [], saidas: [] },
    origem: 'neon',
  }),
  carregarComparativoMensal: async () => ({
    dados: { entradasAnterior: null },
    origem: 'neon',
  }),
  criarLancamento: vi.fn(),
}))

vi.mock('../src/services/financeiro.js', () => ({
  exemploResumoFinanceiro: {
    a_receber: 120,
    a_pagar: 80,
    a_receber_vencido: 0,
    a_pagar_vencido: 0,
    titulos_abertos: 2,
    titulos_liquidados: 0,
  },
  listarTitulos: mockListarTitulos,
  carregarResumoFinanceiro: mockResumo,
  listarFormasPagamento: async () => ({
    dados: [{ id: 'forma-pix', nome: 'Pix' }],
    origem: 'neon',
  }),
  baixarParcela: mockBaixar,
}))

vi.mock('../src/services/base.js', () => ({
  neonConfigurado: true,
  hoje: () => '2026-10-29',
  observar: (promessa, callback, aoFalhar) => {
    promessa.then(callback).catch((erro) => aoFalhar?.(erro))
    return () => {}
  },
}))

const { financeiroPage } = await import('../src/pages/financeiro.js')
const { fechar } = await import('../src/formulario.js')

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const tituloReceber = {
  id: 'titulo-1',
  parcelaId: 'parcela-1',
  tipo: 'receber',
  numero: 'VR-#DEMO-0001',
  descricao: 'Venda #DEMO-0001',
  pessoa: 'Cliente Demonstração',
  vencimento: '2026-11-10',
  valor: 120,
  valorLiquidado: 0,
  saldo: 120,
  status: 'aberto',
  origemTipo: 'venda',
}

const resumo = {
  a_receber: 120,
  a_pagar: 80,
  a_receber_vencido: 0,
  a_pagar_vencido: 0,
  titulos_abertos: 2,
  titulos_liquidados: 0,
}

let root
let desmontar

function montar() {
  const pagina = financeiroPage()
  root.innerHTML = pagina.html
  desmontar = pagina.mount(root)
}

beforeEach(() => {
  mockBaixar.mockReset()
  mockListarTitulos.mockReset()
  mockResumo.mockReset()

  mockListarTitulos.mockImplementation(async (tipo) => ({
    dados: tipo === 'receber' ? [tituloReceber] : [],
    origem: 'neon',
  }))
  mockResumo.mockResolvedValue({ dados: resumo, origem: 'neon' })
  mockBaixar.mockResolvedValue({ dados: { ok: true }, origem: 'neon' })

  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')
  montar()
})

afterEach(() => {
  desmontar?.()
  fechar()
  document.body.innerHTML = ''
})

describe('financeiro · títulos', () => {
  it('mostra o saldo vindo do banco e abre a baixa preenchida', async () => {
    await tick()

    const linha = root.querySelector('#tabela-receber tbody tr')
    expect(linha).not.toBeNull()
    expect(linha.textContent).toContain('Venda #DEMO-0001')
    expect(linha.textContent).toContain('120,00')

    root.querySelector('[data-baixar="parcela-1"]').click()
    await tick()

    const valor = document.querySelector('[name="valor"]')
    expect(valor.value).toBe('120,00')
    expect(document.querySelector('[name="data"]').value).toBe('2026-10-29')
    expect(document.querySelector('[name="forma_pagamento_id"]').value).toBe('forma-pix')

    document.querySelector('.modal__form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await tick()

    expect(mockBaixar).toHaveBeenCalledWith({
      parcelaId: 'parcela-1',
      valor: 120,
      data: '2026-10-29',
      formaPagamentoId: 'forma-pix',
      observacoes: '',
    })
  })

  it('não exibe os valores de exemplo quando as views da migração 33 faltam', async () => {
    desmontar?.()
    fechar()

    mockListarTitulos.mockRejectedValue(new Error('relation does not exist'))
    mockResumo.mockRejectedValue(new Error('relation does not exist'))

    root.innerHTML = ''
    montar()
    await tick()

    const kpiReceber = root.querySelector('[data-kpi="aReceber"]')
    const kpiPagar = root.querySelector('[data-kpi="aPagar"]')
    expect(kpiReceber.textContent).toContain('—')
    expect(kpiPagar.textContent).toContain('—')
    expect(kpiReceber.textContent).toContain('Indisponível neste banco')
    expect(root.querySelector('#contagem-receber').textContent).toContain('Indisponível')
    expect(root.querySelector('#tabela-receber tbody').textContent).not.toContain('120,00')
  })
})
