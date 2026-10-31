// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'

vi.mock('../src/formulario.js', () => ({
  campoHtml: (campo) => `<div><label>${campo.label}<input class="campo__input" name="${campo.nome}" /></label></div>`,
  confirmar: vi.fn(),
}))

vi.mock('../src/icons.js', () => ({ renderIcons: vi.fn() }))
vi.mock('login-projetos/sessao', () => ({ estadoSessao: { perfil: { papel: 'admin' } } }))
vi.mock('login-projetos/auth', () => ({ emailValido: () => true }))
vi.mock('../src/services/base.js', () => ({ neonConfigurado: true }))
vi.mock('../src/services/permissoes.js', () => ({ pode: () => true }))
vi.mock('../src/services/empresa.js', () => ({
  FUSOS: [],
  PREFERENCIAS_PADRAO: {},
  UFS: [],
  apenasDigitos: (valor) => String(valor).replace(/\D/g, ''),
  carregarEmpresa: vi.fn().mockResolvedValue({ dados: null, origem: 'neon' }),
  carregarLogo: vi.fn().mockResolvedValue({ dados: null, origem: 'neon' }),
  cepValido: () => true,
  cnpjValido: () => true,
  mascaraCep: (valor) => valor,
  mascaraCnpj: (valor) => valor,
  mascaraTelefone: (valor) => valor,
  mensagemDoErro: (erro) => erro.message,
  removerLogo: vi.fn(),
  salvarEmpresa: vi.fn(),
  salvarLogo: vi.fn(),
  telefoneValido: () => true,
  urlDaLogo: () => null,
  validarLogo: vi.fn(),
}))
vi.mock('../src/ui.js', () => ({
  esc: (valor) => String(valor ?? ''),
  toast: vi.fn(),
}))
vi.mock('../src/services/filiais.js', () => ({
  gerenciarFilial: vi.fn(),
  listarFiliais: vi.fn().mockResolvedValue({ dados: [], origem: 'neon' }),
}))
vi.mock('../src/pages/usuarios.js', () => ({
  usuariosPage: () => ({ html: '<p>Usuários carregados</p>', mount: vi.fn() }),
}))
vi.mock('../src/pages/permissoes.js', () => ({
  permissoesPage: () => ({ html: '<p>Permissões carregadas</p>', mount: vi.fn() }),
}))
vi.mock('../src/pages/config-vendas.js', () => ({
  configVendasPage: () => ({ html: '<p>Vendas carregadas</p>', mount: vi.fn() }),
  configProdutosPage: () => ({ html: '<p>Categorias carregadas</p>', mount: vi.fn() }),
}))

const { configuracoesPage } = await import('../src/pages/configuracoes.js')
const { gerenciarFilial, listarFiliais } = await import('../src/services/filiais.js')
const { confirmar } = await import('../src/formulario.js')

beforeEach(() => {
  vi.clearAllMocks()
  listarFiliais.mockResolvedValue({ dados: [], origem: 'neon' })
  gerenciarFilial.mockResolvedValue({})
  confirmar.mockResolvedValue(true)
})

describe('navegação das configurações', () => {
  it('lista a matriz existente na seção de filiais', async () => {
    listarFiliais.mockResolvedValue({
      dados: [
        {
          id: 'matriz-1',
          numero: 1,
          nome: 'Loja Matriz',
          nome_fantasia: 'Prime Açaí',
          tipo: 'matriz',
          ativo: true,
        },
      ],
      origem: 'neon',
    })
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const pagina = configuracoesPage()
    root.innerHTML = pagina.html
    const desmontar = pagina.mount(root)

    root.querySelector('#btn-filiais').click()
    await vi.waitFor(() => expect(root.querySelector('#filiais-lista').textContent).toContain('Loja Matriz'))

    expect(root.querySelector('#painel-filiais').hidden).toBe(false)
    expect(root.querySelector('#filiais-lista').textContent).toContain('LOJA 01')
    expect(root.querySelector('#filiais-lista').textContent).toContain('Matriz')

    desmontar()
    document.body.innerHTML = ''
  })

  it('cadastra uma filial pelo RPC e mantém o código gerado pelo banco', async () => {
    const matriz = {
      id: 'matriz-1',
      numero: 1,
      nome: 'Matriz',
      tipo: 'matriz',
      ativo: true,
    }
    const nova = {
      id: 'filial-2',
      numero: 2,
      codigo: 'LOJA 02',
      nome: 'Loja Centro',
      tipo: 'filial',
      ativo: true,
    }
    listarFiliais
      .mockResolvedValueOnce({ dados: [matriz], origem: 'neon' })
      .mockResolvedValueOnce({ dados: [matriz, nova], origem: 'neon' })
    gerenciarFilial.mockResolvedValue(nova)
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const pagina = configuracoesPage()
    root.innerHTML = pagina.html
    const desmontar = pagina.mount(root)
    root.querySelector('#btn-filiais').click()

    await vi.waitFor(() => expect(listarFiliais).toHaveBeenCalled())
    root.querySelector('#filial-form [name="nome"]').value = 'Loja Centro'
    root.querySelector('#filial-form [name="nome_fantasia"]').value = 'Prime Centro'
    root.querySelector('#filial-form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )

    await vi.waitFor(() => expect(gerenciarFilial).toHaveBeenCalledWith(
      'criar',
      null,
      expect.objectContaining({ nome: 'Loja Centro', nome_fantasia: 'Prime Centro' }),
    ))
    await vi.waitFor(() => expect(root.querySelector('#filiais-lista').textContent).toContain('LOJA 02'))

    desmontar()
    document.body.innerHTML = ''
  })

  it('preserva os campos e mostra erro localizado quando a gravação falha', async () => {
    listarFiliais.mockResolvedValue({ dados: [], origem: 'neon' })
    gerenciarFilial.mockRejectedValue({ code: '23505', name: 'PostgrestError' })
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const pagina = configuracoesPage()
    root.innerHTML = pagina.html
    const desmontar = pagina.mount(root)
    root.querySelector('#btn-filiais').click()
    await vi.waitFor(() => expect(listarFiliais).toHaveBeenCalled())
    root.querySelector('#filial-form [name="nome"]').value = 'Loja Centro'
    root.querySelector('#filial-form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )

    await vi.waitFor(() => expect(root.querySelector('#filiais-feedback').hidden).toBe(false))
    expect(root.querySelector('#filiais-feedback').textContent).toContain('código único')
    expect(root.querySelector('#filial-form [name="nome"]').value).toBe('Loja Centro')

    desmontar()
    document.body.innerHTML = ''
  })

  it('confirma antes de desativar uma filial e usa a RPC de status', async () => {
    listarFiliais.mockResolvedValue({
      dados: [{ id: 'filial-2', numero: 2, nome: 'Loja Centro', tipo: 'filial', ativo: true }],
      origem: 'neon',
    })
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const pagina = configuracoesPage()
    root.innerHTML = pagina.html
    const desmontar = pagina.mount(root)
    root.querySelector('#btn-filiais').click()
    await vi.waitFor(() => expect(root.querySelector('[data-filial-status]')).not.toBeNull())
    root.querySelector('[data-filial-status]').click()

    await vi.waitFor(() => expect(gerenciarFilial).toHaveBeenCalledWith('desativar', 'filial-2'))
    expect(confirmar).toHaveBeenCalledWith(expect.objectContaining({
      titulo: 'Desativar Loja Centro?',
    }))

    desmontar()
    document.body.innerHTML = ''
  })

  it('valida o documento da unidade antes de enviar ao banco', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const pagina = configuracoesPage()
    root.innerHTML = pagina.html
    const desmontar = pagina.mount(root)
    root.querySelector('#btn-filiais').click()
    await vi.waitFor(() => expect(listarFiliais).toHaveBeenCalled())
    root.querySelector('#filial-form [name="nome"]').value = 'Loja Centro'
    root.querySelector('#filial-form [name="cnpj"]').value = '123'
    root.querySelector('#filial-form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )

    expect(gerenciarFilial).not.toHaveBeenCalled()
    expect(root.querySelector('#filiais-feedback').textContent).toContain('11 ou 14 dígitos')

    desmontar()
    document.body.innerHTML = ''
  })

  it('abre a seção inicial e alterna painéis mantendo o estado acessível', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const pagina = configuracoesPage()
    root.innerHTML = pagina.html
    const desmontar = pagina.mount(root)

    expect(root.querySelector('#painel-empresa').hidden).toBe(false)
    expect(root.querySelector('#btn-empresa').getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('#painel-vendas').hidden).toBe(true)

    root.querySelector('#btn-vendas').click()
    await Promise.resolve()

    expect(root.querySelector('#painel-vendas').hidden).toBe(false)
    expect(root.querySelector('#btn-vendas').getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('#painel-empresa').hidden).toBe(true)
    expect(root.querySelector('#painel-vendas').textContent).toContain('Vendas carregadas')

    root.querySelector('#btn-usuarios').click()
    expect(root.querySelector('#painel-usuarios').hidden).toBe(false)
    expect(root.querySelector('#btn-usuarios').getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('#painel-vendas').hidden).toBe(true)

    desmontar()
    document.body.innerHTML = ''
  })

  it('mostra Produtos antes de Vendas e carrega as categorias nessa seção', () => {
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    const pagina = configuracoesPage()
    root.innerHTML = pagina.html
    const desmontar = pagina.mount(root)
    const botoes = [...root.querySelectorAll('[data-painel]')]

    expect(botoes.map((botao) => botao.dataset.painel).slice(-2)).toEqual(['produtos', 'vendas'])

    root.querySelector('#btn-produtos').click()
    expect(root.querySelector('#painel-produtos').hidden).toBe(false)
    expect(root.querySelector('#painel-produtos').textContent).toContain('Categorias carregadas')
    expect(root.querySelector('#painel-vendas').hidden).toBe(true)

    desmontar()
    document.body.innerHTML = ''
  })
})
