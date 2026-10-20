import { carregar, gravar } from './base.js'

const TIPOS_EXEMPLO = [
  { id: 'tipo-balcao', codigo: 'balcao', nome: 'Balcão', categoria: 'balcao', ativo: true },
  {
    id: 'tipo-delivery',
    codigo: 'delivery_proprio',
    nome: 'Delivery próprio',
    categoria: 'delivery',
    ativo: true,
  },
  {
    id: 'tipo-aplicativo',
    codigo: 'aplicativo',
    nome: 'Aplicativo',
    categoria: 'aplicativo',
    ativo: true,
  },
]

const PAGAMENTOS_EXEMPLO = [
  { id: 'pag-dinheiro', codigo: 'dinheiro', nome: 'Dinheiro', categoria: 'dinheiro', ativo: true },
  { id: 'pag-pix', codigo: 'pix', nome: 'PIX', categoria: 'pix', ativo: true },
  { id: 'pag-debito', codigo: 'debito', nome: 'Cartão de débito', categoria: 'debito', ativo: true },
  { id: 'pag-credito', codigo: 'credito', nome: 'Cartão de crédito', categoria: 'credito', ativo: true },
  { id: 'pag-outros', codigo: 'outros', nome: 'Outras formas', categoria: 'outros', ativo: true },
]

const COLUNAS = 'id, codigo, nome, categoria, ativo'

function catalogo({ tabela, nome, exemplos, somenteAtivos = false }) {
  return carregar({
    nome,
    exemplo: somenteAtivos ? exemplos.filter((item) => item.ativo) : exemplos,
    consulta: async (neon) => {
      let consulta = neon.from(tabela).select(COLUNAS).order('nome')
      if (somenteAtivos) consulta = consulta.eq('ativo', true)

      const { data, error } = await consulta
      if (error) throw error
      return data ?? []
    },
  })
}

export const listarTiposVenda = ({ somenteAtivos = false } = {}) =>
  catalogo({
    tabela: 'tipos_venda',
    nome: 'tipos de venda',
    exemplos: TIPOS_EXEMPLO,
    somenteAtivos,
  })

export const listarFormasPagamento = ({ somenteAtivos = false } = {}) =>
  catalogo({
    tabela: 'formas_pagamento',
    nome: 'formas de pagamento',
    exemplos: PAGAMENTOS_EXEMPLO,
    somenteAtivos,
  })

function codigoDa(nome) {
  const codigo = String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60)

  if (!codigo) throw new Error('Informe um nome válido.')
  return codigo
}

function salvar({ tabela, nomeTabela, valores }) {
  const nome = String(valores.nome ?? '').trim()
  if (!nome) throw new Error('Informe o nome.')

  const registro = {
    codigo: valores.codigo || codigoDa(nome),
    nome,
    categoria: valores.categoria,
    ativo: valores.ativo !== false,
  }

  return gravar({
    nome: nomeTabela,
    registro,
    escrever: async (neon) => {
      const alvo = valores.id
        ? neon.from(tabela).update(registro).eq('id', valores.id)
        : neon.from(tabela).insert(registro)
      const { data, error } = await alvo.select(COLUNAS).single()
      if (error) throw error
      return data
    },
  })
}

export const salvarTipoVenda = (valores) =>
  salvar({ tabela: 'tipos_venda', nomeTabela: 'tipo de venda', valores })

export const salvarFormaPagamento = (valores) =>
  salvar({ tabela: 'formas_pagamento', nomeTabela: 'forma de pagamento', valores })

function alterarAtivo({ tabela, nome, id, ativo }) {
  const registro = { ativo: Boolean(ativo) }
  return gravar({
    nome,
    registro: { id, ...registro },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from(tabela)
        .update(registro)
        .eq('id', id)
        .select(COLUNAS)
        .single()
      if (error) throw error
      return data
    },
  })
}

export const alterarTipoVendaAtivo = ({ id, ativo }) =>
  alterarAtivo({ tabela: 'tipos_venda', nome: 'tipo de venda', id, ativo })

export const alterarFormaPagamentoAtivo = ({ id, ativo }) =>
  alterarAtivo({ tabela: 'formas_pagamento', nome: 'forma de pagamento', id, ativo })
