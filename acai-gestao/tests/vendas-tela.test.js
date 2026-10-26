// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  tipos: [
    { id: 'tipo-balcao', codigo: 'balcao', nome: 'Balcão', categoria: 'balcao', ativo: true },
    { id: 'tipo-delivery', codigo: 'delivery_proprio', nome: 'Delivery próprio', categoria: 'delivery', ativo: true },
    { id: 'tipo-app', codigo: 'aplicativo', nome: 'Aplicativo', categoria: 'aplicativo', ativo: true },
  ],
  pagamentos: [
    { id: 'pag-pix', nome: 'PIX', categoria: 'pix', ativo: true },
    { id: 'pag-dinheiro', nome: 'Dinheiro', categoria: 'dinheiro', ativo: true },
  ],
}))

vi.mock('../src/services/base.js', () => ({
  hoje: () => '2026-10-20',
  observar: () => () => {},
}))
vi.mock('../src/services/clientes.js', () => ({
  listarClientes: async () => ({ dados: [], origem: 'exemplo' }),
}))
vi.mock('../src/services/produtos.js', () => ({
  listarProdutos: async () => ({
    dados: [{ id: 'prod-1', nome: 'Açaí 300ml', preco: 12, tipoVenda: 'unidade' }],
    origem: 'exemplo',
  }),
}))
vi.mock('../src/services/recipientes.js', () => ({
  listarRecipientes: async () => ({ dados: [], origem: 'exemplo' }),
}))
vi.mock('../src/services/config-vendas.js', () => ({
  listarTiposVenda: async () => ({ dados: fixture.tipos, origem: 'exemplo' }),
  listarFormasPagamento: async () => ({ dados: fixture.pagamentos, origem: 'exemplo' }),
}))
vi.mock('../src/services/resumo.js', () => ({
  carregarResumo: async () => ({ dados: {}, origem: 'exemplo' }),
}))
vi.mock('../src/services/vendas.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    estornarVenda: vi.fn(),
    // O CSV é puro: usa o gerador de verdade, só a consulta é simulada.
    listarVendas: async () => ({ dados: [], origem: 'exemplo' }),
    proximoCodigoVenda: async () => '#1',
    registrarVenda: vi.fn(),
  }
})
vi.mock('../src/services/permissoes.js', () => ({
  pode: () => true,
}))

// A exportação precisa de linhas previsíveis. Em teste o `.env` pode ter
// VITE_NEON_URL, e aí `vendas` de exemplo nasce vazia — o CSV não teria o que
// baixar. Mantém o resto do módulo e troca só a lista de vendas.
vi.mock('../src/data.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    vendas: [
      {
        id: '#4821',
        cliente: 'Maria Souza',
        itens: 3,
        total: 64.5,
        pagamento: 'Pix',
        status: 'Concluída',
        hora: '14:32',
      },
      {
        id: '#4820',
        cliente: 'Carlos Lima',
        itens: 1,
        total: 21.9,
        pagamento: 'Crédito',
        status: 'Em preparo',
        hora: '14:18',
      },
    ],
  }
})

const { vendasPage } = await import('../src/pages/vendas.js')

let root
let desmontar

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')
  const pagina = vendasPage()
  root.innerHTML = pagina.html
  desmontar = pagina.mount(root)
})

afterEach(() => {
  desmontar?.()
  document.body.innerHTML = ''
  document.body.classList.remove('sem-scroll')
  vi.restoreAllMocks()
})

describe('formulário de venda por canal e forma de pagamento', () => {
  it('mostra campos de delivery, aplicativo e troco apenas quando aplicáveis', async () => {
    root.querySelector('[data-acao="nova-venda"]').click()
    await tick()
    const modal = document.querySelector('.modal')
    expect(modal).toBeTruthy()

    const tipo = modal.querySelector('[name="tipoVendaId"]')
    const forma = modal.querySelector('[name="formaPagamentoId"]')
    const endereco = modal.querySelector('[data-campo="enderecoEntrega"]')
    const plataforma = modal.querySelector('[data-campo="plataforma"]')
    const dinheiro = modal.querySelector('[data-campo="valorRecebido"]')

    expect(endereco.hidden).toBe(true)
    expect(plataforma.hidden).toBe(true)
    expect(dinheiro.hidden).toBe(true)

    tipo.value = 'tipo-delivery'
    tipo.dispatchEvent(new Event('change', { bubbles: true }))
    expect(endereco.hidden).toBe(false)
    expect(plataforma.hidden).toBe(true)

    tipo.value = 'tipo-app'
    tipo.dispatchEvent(new Event('change', { bubbles: true }))
    expect(endereco.hidden).toBe(false)
    expect(plataforma.hidden).toBe(false)

    forma.value = 'pag-dinheiro'
    forma.dispatchEvent(new Event('change', { bubbles: true }))
    expect(dinheiro.hidden).toBe(false)
  })
})

describe('exportação das vendas em CSV', () => {
  const lerBlob = (blob) =>
    new Promise((resolve, reject) => {
      const leitor = new FileReader()
      leitor.onload = () => {
        const bytes = new Uint8Array(leitor.result)
        // `ignoreBOM` mantém o \uFEFF no texto — é ele que o Excel usa para
        // reconhecer o arquivo como UTF-8.
        const texto = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
        resolve({ bytes, texto })
      }
      leitor.onerror = () => reject(leitor.error)
      leitor.readAsArrayBuffer(blob)
    })

  let criarUrl
  let revogarUrl
  let cliques

  beforeEach(() => {
    criarUrl = vi.fn(() => 'blob:teste')
    revogarUrl = vi.fn()
    URL.createObjectURL = criarUrl
    URL.revokeObjectURL = revogarUrl

    cliques = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      cliques.push({ nome: this.download })
    })
  })

  afterEach(() => {
    delete URL.createObjectURL
    delete URL.revokeObjectURL
  })

  it('baixa os pedidos do dia escolhido com valores e acentos do Excel brasileiro', async () => {
    root.querySelector('[data-acao="exportar-vendas"]').click()

    expect(criarUrl).toHaveBeenCalledTimes(1)
    expect(revogarUrl).toHaveBeenCalledTimes(1)
    expect(cliques).toEqual([{ nome: 'vendas-2026-10-20.csv' }])

    const { bytes, texto: csv } = await lerBlob(criarUrl.mock.calls[0][0])
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"Pedido";"Cliente"')
    expect(csv).toContain('"#4821";"Maria Souza"')
    expect(csv).toContain('"64,50"')
  })

  it('exporta só as linhas que passam pela busca atual', async () => {
    const busca = root.querySelector('#busca-vendas')
    busca.value = 'Carlos'
    busca.dispatchEvent(new Event('input', { bubbles: true }))

    root.querySelector('[data-acao="exportar-vendas"]').click()

    const { texto: csv } = await lerBlob(criarUrl.mock.calls[0][0])
    expect(csv).toContain('"Carlos Lima"')
    expect(csv).not.toContain('"Maria Souza"')
  })

  it('avisa e não baixa arquivo quando o filtro não deixa nenhuma venda', () => {
    const busca = root.querySelector('#busca-vendas')
    busca.value = 'ninguém-com-esse-nome'
    busca.dispatchEvent(new Event('input', { bubbles: true }))

    root.querySelector('[data-acao="exportar-vendas"]').click()

    expect(criarUrl).not.toHaveBeenCalled()
    expect(document.querySelector('#toasts')?.textContent).toContain(
      'Nada para exportar com os filtros atuais.',
    )
  })
})
