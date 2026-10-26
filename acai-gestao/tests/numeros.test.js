// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ativarCamposMonetarios,
  calcularPercentualCentavos,
  centavosParaReais,
  dividirCentavos,
  formatarEntradaMoeda,
  multiplicarCustoPorQuantidade,
  multiplicarMoedaPorQuantidade,
  paraCentavos,
  somarValoresCentavos,
} from '../src/numeros.js'
import { abrirFormulario, fechar } from '../src/formulario.js'

afterEach(() => {
  fechar()
  document.body.innerHTML = ''
})

describe('valores monetários em pt-BR', () => {
  it('lê vírgula decimal, agrupamento brasileiro e decimal do teclado numérico', () => {
    expect(paraCentavos('R$ 1.250,90')).toBe(125090)
    expect(paraCentavos('69,90')).toBe(6990)
    expect(paraCentavos('69.90')).toBe(6990)
    expect(paraCentavos('1.234')).toBe(123400)
    expect(paraCentavos('6990')).toBe(699000)
  })

  it('não aceita caracteres, separadores ou precisão ambíguos/inválidos', () => {
    for (const valor of ['', 'abc', '1,234', '1.23.4', 'R$ 2x']) {
      expect(paraCentavos(valor)).toBeNaN()
    }
  })

  it('mantém negativos e valores elevados em centavos inteiros', () => {
    expect(paraCentavos('-R$ 10,50')).toBe(-1050)
    expect(formatarEntradaMoeda(1234567890.12)).toBe('1.234.567.890,12')
    expect(centavosParaReais(1050)).toBe(10.5)
  })

  it('calcula preço por kg, unidade, custo de compra e arredondamento comercial', () => {
    expect(multiplicarMoedaPorQuantidade(69.9, 0.35)).toBe(2447)
    expect(multiplicarMoedaPorQuantidade(69.9, 1.25)).toBe(8738)
    expect(multiplicarMoedaPorQuantidade(15.9, 3)).toBe(4770)
    expect(multiplicarCustoPorQuantidade(0.0125, 100)).toBe(125)
    expect(dividirCentavos(1250 * 1, 1000)).toBe(1)
    expect(dividirCentavos(1250 * 5, 1000)).toBe(6)
  })

  it('soma pagamentos em centavos e calcula comissão sem ponto flutuante monetário', () => {
    const pagamentos = [5000, 8980]
    const total = somarValoresCentavos(pagamentos)
    expect(total).toBe(13980)
    expect(15000 - total).toBe(1020)
    expect(calcularPercentualCentavos(total, 12.5)).toBe(1748)
  })

  it('permite colar moeda, remove caracteres inválidos e preserva cursor durante digitação', () => {
    document.body.innerHTML = '<input data-moeda type="text" />'
    const input = document.querySelector('input')
    ativarCamposMonetarios(document)

    input.value = 'R$ 1.250,90'
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new Event('input'))
    expect(input.value).toBe('1.250,90')
    input.dispatchEvent(new Event('blur'))
    expect(input.value).toBe('1.250,90')

    input.value = '69a,90'
    input.setSelectionRange(3, 3)
    input.dispatchEvent(new Event('input'))
    expect(input.value).toBe('69,90')
    expect(input.selectionStart).toBe(2)

    input.value = ''
    input.dispatchEvent(new Event('blur'))
    expect(input.value).toBe('')
  })

  it('agrupa milhares enquanto digita sem mudar a convenção decimal nem deslocar o cursor', () => {
    document.body.innerHTML = '<input data-moeda type="text" />'
    const input = document.querySelector('input')
    ativarCamposMonetarios(document)

    input.value = '1234567,89'
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new Event('input'))
    expect(input.value).toBe('1.234.567,89')
    expect(input.selectionStart).toBe(input.value.length)
    expect(paraCentavos(input.value)).toBe(123456789)

    input.value = '12345'
    input.setSelectionRange(3, 3)
    input.dispatchEvent(new Event('input'))
    expect(input.value).toBe('12.345')
    expect(input.selectionStart).toBe(4)
  })

  it('o formulário converte o valor editado para reais sem interpretar dígitos como centavos', async () => {
    const aoSalvar = vi.fn()
    abrirFormulario({
      titulo: 'Valor',
      campos: [{ nome: 'valor', label: 'Valor', tipo: 'moeda', obrigatorio: true }],
      valores: { valor: 6990 },
      aoSalvar,
    })
    const input = document.querySelector('[name="valor"]')
    expect(input.value).toBe('6.990,00')

    input.value = '69,90'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )

    expect(aoSalvar).toHaveBeenCalledWith({ valor: 69.9 })
  })
})
