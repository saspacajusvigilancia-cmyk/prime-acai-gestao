import { carregar, gravar } from './base.js'
import { registrarMovimentacao } from './movimentacoes.js'

const CHAVE = () =>
  globalThis.crypto?.randomUUID?.() ??
  `buffet-${Date.now()}-${Math.random().toString(16).slice(2)}`

const numero = (valor) => Number(valor ?? 0)

const paraOperacao = (linha) => ({
  id: linha.id,
  tipo: linha.tipo,
  produtoId: linha.produto_id,
  produtoNome: linha.produto_nome,
  quantidade: numero(linha.quantidade),
  unidade: linha.unidade,
  origem: linha.origem,
  destino: linha.destino,
  motivo: linha.motivo ?? '',
  observacoes: linha.observacoes ?? '',
  condicao: linha.condicao ?? null,
  responsavel: linha.responsavel ?? 'Usuário',
  criadoEm: linha.criado_em,
})

const paraResumo = (linha) => ({
  produtoId: linha.produto_id,
  produtoNome: linha.produto_nome,
  unidade: linha.unidade,
  saldoInicial: numero(linha.saldo_inicial),
  abastecido: numero(linha.abastecido),
  devolvido: numero(linha.devolvido),
  perdas: numero(linha.perdas),
  vendaDireta: numero(linha.venda_direta),
  saldoSistema: numero(linha.saldo_sistema),
  saldoContado: numero(linha.saldo_contado),
  consumoAparente: numero(linha.consumo_aparente),
  consumoEstimado: numero(linha.consumo_estimado),
  divergencia: numero(linha.divergencia),
})

export function abastecerBuffet({ produtoId, quantidade, origem, motivo, chaveIdempotencia }) {
  if (!['estoque', 'estoque_geral'].includes(origem)) {
    throw new Error('Escolha Estoque da loja ou Estoque geral como origem.')
  }
  return registrarMovimentacao({
    produtoId,
    quantidade,
    origem,
    destino: 'buffet',
    motivo,
    chaveIdempotencia: chaveIdempotencia || CHAVE(),
  })
}

export function registrarPerdaBuffet({
  produtoId,
  quantidade,
  motivo,
  observacoes = '',
  chaveIdempotencia = CHAVE(),
}) {
  const qtd = Number(quantidade)
  const texto = String(observacoes).trim()
  if (!produtoId) throw new Error('Escolha um produto do Buffet.')
  if (!Number.isFinite(qtd) || qtd <= 0) throw new Error('A quantidade precisa ser maior que zero.')
  if (!['vencimento', 'deterioracao', 'contaminacao', 'derramamento', 'desperdicio_operacional', 'outro'].includes(motivo)) {
    throw new Error('Escolha um motivo válido para a perda.')
  }
  if (texto.length > 1000) throw new Error('As observações devem ter até 1.000 caracteres.')

  return gravar({
    nome: 'perda do Estoque Buffet',
    registro: { produtoId, quantidade: qtd, motivo, observacoes: texto },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('registrar_perda_buffet', {
        p_produto_id: produtoId,
        p_quantidade: qtd,
        p_motivo: motivo,
        p_observacoes: texto,
        p_chave_idempotencia: chaveIdempotencia,
      })
      if (error) throw error
      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não confirmou o registro de perda.')
      return { id: linha.id, movimentacaoId: linha.movimentacao_id, saldoBuffet: numero(linha.saldo_buffet), criadoEm: linha.criado_em }
    },
  })
}

export function devolverProdutoBuffet({
  produtoId,
  quantidade,
  condicao,
  motivo,
  observacoes = '',
  chaveIdempotencia = CHAVE(),
}) {
  const qtd = Number(quantidade)
  const textoMotivo = String(motivo ?? '').trim()
  const textoObservacoes = String(observacoes).trim()
  if (!produtoId) throw new Error('Escolha um produto autorizado para retorno.')
  if (!Number.isFinite(qtd) || qtd <= 0) throw new Error('A quantidade precisa ser maior que zero.')
  if (!['lacrado', 'reaproveitavel'].includes(condicao)) throw new Error('Escolha a condição do produto.')
  if (!textoMotivo || textoMotivo.length > 500) throw new Error('Informe um motivo de até 500 caracteres.')
  if (textoObservacoes.length > 1000) throw new Error('As observações devem ter até 1.000 caracteres.')

  return gravar({
    nome: 'devolução ao Estoque Normal',
    registro: { produtoId, quantidade: qtd, condicao, motivo: textoMotivo, observacoes: textoObservacoes },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('devolver_produto_buffet', {
        p_produto_id: produtoId,
        p_quantidade: qtd,
        p_condicao: condicao,
        p_motivo: textoMotivo,
        p_observacoes: textoObservacoes,
        p_chave_idempotencia: chaveIdempotencia,
      })
      if (error) throw error
      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não confirmou a devolução.')
      return {
        id: linha.id,
        movimentacaoId: linha.movimentacao_id,
        saldoBuffet: numero(linha.saldo_buffet),
        saldoLoja: numero(linha.saldo_loja),
        criadoEm: linha.criado_em,
      }
    },
  })
}

export function listarOperacoesBuffet({ desde = null, ate = null, produtoId = null } = {}) {
  return carregar({
    nome: 'histórico das operações do Buffet',
    exemplo: [],
    consulta: async (neon) => {
      const { data, error } = await neon.rpc('listar_operacoes_buffet', {
        p_desde: desde || null,
        p_ate: ate || null,
        p_produto_id: produtoId || null,
      })
      if (error) throw error
      return (data ?? []).map(paraOperacao)
    },
  })
}

export function resumoFechamentoBuffet(id) {
  if (!id) throw new Error('Fechamento não informado.')
  return carregar({
    nome: 'resumo de consumo do fechamento Buffet',
    exemplo: [],
    consulta: async (neon) => {
      const { data, error } = await neon.rpc('resumo_fechamento_buffet', { p_id: id })
      if (error) throw error
      return (data ?? []).map(paraResumo)
    },
  })
}

export function mensagemErroBuffet(erro) {
  const code = String(erro?.code ?? '')
  const mensagem = String(erro?.message ?? '')
  if (code === '42501' || /permiss[aã]o|autorizad[oa]|permission denied/i.test(mensagem)) {
    return 'Sua conta não tem permissão para esta operação. Solicite acesso a um responsável.'
  }
  if (/saldo|quantidade indispon[ií]vel|insuficiente/i.test(mensagem)) {
    return 'Saldo insuficiente no local selecionado. Confira os saldos e tente novamente.'
  }
  if (/duplicad|já existe|chave.*usada/i.test(mensagem)) {
    return 'Esta operação já foi registrada ou conflita com uma operação anterior. Atualize os saldos e confira o histórico.'
  }
  if (/sess[aã]o expirada/i.test(mensagem)) {
    return 'Sua sessão expirou. Entre novamente para continuar.'
  }
  return 'Não foi possível concluir a operação do Buffet. Verifique a conexão e tente novamente.'
}
