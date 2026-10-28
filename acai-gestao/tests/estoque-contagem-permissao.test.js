/**
 * Quem pode CONTAR estoque não é necessariamente quem pode MOVIMENTAR.
 *
 * Contagem física grava ajuste (`estoque.editar`); entrada/saída avulsa exige
 * `estoque.criar`. A tela separava os dois dentro do mesmo botão e escondia
 * "Contar" de quem tinha a permissão de editar mas não a de movimentar.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: false,
  neon: {},
}))

vi.mock('../src/services/permissoes.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    pode: (modulo, acao) => !(modulo === 'estoque' && acao === 'criar'),
  }
})

const { estoquePage } = await import('../src/pages/estoque.js')

beforeEach(() => {
  document.body.innerHTML = ''
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tela de Estoque — edita e conta, mas não movimenta', () => {
  it('mostra Contar e Editar, sem Movimentar', () => {
    const pagina = estoquePage()
    document.body.innerHTML = '<div id="app"></div>'
    const root = document.querySelector('#app')
    root.innerHTML = pagina.html
    pagina.mount(root)

    const linha = root.querySelector('#tabela-estoque tbody tr')
    const acoes = [...linha.querySelectorAll('button')].map((b) => b.dataset.acao)

    expect(acoes).toContain('contar-produto')
    expect(acoes).toContain('editar-produto')
    expect(acoes).not.toContain('movimentar-produto')
  })
})
