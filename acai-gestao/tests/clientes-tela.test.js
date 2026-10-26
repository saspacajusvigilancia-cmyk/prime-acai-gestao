// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSugerirCodigo } = vi.hoisted(() => ({
  mockSugerirCodigo: vi.fn(),
}))

vi.mock('../src/services/clientes.js', () => ({
  listarClientes: async () => ({ dados: [], origem: 'neon' }),
  criarCliente: vi.fn(),
  sugerirCodigoCliente: mockSugerirCodigo,
}))

vi.mock('../src/services/resumo.js', () => ({
  carregarResumo: async () => ({
    dados: { clientesAtivos: 0, novosClientes: 0, clientesAtivosDelta: 0 },
    origem: 'neon',
  }),
}))

vi.mock('../src/services/base.js', () => ({
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
