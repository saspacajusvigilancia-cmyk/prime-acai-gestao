// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: false,
  neon: {},
}))

const { configVendasPage } = await import('../src/pages/config-vendas.js')

let root
let desmontar

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')
  const pagina = configVendasPage()
  root.innerHTML = pagina.html
  desmontar = pagina.mount(root)
  await tick()
})

afterEach(() => {
  desmontar?.()
  document.body.innerHTML = ''
  document.body.classList.remove('sem-scroll')
  vi.restoreAllMocks()
})

describe('configuração de tipos de venda e pagamentos', () => {
  it('mostra os canais e as formas iniciais no modo demonstração', () => {
    expect(root.textContent).toContain('Balcão')
    expect(root.textContent).toContain('Delivery próprio')
    expect(root.textContent).toContain('Aplicativo')
    expect(root.textContent).toContain('Cartão de crédito')
    expect(root.textContent).toContain('PIX')
  })

  it('filtra o catálogo por pesquisa', () => {
    const busca = root.querySelector('[data-busca="tipo"]')
    busca.value = 'delivery'
    busca.dispatchEvent(new Event('input', { bubbles: true }))

    expect(root.querySelector('[data-linhas="tipo"]').textContent).toContain('Delivery próprio')
    expect(root.querySelector('[data-linhas="tipo"]').textContent).not.toContain('Aplicativo')
  })

  it('permite cadastrar um tipo personalizado sem apagar os padrões', async () => {
    root.querySelector('[data-novo="tipo"]').click()
    const modal = document.querySelector('.modal')
    modal.querySelector('[name="nome"]').value = 'Retirada no local'
    modal.querySelector('[name="categoria"]').value = 'personalizado'
    modal.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await tick()

    expect(document.querySelector('.modal')).toBeNull()
    expect(root.querySelector('[data-linhas="tipo"]').textContent).toContain('Retirada no local')
    expect(root.querySelector('[data-linhas="tipo"]').textContent).toContain('Delivery próprio')
  })
})
