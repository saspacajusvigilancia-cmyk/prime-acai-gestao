import { vendas as exemplo } from '../data.js'
import { diaValido, limitesDoDia } from '../datas.js'
import {
  calcularPercentualCentavos,
  centavosParaReais,
  formatarEntradaMoeda,
  multiplicarMoedaPorQuantidade,
  paraCentavos,
  somarValoresCentavos,
} from '../numeros.js'
import { carregar, gravar, hoje, neon, neonConfigurado } from './base.js'

const hora = (iso) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** Converte a linha do banco (com os relacionamentos embutidos) para o app. */
const paraApp = (linha) => {
  const detalhes = Array.isArray(linha.venda_detalhes)
    ? linha.venda_detalhes[0]
    : linha.venda_detalhes

  return {
    uuid: linha.id,
    id: linha.codigo,
    cliente: linha.clientes?.nome ?? 'Consumidor',
    itens: linha.itens_venda?.[0]?.count ?? 0,
    subtotal: Number(linha.total),
    total: Number(detalhes?.total_cobrado ?? linha.total),
    pagamento: detalhes?.forma_pagamento_nome ?? linha.pagamento,
    tipoVenda: detalhes?.tipo_venda_nome ?? 'Não informado',
    taxaEntrega: Number(detalhes?.taxa_entrega ?? 0),
    plataforma: detalhes?.plataforma ?? null,
    pedidoExterno: detalhes?.pedido_externo ?? null,
    taxaAplicativo: Number(detalhes?.taxa_aplicativo ?? 0),
    troco: Number(detalhes?.troco ?? 0),
    comissaoEstimada: Number(detalhes?.comissao_estimada ?? 0),
    valorLiquidoEstimado: Number(detalhes?.valor_liquido_estimado ?? linha.total),
    status: linha.status,
    pagamentoStatus: linha.estornada_em
      ? 'Estornado'
      : linha.status === 'Concluída'
        ? 'Confirmado'
        : linha.status === 'Cancelada'
          ? 'Cancelado'
          : 'Pendente',
    // Preenchido só quando a venda foi estornada depois de registrada (migração
    // 11); é o que a tela usa para mostrar "Estornada" em vez de "Cancelada".
    estornadaEm: linha.estornada_em ?? null,
    hora: hora(linha.criado_em),
  }
}

const CAMPOS =
  'id, codigo, status, pagamento, total, criado_em, estornada_em, clientes(nome), itens_venda(count), venda_detalhes(tipo_venda_nome, forma_pagamento_nome, taxa_entrega, plataforma, pedido_externo, taxa_aplicativo, total_cobrado, troco, comissao_estimada, valor_liquido_estimado)'

const CAMPOS_DETALHE =
  'id, codigo, status, pagamento, total, criado_em, estornada_em, filial_id, clientes(nome), venda_detalhes(tipo_venda_nome, forma_pagamento_nome, endereco_entrega, taxa_entrega, plataforma, pedido_externo, comissao_percentual, taxa_aplicativo, total_cobrado, valor_recebido, troco, comissao_estimada, valor_liquido_estimado), itens_venda(id, produto_id, descricao, quantidade, preco_unitario, total, metodo_peso, peso_bruto_g, tara_g, peso_liquido_g, recipiente_id)'

const paraDetalhe = (linha) => {
  const detalhes = Array.isArray(linha.venda_detalhes)
    ? linha.venda_detalhes[0]
    : linha.venda_detalhes

  return {
    ...paraApp(linha),
    criadoEm: linha.criado_em,
    filialId: linha.filial_id,
    itensVenda: (linha.itens_venda ?? []).map((item) => ({
      id: item.id,
      produtoId: item.produto_id,
      descricao: item.descricao,
      quantidade: Number(item.quantidade),
      precoUnitario: Number(item.preco_unitario),
      total: Number(item.total),
      metodoPeso: item.metodo_peso,
      pesoBrutoGramas: item.peso_bruto_g == null ? null : Number(item.peso_bruto_g),
      taraGramas: item.tara_g == null ? null : Number(item.tara_g),
      pesoLiquidoGramas: item.peso_liquido_g == null ? null : Number(item.peso_liquido_g),
      recipienteId: item.recipiente_id,
    })),
    enderecoEntrega: detalhes?.endereco_entrega ?? null,
    valorRecebido: detalhes?.valor_recebido == null ? null : Number(detalhes.valor_recebido),
    comissaoPercentual: Number(detalhes?.comissao_percentual ?? 0),
  }
}

/**
 * Teto de segurança de um dia de pedidos — não é paginação.
 *
 * Um dia cheio na loja fica na casa das centenas, não dos milhares. Quando o
 * dia bate neste teto, a tela avisa que está mostrando só os mais recentes (veja
 * `LIMITE_DIA` na página de Vendas): melhor dizer que cortou do que exibir
 * "300 de 300" como se fosse o dia inteiro.
 */
export const LIMITE_DIA = 300

/**
 * Pedidos de UM dia — hoje, por padrão.
 *
 * O dia é uma data de calendário local (`AAAA-MM-DD`), não um instante: o
 * intervalo vai de 00:00 a 00:00 do dia seguinte no fuso do navegador. É o que
 * o operador chama de "os pedidos de ontem" — inclusive a venda das 23h50.
 */
export function listarVendas({ dia: diaPedido, limite = LIMITE_DIA } = {}) {
  const dia = diaValido(diaPedido) ? diaPedido : hoje()

  return carregar({
    nome: `vendas de ${dia}`,
    exemplo,
    consulta: async (neon) => {
      const { inicio, fim } = limitesDoDia(dia)

      const { data, error } = await neon
        .from('vendas')
        .select(CAMPOS)
        .gte('criado_em', inicio)
        .lt('criado_em', fim)
        .order('criado_em', { ascending: false })
        .limit(limite)

      if (error) throw error
      return (data ?? []).map(paraApp)
    },
  })
}

/** Busca os dados históricos da venda sem recalcular com cadastro atual. */
export function detalharVenda(vendaId) {
  if (!vendaId) throw new Error('Informe a venda para consultar os detalhes.')

  return carregar({
    nome: 'detalhes da venda',
    exemplo: null,
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('vendas')
        .select(CAMPOS_DETALHE)
        .eq('id', vendaId)
        .maybeSingle()

      if (error) throw error
      if (!data) throw new Error('Venda não encontrada na filial ativa.')
      return paraDetalhe(data)
    },
  })
}

/** Consulta as transições auditadas da venda, limitada à organização/filial ativa no banco. */
export function historicoStatusVenda(vendaId) {
  if (!vendaId) throw new Error('Informe a venda para consultar o histórico.')

  return carregar({
    nome: 'histórico de status da venda',
    exemplo: [],
    consulta: async (neon) => {
      const { data, error } = await neon.rpc('historico_status_venda', {
        p_venda_id: vendaId,
      })
      if (error) throw error
      return (data ?? []).map((linha) => ({
        statusAnterior: linha.status_anterior,
        statusNovo: linha.status_novo,
        motivo: linha.motivo,
        usuarioId: linha.actor_user_id,
        criadoEm: linha.criado_em,
      }))
    },
  })
}

/** Últimos pedidos, de qualquer data — usado no resumo do dashboard. */
export function listarVendasRecentes(limite = 8) {
  return carregar({
    nome: 'vendas recentes',
    exemplo: exemplo.slice(0, limite),
    consulta: async (neon) => {
      const { data, error } = await neon
        .from('vendas')
        .select(CAMPOS)
        .order('criado_em', { ascending: false })
        .limit(limite)

      if (error) throw error
      return data.map(paraApp)
    },
  })
}

/**
 * O próximo código de pedido, respondido pelo BANCO (migração 10).
 *
 * É o mesmo número que a sequência vai entregar à venda: a função lê a
 * sequência sem consumir nada. Antes a conta era feita aqui (`max(codigo) + 1`),
 * o que divergia do banco assim que um número era queimado por uma transação
 * desfeita — e quebrava quando os códigos passam de quatro dígitos, porque
 * `codigo` é TEXTO ('#10000' vem antes de '#9999').
 *
 * Continua sendo só uma sugestão: o campo nasce vazio e quem numera é o banco.
 */
export async function proximoCodigoVenda() {
  if (!neonConfigurado) return '#4822'

  const { data, error } = await neon.rpc('proximo_codigo_venda')
  if (error) throw error
  if (typeof data === 'string' && data.startsWith('#')) return data
  throw new Error(`O banco devolveu um próximo código inválido: ${String(JSON.stringify(data)).slice(0, 40)}`)
}

/**
 * Registra a venda inteira pela RPC `registrar_venda` (migração 08).
 *
 * Antes eram três viagens ao banco — INSERT da venda, INSERT dos itens e, se os
 * itens falhassem, DELETE da venda — sem transação, sem estoque e com o total
 * calculado em ponto flutuante no navegador.
 *
 * Agora quem grava é uma função do banco: venda, itens, pesos, total e os
 * movimentos de estoque acontecem juntos, ou nada acontece.
 *
 * `chave` é o selo de idempotência: o formulário gera uma por abertura, e
 * repetir a mesma chave (clique duplo, rede que repetiu o POST, operador que
 * tentou de novo depois de um erro) devolve a MESMA venda em vez de criar
 * outra — e não baixa o estoque duas vezes. Chave nova é venda nova: duas
 * compras iguais são dois pedidos.
 *
 * O preço NÃO vai no corpo da requisição: o banco lê `produtos.preco`, grava
 * uma cópia no item (mudar o cadastro depois não reescreve o passado) e devolve
 * o total que ele mesmo calculou.
 */
export function registrarVenda({
  codigo,
  chave,
  clienteId,
  clienteNome,
  tipoVendaId,
  tipoVendaNome,
  formaPagamentoId,
  formaPagamentoNome,
  formaPagamentoCategoria,
  enderecoEntrega,
  taxaEntrega = 0,
  plataforma,
  pedidoExterno,
  comissaoPercentual = 0,
  taxaAplicativo = 0,
  valorRecebido,
  pagamento,
  itens,
}) {
  // Total só para a tela: sem banco, é o que aparece no aviso de "entrou só
  // nesta sessão". Com banco, o total que vale — e que volta para a tela — é o
  // que o próprio banco calculou (mesma conta, em `numeric`).
  const centavos = somarValoresCentavos(itens.map((item) => {
    const preco = Number(item.precoUnitario ?? 0)
    const quantidade = item.metodoPeso
      ? Number(item.pesoLiquidoGramas ?? 0) / 1000
      : Number(item.quantidade ?? 0)
    const parcela = multiplicarMoedaPorQuantidade(preco, quantidade)
    if (!Number.isSafeInteger(parcela)) throw new Error('Um item da venda tem preço ou quantidade inválidos.')
    return parcela
  }))
  if (!Number.isSafeInteger(centavos)) throw new Error('O total da venda excede o limite monetário permitido.')
  const totalEstimado = centavosParaReais(centavos)
  const entregaCentavos = taxaEntrega === '' || taxaEntrega == null ? 0 : paraCentavos(taxaEntrega)
  const taxaAplicativoCentavos =
    taxaAplicativo === '' || taxaAplicativo == null ? 0 : paraCentavos(taxaAplicativo)
  if (!Number.isSafeInteger(entregaCentavos) || entregaCentavos < 0) {
    throw new Error('A taxa de entrega precisa ser um valor monetário válido e não negativo.')
  }
  if (!Number.isSafeInteger(taxaAplicativoCentavos) || taxaAplicativoCentavos < 0) {
    throw new Error('A taxa do aplicativo precisa ser um valor monetário válido e não negativo.')
  }
  const totalCobradoCentavos = centavos + entregaCentavos
  if (!Number.isSafeInteger(totalCobradoCentavos)) {
    throw new Error('O total da venda excede o limite monetário permitido.')
  }
  const totalCobradoEstimado = centavosParaReais(totalCobradoCentavos)
  const recebido = valorRecebido === '' || valorRecebido == null ? Number.NaN : paraCentavos(valorRecebido)
  if (!Number.isNaN(recebido) && (!Number.isSafeInteger(recebido) || recebido < 0)) {
    throw new Error('O valor recebido precisa ser monetário válido e não negativo.')
  }
  const trocoEstimado =
    formaPagamentoCategoria === 'dinheiro' && Number.isSafeInteger(recebido)
      ? centavosParaReais(Math.max(0, recebido - totalCobradoCentavos))
      : 0
  const comissaoCentavos =
    formaPagamentoCategoria === 'aplicativo'
      ? calcularPercentualCentavos(totalCobradoCentavos, Number(comissaoPercentual || 0))
      : 0
  const liquidoEstimado = centavosParaReais(
    Math.max(0, totalCobradoCentavos - comissaoCentavos - taxaAplicativoCentavos),
  )
  const comissaoEstimativa = centavosParaReais(comissaoCentavos)
  const entrega = centavosParaReais(entregaCentavos)
  const taxaAplicativoValor = centavosParaReais(taxaAplicativoCentavos)

  // A linha por peso manda o que foi lido na balança; a linha por unidade
  // manda a quantidade. Em nenhuma das duas o preço sai do navegador.
  const linhas = itens.map((item) =>
    item.metodoPeso
      ? {
          produto_id: item.produtoId,
          metodo_peso: item.metodoPeso,
          peso_bruto_g: item.pesoBrutoGramas,
          tara_g: item.taraGramas,
          peso_liquido_g: item.pesoLiquidoGramas,
          recipiente_id: item.recipienteId,
        }
      : { produto_id: item.produtoId, quantidade: item.quantidade },
  )

  const agora = new Date()

  const paraTela = (linha) => ({
    uuid: linha.id ?? null,
    id: linha.codigo,
    cliente: clienteNome || 'Consumidor',
    itens: Number(linha.itens ?? linhas.length),
    subtotal: Number(linha.total ?? totalEstimado),
    total: Number(linha.total_cobrado ?? totalCobradoEstimado),
    pagamento: linha.forma_pagamento ?? formaPagamentoNome ?? pagamento,
    tipoVenda: linha.tipo_venda ?? tipoVendaNome ?? 'Balcão',
    taxaEntrega: entrega,
    plataforma: plataforma || null,
    pedidoExterno: pedidoExterno || null,
    taxaAplicativo: taxaAplicativoValor,
    troco: Number(linha.troco ?? trocoEstimado),
    comissaoEstimada: Number(linha.comissao_estimada ?? comissaoEstimativa),
    valorLiquidoEstimado: Number(linha.valor_liquido_estimado ?? liquidoEstimado),
    status: linha.status ?? 'Aguardando',
    hora: hora(linha.criado_em ?? agora.toISOString()),
    jaExistia: Boolean(linha.ja_existia),
    movimentos: Number(linha.movimentos ?? 0),
  })

  const registro = paraTela({
    // Sem banco não existe sequência de pedido: o número mostrado é local e só
    // vale nesta sessão (o aviso da tela diz exatamente isso).
    codigo: String(codigo ?? '').trim() || `#${String(agora.getTime()).slice(-5)}`,
    total: totalEstimado,
    pagamento,
    status: 'Aguardando',
    criado_em: agora.toISOString(),
    total_cobrado: totalCobradoEstimado,
    forma_pagamento: formaPagamentoNome,
    tipo_venda: tipoVendaNome,
    troco: trocoEstimado,
    comissao_estimada: comissaoEstimativa,
    valor_liquido_estimado: liquidoEstimado,
  })

  return gravar({
    nome: 'venda',
    exigirPersistencia: true,
    registro,
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('registrar_venda_completa', {
        p_itens: linhas,
        p_chave: chave || null,
        p_cliente_id: clienteId || null,
        p_tipo_venda_id: tipoVendaId,
        p_forma_pagamento_id: formaPagamentoId,
        p_status: 'Aguardando',
        p_codigo: String(codigo ?? '').trim() || null,
        p_endereco_entrega: enderecoEntrega || null,
        p_taxa_entrega: entrega,
        p_plataforma: plataforma || null,
        p_pedido_externo: pedidoExterno || null,
        p_comissao_percentual: Number(comissaoPercentual || 0),
        p_taxa_aplicativo: taxaAplicativoValor,
        p_valor_recebido: Number.isSafeInteger(recebido) ? centavosParaReais(recebido) : null,
      })

      if (error) throw error

      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não devolveu a venda registrada.')

      return paraTela(linha)
    },
  })
}

/** Atualiza o status usando transições permitidas e auditadas pelo banco. */
export function atualizarStatusVenda({ vendaId, codigo, novoStatus }) {
  if ((!vendaId && (neonConfigurado || !codigo)) || !['Em preparo', 'Concluída'].includes(novoStatus)) {
    throw new Error('Informe uma venda e um status de destino válido.')
  }

  return gravar({
    nome: 'status da venda',
    exigirPersistencia: true,
    registro: {
      vendaId,
      codigo,
      status: novoStatus,
      jaEstavaAtualizado: false,
    },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('atualizar_status_venda', {
        p_venda_id: vendaId,
        p_novo_status: novoStatus,
      })
      if (error) throw error

      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não devolveu a atualização de status.')
      return {
        vendaId: linha.venda_id,
        codigo: linha.codigo,
        status: linha.status,
        jaEstavaAtualizado: Boolean(linha.ja_estava_atualizado),
      }
    },
  })
}

/** Cancela uma venda ainda não concluída e reverte o movimento de estoque uma única vez. */
export function cancelarVendaPendente({ vendaId, codigo, motivo }) {
  const justificativa = String(motivo ?? '').trim()
  if ((!vendaId && (neonConfigurado || !codigo)) || !justificativa) {
    throw new Error('Informe a venda e o motivo do cancelamento.')
  }

  return gravar({
    nome: 'cancelamento da venda',
    exigirPersistencia: true,
    registro: {
      vendaId,
      codigo,
      status: 'Cancelada',
      movimentos: 0,
      jaCancelada: false,
    },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('cancelar_venda_pendente', {
        p_venda_id: vendaId,
        p_motivo: justificativa,
      })
      if (error) throw error

      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não devolveu o cancelamento.')
      return {
        vendaId: linha.venda_id,
        codigo: linha.codigo,
        status: linha.status,
        movimentos: Number(linha.movimentos ?? 0),
        jaCancelada: Boolean(linha.ja_cancelada),
      }
    },
  })
}

/**
 * Estorna a venda pela RPC `estornar_venda` (migração 11).
 *
 * Estornar não apaga: o livro-razão do estoque é imutável. O banco registra o
 * movimento INVERSO (cliente -> estoque), cancela o pedido e guarda quem
 * estornou, quando e por quê. Por isso o motivo sobe junto — sem ele o estorno
 * não se audita depois.
 *
 * Quem decide é o banco (`vendas.editar`): a tela só esconde o botão de quem
 * não pode. Repetir um estorno que já aconteceu devolve o mesmo resultado, sem
 * devolver o estoque duas vezes.
 */
export function estornarVenda({ vendaId, codigo, motivo }) {
  return gravar({
    nome: 'estorno',
    exigirPersistencia: true,
    // Modo demonstração: o registro devolvido é o que a tela mostraria.
    registro: {
      id: codigo ?? '',
      status: 'Cancelada',
      total: 0,
      movimentos: 0,
      jaEstornada: false,
      estornadaEm: new Date().toISOString(),
    },
    escrever: async (neon) => {
      const { data, error } = await neon.rpc('estornar_venda', {
        p_venda_id: vendaId,
        p_motivo: motivo,
      })

      if (error) throw error

      const linha = Array.isArray(data) ? data[0] : data
      if (!linha) throw new Error('O banco não devolveu o estorno.')

      return {
        id: linha.codigo,
        status: linha.status,
        total: Number(linha.total ?? 0),
        movimentos: Number(linha.movimentos ?? 0),
        jaEstornada: Boolean(linha.ja_estornada),
        estornadaEm: linha.estornada_em ?? null,
      }
    },
  })
}

/**
 * CSV compatível com Excel brasileiro (BOM + ponto e vírgula).
 *
 * Exporta o que a tela está mostrando — já filtrado pela busca e pelo dia — e
 * usa o mesmo rótulo da tabela para o estorno, para o arquivo não confundir uma
 * venda estornada com um pedido que nasceu cancelado.
 */
export function gerarCsvVendas(vendas = []) {
  const cabecalho = [
    'Pedido',
    'Cliente',
    'Itens',
    'Hora',
    'Tipo',
    'Plataforma',
    'Pedido no aplicativo',
    'Pagamento',
    'Taxa de entrega (R$)',
    'Total (R$)',
    'Comissão (R$)',
    'Líquido estimado (R$)',
    'Status',
  ]

  const escapar = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`

  const linhas = vendas.map((venda) => [
    venda.id,
    venda.cliente,
    venda.itens,
    venda.hora,
    venda.tipoVenda ?? '—',
    venda.plataforma ?? '',
    venda.pedidoExterno ?? '',
    venda.pagamento,
    formatarEntradaMoeda(venda.taxaEntrega ?? 0),
    formatarEntradaMoeda(venda.total ?? 0),
    formatarEntradaMoeda(venda.comissaoEstimada ?? 0),
    formatarEntradaMoeda(venda.valorLiquidoEstimado ?? 0),
    venda.estornadaEm ? 'Estornada' : (venda.status ?? ''),
  ])

  return `\uFEFF${[cabecalho, ...linhas].map((linha) => linha.map(escapar).join(';')).join('\r\n')}`
}
