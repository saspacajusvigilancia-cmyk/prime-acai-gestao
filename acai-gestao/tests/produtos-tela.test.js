// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { produto } = vi.hoisted(() => ({
  produto: {
    criarProduto: vi.fn(),
    atualizarProduto: vi.fn(),
    salvarProdutoComImagem: vi.fn(),
  },
}))

vi.mock('../src/services/permissoes.js', () => ({
  pode: () => true,
}))

vi.mock('../src/services/categorias.js', () => ({
  listarCategorias: async () => ({
    dados: [{ nome: 'Açaí', ativo: true }],
    origem: 'neon',
  }),
}))

vi.mock('../src/services/movimentacoes.js', () => ({
  ajustarSaldo: vi.fn(),
}))

vi.mock('../src/services/imagens-produtos.js', () => ({
  IMAGEM_PRODUTO_TAMANHO_MAX: 512 * 1024,
  carregarImagemProduto: vi.fn(),
  listarImagensProdutos: async () => ({
    disponivel: true,
    imagens: new Map(),
  }),
  validarImagemProduto: vi.fn(),
}))

vi.mock('../src/services/produtos.js', () => ({
  CODIGO_PRODUTO_DUPLICADO: 'PRODUCT_CODE_DUPLICATE',
  LOCAIS_ESTOQUE_ORIGEM: { estoque: 'Estoque Normal' },
  METODOS_ESTOQUE: { movimentacoes: 'Movimentações' },
  REGRAS_BAIXA_ESTOQUE: { legada: 'Manter comportamento atual' },
  TIPOS_PRODUTO: { outro: 'Outro' },
  TIPOS_VENDA: { unidade: 'Por unidade', peso: 'Por peso', receita: 'Por receita' },
  atualizarProduto: produto.atualizarProduto,
  criarProduto: produto.criarProduto,
  listarProdutos: async () => ({ dados: [], origem: 'neon' }),
  normalizarProduto: (valores) => valores,
  salvarProdutoComImagem: produto.salvarProdutoComImagem,
  sugerirCodigoProduto: async () => 'P001',
  unidadeDeVenda: (tipo) => (tipo === 'peso' ? 'kg' : tipo === 'receita' ? 'porção' : 'un'),
}))

const { produtosPage } = await import('../src/pages/produtos.js')

let root
let desmontar

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function abrirCadastro() {
  root.querySelector('#produto-novo').click()
  await tick()
  const form = root.querySelector('#produto-form')
  vi.spyOn(form, 'reportValidity').mockReturnValue(true)
  form.elements.namedItem('codigo').value = 'P005'
  form.elements.namedItem('nome').value = 'Produto novo'
  form.elements.namedItem('categoria').value = 'Açaí'
  form.elements.namedItem('preco').value = '10,00'
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await tick()
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')
  const pagina = produtosPage()
  root.innerHTML = pagina.html
  desmontar = pagina.mount(root)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  produto.criarProduto.mockRejectedValue(Object.assign(new Error('detalhe técnico'), {
    code: 'PRODUCT_CODE_DUPLICATE',
  }))
})

afterEach(() => {
  desmontar?.()
  document.body.innerHTML = ''
  document.body.classList.remove('sem-scroll')
  vi.restoreAllMocks()
})

describe('aviso de código duplicado no cadastro de produtos', () => {
  it('mostra o diálogo acessível e mantém os dados se o usuário cancelar', async () => {
    await abrirCadastro()

    const dialogo = document.querySelector('[role="alertdialog"]')
    expect(dialogo).toBeTruthy()
    expect(dialogo.textContent).toContain('Código de produto já cadastrado')
    expect(dialogo.textContent).toContain(
      'Este código já está sendo utilizado por outro produto. Informe um código diferente para continuar.',
    )
    expect(dialogo.querySelector('[data-confirmar]').textContent).toBe('Corrigir código')
    const botaoCancelar = [...dialogo.querySelectorAll('button[data-cancelar]')]
      .find((botao) => botao.textContent.trim() === 'Cancelar')
    expect(botaoCancelar).toBeTruthy()

    botaoCancelar.click()
    await tick()

    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(root.querySelector('#produto-form').elements.namedItem('codigo').value).toBe('P005')
    expect(root.querySelector('#produto-form').elements.namedItem('nome').value).toBe('Produto novo')
    expect(root.querySelector('#produto-codigo-erro').textContent)
      .toBe('Este código já está cadastrado. Escolha outro código.')
    expect(root.querySelector('#produto-form').elements.namedItem('codigo').getAttribute('aria-invalid'))
      .toBe('true')
  })

  it('foca e seleciona o código ao escolher Corrigir código', async () => {
    await abrirCadastro()

    document.querySelector('[role="alertdialog"] [data-confirmar]').click()
    await tick()

    const codigo = root.querySelector('#produto-form').elements.namedItem('codigo')
    expect(document.activeElement).toBe(codigo)
    expect(codigo.selectionStart).toBe(0)
    expect(codigo.selectionEnd).toBe(codigo.value.length)
  })
})
