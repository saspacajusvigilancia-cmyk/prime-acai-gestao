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
  vendas: [
    {
      id: '#4821',
      cliente: 'Maria Souza',
      itens: 3,
      total: 64.5,
      pagamento: 'Pix',
      tipoVenda: 'Balcão',
      plataforma: null,
      status: 'Concluída',
      hora: '14:32',
    },
    {
      id: '#4820',
      cliente: 'Carlos Lima',
      itens: 1,
      total: 21.9,
      pagamento: 'Crédito',
      tipoVenda: 'Aplicativo',
      plataforma: 'iFood',
      status: 'Em preparo',
      hora: '14:18',
    },
  ],
  consultas: [],
  observadores: [],
  consultaVendas: null,
}))

vi.mock('../src/services/base.js', () => ({
  hoje: () => '2026-10-20',
  observar: (promessa, callback) => {
    fixture.observadores.push({ promessa, callback })
    return () => {}
  },
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
    detalharVenda: async () => ({ dados: null, origem: 'exemplo' }),
    estornarVenda: vi.fn(),
    historicoStatusVenda: async () => ({ dados: [], origem: 'exemplo' }),
    // O CSV é puro: usa o gerador de verdade, só a consulta é simulada.
    listarVendas: (...args) => {
      fixture.consultas.push(args)
      return fixture.consultaVendas ?? Promise.resolve({ dados: [], origem: 'exemplo' })
    },
    proximoCodigoVenda: async () => '#1',
    registrarVenda: vi.fn(),
  }
})
vi.mock('../src/services/permissoes.js', () => ({
  pode: () => true,
}))

// Em teste o `.env` pode ter VITE_NEON_URL; mantenha vendas previsíveis.
vi.mock('../src/data.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    vendas: fixture.vendas,
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
  fixture.vendas.splice(2)
  fixture.consultas.length = 0
  fixture.observadores.length = 0
  fixture.consultaVendas = null
  document.body.innerHTML = `
    <select id="filial-atual">
      <option value="filial-1" selected>LOJA 01 — Centro</option>
    </select>
    <div id="app"></div>
  `
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
  it('não permite escolher o status inicial e apresenta pedido pendente por padrão', async () => {
    root.querySelector('[data-acao="nova-venda"]').click()
    await tick()

    const modal = document.querySelector('.modal')
    expect(modal.querySelector('[name="status"]')).toBeNull()
    expect(modal.querySelector('.modal__desc').textContent).toContain('começam Aguardando')
    modal.querySelector('[data-fechar]').click()
  })

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

describe('ações contextuais e detalhes históricos', () => {
  it('mostra apenas as ações compatíveis com o estado do pedido', () => {
    const linhas = [...root.querySelectorAll('#tabela-vendas tbody tr')]
    expect(linhas[0].querySelector('[data-acao="detalhes-venda"]')).toBeTruthy()
    expect(linhas[0].querySelector('[data-acao="estornar-venda"]')).toBeTruthy()
    expect(linhas[0].querySelector('[data-acao="cancelar-venda"]')).toBeNull()
    expect(linhas[1].querySelector('[data-acao="concluir-venda"]')).toBeTruthy()
    expect(linhas[1].querySelector('[data-acao="cancelar-venda"]')).toBeTruthy()
    expect(linhas[1].querySelector('[data-acao="estornar-venda"]')).toBeNull()
  })

  it('abre detalhes com aviso explícito para dados temporários de demonstração', async () => {
    root.querySelector('[data-acao="detalhes-venda"]').click()
    await tick()

    const modal = document.querySelector('.venda-detalhe')
    expect(modal).toBeTruthy()
    expect(modal.textContent).toContain('Situação do pagamento')
    expect(modal.textContent).toContain('não são registrados separadamente')
    expect(modal.textContent).toContain('Dados de demonstração são temporários')
    modal.querySelector('[data-detalhe-fechar]:not(.modal__scrim)').click()
  })
})

describe('filtros locais de vendas', () => {
  it('combina status, canal/origem, pagamento e busca sem consultar novamente', () => {
    const status = root.querySelector('#filtro-vendas-status')
    const canal = root.querySelector('#filtro-vendas-canal')
    const pagamento = root.querySelector('#filtro-vendas-pagamento')

    status.value = 'Em preparo'
    status.dispatchEvent(new Event('change'))
    canal.value = 'plataforma:iFood'
    canal.dispatchEvent(new Event('change'))
    pagamento.value = 'Crédito'
    pagamento.dispatchEvent(new Event('change'))
    root.querySelector('#busca-vendas').value = 'Carlos'
    root.querySelector('#busca-vendas').dispatchEvent(new Event('input'))

    let linhas = [...root.querySelectorAll('#tabela-vendas tbody tr')]
    expect(linhas).toHaveLength(1)
    expect(linhas[0].textContent).toContain('Carlos Lima')

    root.querySelector('#busca-vendas').value = 'Maria'
    root.querySelector('#busca-vendas').dispatchEvent(new Event('input'))
    linhas = [...root.querySelectorAll('#tabela-vendas tbody tr')]
    expect(linhas).toHaveLength(1)
    expect(linhas[0].textContent).toContain('Nenhum registro encontrado.')
    expect(fixture.consultas).toHaveLength(1)
  })

  it('usa somente as opções presentes nos pedidos carregados', () => {
    const status = [...root.querySelectorAll('#filtro-vendas-status option')].map((opcao) => opcao.value)
    const canal = [...root.querySelectorAll('#filtro-vendas-canal option')].map((opcao) => opcao.value)
    const pagamento = [...root.querySelectorAll('#filtro-vendas-pagamento option')].map((opcao) => opcao.value)

    expect(status).toEqual(['', 'Concluída', 'Em preparo'])
    expect(canal).toEqual(['', 'plataforma:iFood', 'tipo:Aplicativo', 'tipo:Balcão'])
    expect(pagamento).toEqual(['', 'Crédito', 'Pix'])
  })
})

describe('relatório de vendas', () => {
  it('informa período, filial indicada, origem, cobertura e resumo dos filtros atuais', () => {
    const meta = root.querySelector('#relatorio-vendas-metadados')
    const resumo = root.querySelector('#relatorio-vendas-resumo')
    const relatorio = root.querySelector('#relatorio-vendas')

    expect(meta.textContent).toContain('20/10/2026')
    expect(meta.textContent).toContain('LOJA 01 — Centro')
    expect(meta.textContent).toContain('Dados de demonstração')
    expect(meta.textContent).toContain('Demonstração; não representa dados operacionais.')
    expect(resumo.textContent).toContain('2')
    expect(resumo.textContent).toContain('Pedidos no resultado')
    expect(resumo.textContent.replace(/\u00a0/g, ' ')).toContain('R$ 86,40')
    expect(root.querySelector('#relatorio-vendas-grupos').textContent).toContain('Em preparo')
    expect(root.querySelector('#relatorio-vendas-grupos').textContent).toContain('Pix')
  })

  it('mantém o relatório coerente com a busca e os filtros, inclusive quando vazio', () => {
    root.querySelector('#filtro-vendas-pagamento').value = 'Crédito'
    root.querySelector('#filtro-vendas-pagamento').dispatchEvent(new Event('change'))
    root.querySelector('#busca-vendas').value = 'Maria'
    root.querySelector('#busca-vendas').dispatchEvent(new Event('input'))

    expect(root.querySelector('#relatorio-vendas-resumo').textContent).toContain('0')
    expect(root.querySelector('#relatorio-vendas-metadados').textContent).toContain(
      'Busca: Maria · Pagamento: Crédito',
    )
    expect(root.querySelector('#relatorio-vendas-grupos').textContent).toContain(
      'Nenhum pedido com os filtros atuais.',
    )
  })

  it('identifica os dados reais quando a consulta da Data API é resolvida', () => {
    fixture.observadores[0].callback({ dados: fixture.vendas, origem: 'neon' })

    expect(root.querySelector('#relatorio-vendas-metadados').textContent).toContain('Neon Data API')
    expect(root.querySelector('#relatorio-vendas-metadados').textContent).toContain(
      'Consulta do dia abaixo do limite de 300',
    )
  })

  it('atualiza a filial do relatório quando o cabeçalho termina de carregar', async () => {
    const seletor = document.querySelector('#filial-atual')
    seletor.replaceChildren(new Option('LOJA 02 — Centro', 'filial-2', true, true))
    await tick()

    expect(root.querySelector('#relatorio-vendas-metadados').textContent).toContain(
      'LOJA 02 — Centro',
    )
  })

  it('mantém o período correspondente aos dados e bloqueia CSV enquanto outro dia carrega', async () => {
    let concluirConsulta
    fixture.consultaVendas = new Promise((resolve) => {
      concluirConsulta = resolve
    })
    const campoDia = root.querySelector('#dia-vendas')
    campoDia.value = '2026-10-19'
    campoDia.dispatchEvent(new Event('change'))
    await tick()

    expect(root.querySelector('[data-acao="exportar-vendas"]').disabled).toBe(true)
    expect(root.querySelector('#relatorio-vendas-metadados').textContent).toContain('20/10/2026')

    concluirConsulta({ dados: [], origem: 'neon' })
    await tick()

    expect(root.querySelector('[data-acao="exportar-vendas"]').disabled).toBe(false)
    expect(root.querySelector('#relatorio-vendas-metadados').textContent).toContain('19/10/2026')
    expect(root.querySelector('#relatorio-vendas-metadados').textContent).toContain('Neon Data API')
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

  it('exporta somente as linhas que passam pelos filtros combinados', async () => {
    root.querySelector('#filtro-vendas-status').value = 'Em preparo'
    root.querySelector('#filtro-vendas-status').dispatchEvent(new Event('change'))
    root.querySelector('#filtro-vendas-canal').value = 'plataforma:iFood'
    root.querySelector('#filtro-vendas-canal').dispatchEvent(new Event('change'))
    root.querySelector('#filtro-vendas-pagamento').value = 'Crédito'
    root.querySelector('#filtro-vendas-pagamento').dispatchEvent(new Event('change'))

    root.querySelector('[data-acao="exportar-vendas"]').click()

    const { texto: csv } = await lerBlob(criarUrl.mock.calls[0][0])
    expect(csv).toContain('"Carlos Lima"')
    expect(csv).not.toContain('"Maria Souza"')
  })

  it('bloqueia a exportação quando o limite pode deixar o dia incompleto', () => {
    fixture.vendas.push(...Array.from({ length: 298 }, () => fixture.vendas[1]))
    root.querySelector('#busca-vendas').dispatchEvent(new Event('input', { bubbles: true }))

    expect(root.querySelector('#contagem-vendas').textContent).toContain('mostrando os mais recentes')
    expect(root.querySelector('#relatorio-vendas-metadados').textContent).toContain(
      'O teto de 300 registros carregados também foi atingido; a amostra pode estar incompleta.',
    )
    root.querySelector('[data-acao="exportar-vendas"]').click()

    expect(criarUrl).not.toHaveBeenCalled()
    expect(document.querySelector('#toasts')?.textContent).toContain(
      'Exportação bloqueada: o dia atingiu o limite de 300 pedidos',
    )
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
