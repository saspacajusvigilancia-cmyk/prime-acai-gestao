/**
 * ============================================================================
 * Leitura de números digitados
 * ============================================================================
 *
 * O app inteiro digita número à mão: quantidade, peso, preço, tara. O teclado
 * do celular manda ponto, o do balcão manda vírgula, e vem "1.234,5" quando
 * alguém copia de uma planilha. Esta é a única tradução — antes a mesma regra
 * vivia copiada em `formulario.js` e em `peso.js`, que era uma divergência à
 * espera de acontecer.
 *
 * Módulo PURO: sem DOM, sem rede. Por isso `peso.js` pode depender dele.
 */

/**
 * Converte texto digitado em número.
 * Aceita "1.234,56" (padrão brasileiro) e "1234.56" (padrão do teclado).
 * Devolve `NaN` para vazio ou para o que não for número.
 */
export function paraNumero(texto) {
  let s = String(texto ?? '').trim().replace(/\s/g, '')
  if (!s) return NaN
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  return Number(s)
}

/** Mostra um número para edição, com vírgula decimal. */
export function paraTextoNumero(valor) {
  if (valor === '' || valor == null) return ''
  return String(valor).replace('.', ',')
}

/** Número para exibir na tela, com vírgula e no máximo `casas` decimais. */
export function formatarNumero(valor, casas = 3) {
  const n = Number(valor)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(n)
}

const entradaMoeda = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Valores digitados em dinheiro usam vírgula decimal; o ponto só agrupa
 * milhares. Um ponto sozinho seguido de uma ou duas casas também é aceito
 * para teclados numéricos. "6990" significa R$ 6.990,00, nunca R$ 69,90.
 */
export function paraCentavos(texto) {
  let valor = String(texto ?? '').trim().replace(/\s/g, '')
  if (!valor) return Number.NaN

  const negativo = valor.startsWith('-')
  if (negativo) valor = valor.slice(1)
  valor = valor.replace(/^R\$/i, '')
  if (!valor || !/^[\d.,]+$/.test(valor)) return Number.NaN

  const partesVirgula = valor.split(',')
  if (partesVirgula.length > 2) return Number.NaN

  let inteiro = partesVirgula[0]
  let fracao = partesVirgula[1] ?? ''

  if (partesVirgula.length === 2) {
    if (fracao.length > 2 || (fracao && !/^\d+$/.test(fracao))) return Number.NaN
    if (inteiro.includes('.') && !/^\d{1,3}(?:\.\d{3})+$/.test(inteiro)) return Number.NaN
    if (!inteiro && !fracao) return Number.NaN
    inteiro = inteiro.replace(/\./g, '') || '0'
  } else if (inteiro.includes('.')) {
    const segmentos = inteiro.split('.')
    if (
      segmentos.length > 1 &&
      segmentos[0].length >= 1 &&
      segmentos[0].length <= 3 &&
      segmentos.slice(1).every((parte) => parte.length === 3 && /^\d{3}$/.test(parte))
    ) {
      inteiro = segmentos.join('')
    } else if (segmentos.length === 2 && /^\d+$/.test(segmentos[0]) && segmentos[1] === '') {
      inteiro = segmentos[0]
    } else if (
      segmentos.length === 2 &&
      segmentos[0] === '' &&
      /^\d{1,2}$/.test(segmentos[1])
    ) {
      inteiro = '0'
      fracao = segmentos[1]
    } else if (
      segmentos.length === 2 &&
      /^\d+$/.test(segmentos[0]) &&
      /^\d{1,2}$/.test(segmentos[1])
    ) {
      inteiro = segmentos[0]
      fracao = segmentos[1]
    } else {
      return Number.NaN
    }
  }

  if (!/^\d+$/.test(inteiro) || !/^\d{0,2}$/.test(fracao)) return Number.NaN
  const centavos = Number(inteiro) * 100 + Number(fracao.padEnd(2, '0') || 0)
  if (!Number.isSafeInteger(centavos)) return Number.NaN
  return negativo ? -centavos : centavos
}

export const centavosParaReais = (centavos) => centavos / 100

export function formatarEntradaMoeda(valor) {
  if (valor === '' || valor == null) return ''
  const centavos = paraCentavos(valor)
  return Number.isSafeInteger(centavos) ? entradaMoeda.format(centavosParaReais(centavos)) : String(valor)
}

function limparEntradaMoeda(valor) {
  const semMoeda = String(valor).replace(/R\$/gi, '').replace(/\s/g, '')
  const negativo = semMoeda.startsWith('-')
  const caracteres = semMoeda.replace(/[^\d.,]/g, '').replace(/-/g, '')
  return `${negativo ? '-' : ''}${caracteres}`
}

function formatarEntradaDuranteDigitacao(valor) {
  const negativo = valor.startsWith('-')
  const corpo = negativo ? valor.slice(1) : valor
  if (!corpo || corpo.includes('.') && !corpo.includes(',')) return valor

  const partes = corpo.split(',')
  if (partes.length > 2) return valor
  const inteiro = partes[0].replace(/\./g, '')
  if (inteiro && !/^\d+$/.test(inteiro)) return valor
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negativo ? '-' : ''}${agrupado}${partes.length === 2 ? `,${partes[1]}` : ''}`
}

function cursorFormatado(valor, prefixo, cursor, agrupamentoAlterado) {
  const prefixoLimpo = limparEntradaMoeda(prefixo)
  if (!agrupamentoAlterado) return prefixoLimpo.length

  if (prefixoLimpo.includes(',')) {
    const separador = valor.indexOf(',')
    const casas = (prefixoLimpo.split(',')[1].match(/\d/g) ?? []).length
    return separador < 0 ? valor.length : separador + 1 + casas
  }

  const digitos = (prefixoLimpo.match(/\d/g) ?? []).length
  if (!digitos) return prefixoLimpo.startsWith('-') ? 1 : 0
  let encontrados = 0
  for (let indice = 0; indice < valor.length; indice++) {
    if (/\d/.test(valor[indice])) encontrados++
    if (encontrados === digitos) return indice + 1
  }
  return cursor
}

/** Conecta os inputs marcados com `data-moeda`, agrupando milhares sem mover o cursor. */
export function ativarCamposMonetarios(conteiner) {
  conteiner.querySelectorAll('[data-moeda]').forEach((campo) => {
    if (campo.dataset.moedaAtivo) return
    campo.dataset.moedaAtivo = 'true'
    campo.value = formatarEntradaMoeda(campo.value)
    campo.addEventListener('input', () => {
      const inicio = campo.selectionStart
      const prefixo = campo.value.slice(0, inicio ?? campo.value.length)
      const limpo = limparEntradaMoeda(campo.value)
      const formatado = formatarEntradaDuranteDigitacao(limpo)
      if (formatado !== campo.value) {
        campo.value = formatado
        const cursor = cursorFormatado(formatado, prefixo, inicio ?? campo.value.length, formatado !== limpo)
        campo.setSelectionRange(cursor, cursor)
      }
    })
    campo.addEventListener('blur', () => {
      if (!campo.value.trim()) return
      const centavos = paraCentavos(campo.value)
      if (Number.isSafeInteger(centavos)) campo.value = formatarEntradaMoeda(centavosParaReais(centavos))
    })
  })
}

/** Multiplica preço em reais por uma quantidade de até três casas decimais. */
export function multiplicarMoedaPorQuantidade(preco, quantidade) {
  const centavos = paraCentavos(preco)
  const qtd = Number(quantidade)
  if (!Number.isSafeInteger(centavos) || !Number.isFinite(qtd)) return Number.NaN

  const milesimos = Math.round(qtd * 1000)
  const numerador = BigInt(centavos) * BigInt(milesimos)
  const divisor = 1000n
  const arredondado =
    numerador < 0n
      ? -((-numerador + divisor / 2n) / divisor)
      : (numerador + divisor / 2n) / divisor
  return Number(arredondado)
}

/** Compra preserva o custo unitário de quatro casas usado no custo médio. */
export function multiplicarCustoPorQuantidade(custoUnitario, quantidade) {
  const custo = Number(custoUnitario)
  const qtd = Number(quantidade)
  if (!Number.isFinite(custo) || !Number.isFinite(qtd)) return Number.NaN

  const custoDezMil = Math.round(custo * 10000)
  const milesimos = Math.round(qtd * 1000)
  if (!Number.isSafeInteger(custoDezMil) || !Number.isSafeInteger(milesimos)) return Number.NaN
  const centavos = dividirInteiroComercial(BigInt(custoDezMil) * BigInt(milesimos), 100000n)
  return Number(centavos)
}

/** Arredonda a divisão de centavos inteiros comercialmente (meio para longe de zero). */
export function dividirCentavos(arredondado, divisor) {
  if (!Number.isSafeInteger(arredondado) || !Number.isSafeInteger(divisor) || divisor <= 0) {
    return Number.NaN
  }
  return Number(dividirInteiroComercial(BigInt(arredondado), BigInt(divisor)))
}

function dividirInteiroComercial(valor, divisor) {
  return valor < 0n
    ? -((-valor + divisor / 2n) / divisor)
    : (valor + divisor / 2n) / divisor
}

export function calcularPercentualCentavos(centavos, percentual) {
  const taxa = Number(percentual)
  if (!Number.isSafeInteger(centavos) || !Number.isFinite(taxa)) return Number.NaN
  const pontosBase = Math.round(taxa * 100)
  return Number(dividirInteiroComercial(BigInt(centavos) * BigInt(pontosBase), 10000n))
}

export function somarValoresCentavos(valores) {
  const total = valores.reduce((soma, valor) => soma + valor, 0)
  return Number.isSafeInteger(total) ? total : Number.NaN
}
