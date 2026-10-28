/**
 * A tela de Compras sem `compras.criar` precisa montar.
 *
 * O botão "Nova compra" só é renderizado para quem pode criar. O listener era
 * ligado sem optional chaining e derrubava a página inteira no mount — o
 * usuário via o menu, clicava e a tela ficava em branco.
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
    pode: (modulo, acao) => !(modulo === 'compras' && acao === 'criar'),
  }
})

const { comprasPage } = await import('../src/pages/compras.js')

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

let desmontar

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>'
  const root = document.querySelector('#app')
  const pagina = comprasPage()
  root.innerHTML = pagina.html
  desmontar = pagina.mount(root)
  await tick()
})

afterEach(() => {
  desmontar?.()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('tela de Compras — perfil sem permissão de criar', () => {
  it('monta sem o botão Nova compra e continua listando', () => {
    const root = document.querySelector('#app')

    expect(root.querySelector('[data-acao="nova-compra"]')).toBeNull()
    expect(root.querySelector('#tabela-historico')).not.toBeNull()
  })
})
