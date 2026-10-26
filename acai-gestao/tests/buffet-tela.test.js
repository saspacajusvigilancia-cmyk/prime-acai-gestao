// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({ neonConfigurado: true }))
vi.mock('../src/icons.js', () => ({ renderIcons: vi.fn() }))
vi.mock('../src/services/permissoes.js', () => ({ pode: () => true }))
vi.mock('../src/services/produtos.js', () => ({
  listarProdutos: async () => ({
    origem: 'neon',
    dados: [{
      uuid: 'p1',
      id: 'B001',
      nome: 'Polpa de açaí',
      unidade: 'kg',
      tipoProduto: 'insumo',
      controlaEstoque: true,
      ativo: true,
    }],
  }),
}))
vi.mock('../src/services/movimentacoes.js', () => ({
  registrarMovimentacao: vi.fn(),
  listarSaldosEstoqueLocais: async () => ({
    origem: 'neon',
    dados: [{ produtoId: 'p1', buffet: 12, geral: 0, loja: 0 }],
  }),
}))
vi.mock('../src/services/operacoes-buffet.js', () => ({
  abastecerBuffet: vi.fn(),
  devolverProdutoBuffet: vi.fn(),
  listarOperacoesBuffet: async () => ({ origem: 'neon', dados: [] }),
  mensagemErroBuffet: (erro) => erro.message,
  registrarPerdaBuffet: vi.fn(),
  resumoFechamentoBuffet: vi.fn(),
}))
vi.mock('../src/services/fechamentos-buffet.js', () => ({
  abrirFechamentoBuffet: vi.fn(),
  fecharFechamentoBuffet: vi.fn(),
  listarFechamentosBuffet: vi.fn(async () => ({
    origem: 'neon',
    dados: [{ id: 'f1', status: 'aberto', abertoEm: '2026-11-01T10:00:00Z' }],
  })),
  listarItensFechamentoBuffet: vi.fn(),
  reabrirFechamentoBuffet: vi.fn(),
}))

const { buffetPage } = await import('../src/pages/buffet.js')

afterEach(() => {
  document.body.innerHTML = ''
})

describe('tela do Estoque Buffet', () => {
  it('mostra o ciclo aberto, o saldo do ledger e a contagem editável', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const page = buffetPage()
    root.innerHTML = page.html
    page.mount(root)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.textContent).toContain('Estoque Buffet')
    expect(root.textContent).toContain('Polpa de açaí')
    expect(root.textContent).toContain('12')
    expect(root.querySelector('[data-acao="fechar"]')).toBeTruthy()
    expect(root.querySelector('[data-produto="p1"]').value).toBe('12')
    expect(root.querySelector('[data-form-operacao="abastecimento"]')).toBeTruthy()
    expect(root.querySelector('[data-form-operacao="perda"]')).toBeTruthy()
    expect(root.querySelector('#buffet-turno')).toBeNull()
  })

  it('oferece a seleção do turno quando não há fechamento aberto', async () => {
    const fechamentos = await import('../src/services/fechamentos-buffet.js')
    vi.mocked(fechamentos.listarFechamentosBuffet).mockResolvedValue({
      origem: 'neon',
      dados: [],
    })

    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const page = buffetPage()
    root.innerHTML = page.html
    page.mount(root)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.querySelector('#buffet-turno')).toBeTruthy()
    expect(root.querySelector('[data-acao="abrir"]')).toBeTruthy()
  })
})
