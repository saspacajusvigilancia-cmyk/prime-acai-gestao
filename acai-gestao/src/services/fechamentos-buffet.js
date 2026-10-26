import { carregar, gravar } from './base.js'

const paraFechamento = (linha) => ({
  id: linha.id,
  status: linha.status,
  abertoEm: linha.aberto_em,
  fechadoEm: linha.fechado_em ?? null,
  motivoReabertura: linha.motivo_reabertura ?? null,
  abertoPor: linha.aberto_por ?? null,
  fechadoPor: linha.fechado_por ?? null,
  reabertoPor: linha.reaberto_por ?? null,
  dataOperacional: linha.data_operacional ?? null,
  turno: linha.turno ?? 'Geral',
})

export function abrirFechamentoBuffet(turno = 'Geral') {
  const nomeTurno = String(turno ?? '').trim()
  if (!nomeTurno || nomeTurno.length > 40) throw new Error('Informe um turno válido.')

  return gravar({
    nome: 'abertura de fechamento do Buffet',
    registro: { turno: nomeTurno },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('abrir_fechamento_buffet_turno', {
        p_turno: nomeTurno,
      })
      if (error) throw error
      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não confirmou a abertura do fechamento.')
      return paraFechamento(linha)
    },
  })
}

export function fecharFechamentoBuffet(id, itens = []) {
  const linhas = itens.map((item) => ({
    produto_id: item.produtoId ?? item.id,
    quantidade: Number(item.quantidade),
  }))

  if (!id) throw new Error('Fechamento não informado.')
  if (linhas.some((item) => !item.produto_id ||
      !Number.isFinite(item.quantidade) || item.quantidade < 0)) {
    throw new Error('Confira os produtos e as quantidades contadas.')
  }
  if (new Set(linhas.map((item) => item.produto_id)).size !== linhas.length) {
    throw new Error('Um produto apareceu mais de uma vez na contagem.')
  }

  return gravar({
    nome: 'fechamento do Buffet',
    registro: { id, itens: linhas },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('fechar_fechamento_buffet', {
        p_id: id,
        p_itens: linhas,
      })
      if (error) throw error
      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não confirmou o fechamento do Buffet.')
      return {
        id: linha.id,
        status: linha.status,
        itens: Number(linha.itens),
        ajustes: Number(linha.ajustes),
        fechadoEm: linha.fechado_em,
      }
    },
  })
}

export function reabrirFechamentoBuffet(id, motivo) {
  const texto = String(motivo ?? '').trim()
  if (!id) throw new Error('Fechamento não informado.')
  if (!texto) throw new Error('Informe o motivo da reabertura.')

  return gravar({
    nome: 'reabertura de fechamento do Buffet',
    registro: { id, motivo: texto },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('reabrir_fechamento_buffet', {
        p_id: id,
        p_motivo: texto,
      })
      if (error) throw error
      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não confirmou a reabertura do fechamento.')
      return paraFechamento(linha)
    },
  })
}

export function listarFechamentosBuffet() {
  return carregar({
    nome: 'histórico de fechamento do Buffet',
    exemplo: [],
    consulta: async (neon) => {
      const { data, error } = await neon.rpc('listar_fechamentos_buffet')
      if (error) throw error
      return (data ?? []).map(paraFechamento)
    },
  })
}

export function listarItensFechamentoBuffet(id) {
  if (!id) throw new Error('Fechamento não informado.')
  return carregar({
    nome: 'itens do fechamento do Buffet',
    exemplo: [],
    consulta: async (neon) => {
      const { data, error } = await neon.rpc('listar_itens_fechamento_buffet', { p_id: id })
      if (error) throw error
      return (data ?? []).map((linha) => ({
        produtoId: linha.produto_id,
        produtoNome: linha.produto_nome,
        saldoSistema: Number(linha.saldo_sistema),
        saldoContado: Number(linha.saldo_contado),
        diferenca: Number(linha.diferenca),
        movimentacaoId: linha.movimentacao_id ?? null,
      }))
    },
  })
}
