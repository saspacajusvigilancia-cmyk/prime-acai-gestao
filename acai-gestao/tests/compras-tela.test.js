/**
 * A tela de Compras montada de verdade no DOM, em modo demonstração
 * (`neonConfigurado: false`): sem rede, com os produtos de exemplo e permissões
 * liberadas. Prova que a página monta, lista produtos, adiciona item e salva.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: false,
  neon: {},
}))

const { comprasPage } = await import('../src/pages/compras.js')

let root
let desmontar

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')
  const pagina = comprasPage()
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

const linhasDe = (id) => root.querySelectorAll(`#${id} tbody tr`)

describe('tela de Compras e Entradas', () => {
  it('monta as três abas e os indicadores', () => {
    expect(root.querySelectorAll('.compras-tab')).toHaveLength(3)
    expect(root.querySelector('[data-painel="nova"]')).toBeTruthy()
    expect(root.querySelector('[data-painel="historico"]')).toBeTruthy()
    expect(root.querySelector('[data-painel="fornecedores"]')).toBeTruthy()
    expect(root.querySelector('[data-kpi="comprasPendentes"]')).toBeTruthy()
    expect(root.querySelector('[data-kpi="comprasValorPendente"]')).toBeTruthy()
  })

  it('carrega os produtos de exemplo no seletor de item', () => {
    const select = root.querySelector('#item-produto')
    expect(select.disabled).toBe(false)
    expect([...select.options].some((o) => o.value === 'P001')).toBe(true)
    expect([...select.options].some((o) => o.value === 'P005')).toBe(true)
  })

  it('adiciona um item com conversão e calcula o total', () => {
    const produto = root.querySelector('#item-produto')
    produto.value = 'P001'
    produto.dispatchEvent(new Event('change'))

    root.querySelector('#item-unidade').value = 'cx'
    root.querySelector('#item-fator').value = '12'
    root.querySelector('#item-qtd').value = '2'
    root.querySelector('#item-custo').value = '10,00'
    root.querySelector('#item-adicionar').click()

    expect(linhasDe('tabela-itens-novos')).toHaveLength(1)
    expect(root.querySelector('#tabela-itens-novos').textContent).toContain('24 un')
    expect(root.querySelector('#novo-resumo').textContent).toContain('20,00')
  })

  it('salva o rascunho e mostra a compra no histórico', async () => {
    const produto = root.querySelector('#item-produto')
    produto.value = 'P001'
    produto.dispatchEvent(new Event('change'))
    root.querySelector('#item-qtd').value = '1'
    root.querySelector('#item-custo').value = '10,00'
    root.querySelector('#item-adicionar').click()

    root.querySelector('#compra-salvar-rascunho').click()
    await tick()
    await tick()

    expect(root.querySelector('[data-painel="historico"]').hidden).toBe(false)
    expect(linhasDe('tabela-historico')).toHaveLength(1)
    expect(root.querySelector('#tabela-historico').textContent).toContain('C-')
  })
})
