// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSugerirCodigo, mockCriarCliente, mockListarClientes } = vi.hoisted(() => ({
  mockSugerirCodigo: vi.fn(),
  mockCriarCliente: vi.fn(),
  mockListarClientes: vi.fn(),
}))

vi.mock('../src/services/clientes.js', () => ({
  listarClientes: mockListarClientes,
  criarCliente: mockCriarCliente,
  sugerirCodigoCliente: mockSugerirCodigo,
}))

vi.mock('../src/services/resumo.js', () => ({
  carregarResumo: async () => ({
    dados: { clientesAtivos: 0, novosClientes: 0, clientesAtivosDelta: 0 },
    origem: 'neon',
  }),
}))

vi.mock('../src/services/base.js', () => ({
  neonConfigurado: false,
  observar: (promessa, callback) => {
    promessa.then(callback)
    return () => {}
  },
  hoje: () => '2026-10-26',
}))

const { clientesPage } = await import('../src/pages/clientes.js')
const { fechar } = await import('../src/formulario.js')

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

let root
let desmontar

beforeEach(() => {
  mockSugerirCodigo.mockReset()
  mockSugerirCodigo.mockResolvedValue('C-1532')
  mockCriarCliente.mockReset()
  mockListarClientes.mockReset()
  mockListarClientes.mockResolvedValue({ dados: [], origem: 'neon' })

  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')

  const pagina = clientesPage()
  root.innerHTML = pagina.html
  desmontar = pagina.mount(root)
})

afterEach(() => {
  desmontar?.()
  fechar()
  document.body.innerHTML = ''
})

describe('cadastro de cliente', () => {
  it('mostra o código gerado pelo sistema e impede a edição', async () => {
    root.querySelector('[data-acao="novo-cliente"]').click()
    await tick()

    expect(mockSugerirCodigo).toHaveBeenCalledTimes(1)

    const codigo = document.querySelector('[name="codigo"]')
    expect(codigo).not.toBeNull()
    expect(codigo.value).toBe('C-1532')
    expect(codigo.readOnly).toBe(true)
    expect(codigo.getAttribute('aria-readonly')).toBe('true')

    const ajuda = document.querySelector('[data-campo="codigo"] .campo__ajuda')
    expect(ajuda.textContent).toContain('Gerado automaticamente')

    // O foco inicial pula o campo travado e vai para o nome.
    expect(document.activeElement?.name).toBe('nome')
  })

  it('recusa e-mail inválido sem chamar o serviço de cadastro', async () => {
    const servico = await import('../src/services/clientes.js')

    root.querySelector('[data-acao="novo-cliente"]').click()
    await tick()

    document.querySelector('[name="nome"]').value = 'Ana Souza'
    document.querySelector('[name="nome"]').dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('[name="email"]').value = 'ana@'
    document.querySelector('.modal__form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await tick()

    expect(servico.criarCliente).not.toHaveBeenCalled()
    expect(document.querySelector('.modal__erro').textContent).toContain('e-mail válido')
    expect(document.querySelector('.modal')).not.toBeNull()
  })

  it('bloqueia clique no fundo e confirma X, Cancelar e Escape sem perder os dados', async () => {
    root.querySelector('[data-acao="novo-cliente"]').click()
    await tick()

    const nome = document.querySelector('[name="nome"]')
    const formulario = document.querySelector('.modal')
    nome.value = 'Ana Souza'
    nome.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector('#busca-clientes').value = 'Ana'
    root.querySelector('#busca-clientes').dispatchEvent(new Event('input', { bubbles: true }))

    document.querySelector('.modal__scrim').click()
    expect(document.querySelectorAll('.modal')).toHaveLength(1)
    expect(document.querySelector('.modal')).toBe(formulario)
    expect(nome.value).toBe('Ana Souza')

    document.querySelector('.modal__x').click()
    await tick()
    expect(document.querySelectorAll('.modal')).toHaveLength(2)
    expect(document.querySelectorAll('.modal')[1].textContent).toContain(
      'Existem dados não salvos. Deseja realmente sair e descartar as alterações?',
    )
    document.querySelector('.modal [data-cancelar].btn--ghost').click()
    await tick()
    expect(document.querySelectorAll('.modal')).toHaveLength(1)
    expect(nome.value).toBe('Ana Souza')

    document.querySelector('.modal__form [data-fechar]').click()
    await tick()
    expect(document.querySelectorAll('.modal')).toHaveLength(2)
    document.querySelector('.modal [data-cancelar].btn--ghost').click()
    await tick()
    expect(document.querySelectorAll('.modal')).toHaveLength(1)
    expect(nome.value).toBe('Ana Souza')

    nome.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await tick()
    expect(document.querySelectorAll('.modal')).toHaveLength(2)
    document.querySelector('.modal [data-confirmar]').click()
    await tick()
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('fecha pelo X sem confirmação quando não houve alterações', async () => {
    root.querySelector('[data-acao="novo-cliente"]').click()
    await tick()

    document.querySelector('.modal__x').click()

    expect(document.querySelector('.modal')).toBeNull()
  })

  it('mantém o formulário em falha de salvamento e fecha após salvar sem duplicar', async () => {
    const servico = await import('../src/services/clientes.js')
    const busca = root.querySelector('#busca-clientes')
    busca.value = 'Ana'
    busca.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector('[data-acao="novo-cliente"]').click()
    await tick()

    const nome = document.querySelector('[name="nome"]')
    nome.value = 'Ana Souza'
    nome.dispatchEvent(new Event('input', { bubbles: true }))
    mockCriarCliente.mockRejectedValueOnce(new Error('Falha temporária ao salvar.'))
    document.querySelector('.modal__form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await tick()
    expect(document.querySelector('.modal')).not.toBeNull()
    expect(document.querySelector('[name="nome"]').value).toBe('Ana Souza')
    expect(document.querySelector('.modal__erro').textContent).toContain('Falha temporária')

    const criado = {
      uuid: 'cliente-1',
      id: 'C-1532',
      nome: 'Ana Souza',
      email: '',
      telefone: '',
      desde: '2026-10-26',
      pedidos: 0,
      total: 0,
      ultimaCompra: '2026-10-26',
      tier: 'Novo',
    }
    mockCriarCliente.mockResolvedValueOnce({ dados: criado, origem: 'neon' })
    mockListarClientes.mockResolvedValueOnce({ dados: [criado], origem: 'neon' })
    document.querySelector('.modal__form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await tick()
    await tick()

    expect(servico.criarCliente).toHaveBeenCalledTimes(2)
    expect(document.querySelector('.modal')).toBeNull()
    expect(root.querySelector('#busca-clientes').value).toBe('Ana')
    expect(root.querySelector('#tabela-clientes').textContent).toContain('Ana Souza')
  })

  it('não repete a criação se a atualização da lista falhar após salvar', async () => {
    const criado = {
      uuid: 'cliente-2',
      id: 'C-1532',
      nome: 'Bruna Lima',
      email: '',
      telefone: '',
      desde: '2026-10-26',
      pedidos: 0,
      total: 0,
      ultimaCompra: '2026-10-26',
      tier: 'Novo',
    }
    mockCriarCliente.mockResolvedValueOnce({ dados: criado, origem: 'neon' })
    mockListarClientes.mockRejectedValueOnce(new Error('Falha ao atualizar a lista.'))

    root.querySelector('[data-acao="novo-cliente"]').click()
    await tick()
    document.querySelector('[name="nome"]').value = 'Bruna Lima'
    document.querySelector('[name="nome"]').dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('.modal__form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await tick()
    await tick()

    expect(mockCriarCliente).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.modal')).toBeNull()
    expect(root.querySelector('#tabela-clientes').textContent).toContain('Bruna Lima')
  })

  it('avisa e não abre o formulário quando o código não pode ser gerado', async () => {
    mockSugerirCodigo.mockRejectedValue(
      new Error('Não foi possível conectar ao sistema para gerar o código.'),
    )

    root.querySelector('[data-acao="novo-cliente"]').click()
    await tick()

    expect(document.querySelector('.modal')).toBeNull()
    expect(document.querySelector('#toasts')?.textContent).toContain(
      'Não foi possível conectar ao sistema para gerar o código.',
    )
  })
})
