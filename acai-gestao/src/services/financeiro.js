import { carregar, gravar, hoje } from './base.js'
import { listarFormasPagamento } from './config-vendas.js'

const exemploTitulos = [
  {
    id: 'demo-titulo-receber',
    parcela_id: 'demo-parcela-receber',
    tipo: 'receber',
    numero: 'VR-#DEMO',
    descricao: 'Venda de demonstração',
    cliente: 'Cliente Demonstração',
    fornecedor: null,
    parcela_vencimento: hoje(),
    parcela_valor: 120,
    parcela_liquidado: 0,
    saldo: 120,
    status: 'aberto',
    parcela_status: 'aberto',
    origem_tipo: 'venda',
  },
  {
    id: 'demo-titulo-pagar',
    parcela_id: 'demo-parcela-pagar',
    tipo: 'pagar',
    numero: 'CP-RC-000001',
    descricao: 'Recebimento de compra de demonstração',
    cliente: null,
    fornecedor: 'Fornecedor Demonstração',
    parcela_vencimento: hoje(),
    parcela_valor: 80,
    parcela_liquidado: 0,
    saldo: 80,
    status: 'aberto',
    parcela_status: 'aberto',
    origem_tipo: 'recebimento_compra',
  },
]

export const exemploResumoFinanceiro = {
  a_receber: 120,
  a_pagar: 80,
  a_receber_vencido: 0,
  a_pagar_vencido: 0,
  titulos_abertos: 2,
  titulos_liquidados: 0,
}

const paraTitulo = (linha) => ({
  id: linha.id,
  parcelaId: linha.parcela_id,
  tipo: linha.tipo,
  numero: linha.numero,
  descricao: linha.descricao,
  pessoa: linha.cliente ?? linha.fornecedor ?? '—',
  vencimento: linha.parcela_vencimento ?? linha.data_vencimento,
  valor: Number(linha.parcela_valor ?? linha.valor_original ?? 0),
  valorLiquidado: Number(linha.parcela_liquidado ?? linha.valor_liquidado ?? 0),
  saldo: Number(linha.saldo ?? 0),
  status: linha.parcela_status ?? linha.status,
  origemTipo: linha.origem_tipo,
})

/** Contas a receber ou a pagar, com a parcela que a tela vai baixar. */
export function listarTitulos(tipo, limite = 80) {
  const exemplo = exemploTitulos
    .filter((t) => !tipo || t.tipo === tipo)
    .map(paraTitulo)

  return carregar({
    nome: tipo === 'pagar' ? 'contas a pagar' : tipo === 'receber' ? 'contas a receber' : 'títulos financeiros',
    exemplo,
    consulta: async (neon) => {
      let consulta = neon
        .from('vw_titulos_financeiros')
        .select(
          'id, parcela_id, tipo, numero, descricao, cliente, fornecedor, ' +
            'data_vencimento, parcela_vencimento, parcela_valor, parcela_liquidado, ' +
            'saldo, status, parcela_status, origem_tipo, data_emissao',
        )
        .in('status', ['aberto', 'parcial', 'liquidado'])
        .order('parcela_vencimento', { ascending: true })
        .limit(limite)

      if (tipo) consulta = consulta.eq('tipo', tipo)

      const { data, error } = await consulta
      if (error) throw error
      return data.map(paraTitulo)
    },
  })
}

export function carregarResumoFinanceiro() {
  return carregar({
    nome: 'resumo financeiro',
    exemplo: exemploResumoFinanceiro,
    consulta: async (neon) => {
      const { data, error } = await neon.from('vw_financeiro_resumo').select('*').limit(1)
      if (error) throw error
      const linha = data?.[0] ?? {}
      return {
        a_receber: Number(linha.a_receber ?? 0),
        a_pagar: Number(linha.a_pagar ?? 0),
        a_receber_vencido: Number(linha.a_receber_vencido ?? 0),
        a_pagar_vencido: Number(linha.a_pagar_vencido ?? 0),
        titulos_abertos: Number(linha.titulos_abertos ?? 0),
        titulos_liquidados: Number(linha.titulos_liquidados ?? 0),
      }
    },
  })
}

function paraNumero(valor) {
  if (typeof valor === 'number') return valor
  const texto = String(valor ?? '').trim()
  if (!texto) return 0
  return Number(texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto)
}

/**
 * Baixa uma parcela. O valor vem do formulário, mas o banco revalida saldo,
 * permissão e idempotência — a tela não é a autoridade.
 */
export function baixarParcela({ parcelaId, valor, data, formaPagamentoId, observacoes }) {
  const valorNumerico = paraNumero(valor)
  const chave = `manual:${parcelaId}:${Date.now()}`

  return gravar({
    nome: 'baixa financeira',
    registro: { parcelaId, valor: valorNumerico, chave },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('baixar_parcela_financeira', {
        p_parcela_id: parcelaId,
        p_valor: valorNumerico,
        p_data: data || hoje(),
        p_forma_pagamento_id: formaPagamentoId || null,
        p_observacoes: observacoes?.trim() || '',
        p_chave: chave,
      })

      if (error) throw error
      return Array.isArray(data) ? data[0] : data
    },
  })
}

export { listarFormasPagamento }
