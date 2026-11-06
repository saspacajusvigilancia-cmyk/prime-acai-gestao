import { resumo as resumoExemplo, vendas as vendasExemplo } from '../data.js'
import { diaValido, rotuloDia, somarDias } from '../datas.js'
import { abrirFormulario, fechar } from '../formulario.js'
import { centavosParaReais, paraCentavos } from '../numeros.js'
import { renderIcons } from '../icons.js'
import { hoje, observar } from '../services/base.js'
import { listarClientes } from '../services/clientes.js'
import { pode } from '../services/permissoes.js'
import { listarProdutos } from '../services/produtos.js'
import { listarRecipientes } from '../services/recipientes.js'
import { carregarImagemProduto, listarImagensProdutos } from '../services/imagens-produtos.js'
import { listarFormasPagamento, listarTiposVenda } from '../services/config-vendas.js'
import { carregarResumo } from '../services/resumo.js'
import {
  estornarVenda,
  gerarCsvVendas,
  LIMITE_DIA,
  listarVendas,
  proximoCodigoVenda,
  atualizarStatusVenda,
  cancelarVendaPendente,
  detalharVenda,
  historicoStatusVenda,
  registrarVenda,
} from '../services/vendas.js'
import {
  atualizarKpi,
  atualizarTabela,
  badgeStatusVenda,
  baixarCsv,
  botaoPrimario,
  cardHead,
  esc,
  formatBRL,
  formatNumero,
  statCard,
  tabela,
  toast,
  toolbar,
} from '../ui.js'

/**
 * Ações da linha dependem do estado: concluir também confirma o recebimento;
 * vendas pendentes podem ser canceladas; somente as concluídas podem ser
 * estornadas. A permissão é conferida novamente pelo banco.
 */
const acoesVenda = (v, podeEditar) => `
  <div class="table__acoes">
    <button class="btn btn--ghost btn--sm" type="button" data-acao="detalhes-venda"
            data-id="${esc(v.uuid ?? v.id)}" aria-label="Ver detalhes da venda ${esc(v.id ?? '')}">
      <i data-lucide="eye"></i><span>Detalhes</span>
    </button>
    ${!podeEditar || v.estornadaEm || v.status === 'Cancelada' ? '' : `
      ${v.status === 'Aguardando' ? `
        <button class="btn btn--ghost btn--sm" type="button" data-acao="preparar-venda"
                data-id="${esc(v.uuid ?? v.id)}">
          <i data-lucide="cooking-pot"></i><span>Iniciar preparo</span>
        </button>
      ` : ''}
      ${['Aguardando', 'Em preparo'].includes(v.status) ? `
        <button class="btn btn--primary btn--sm" type="button" data-acao="concluir-venda"
                data-id="${esc(v.uuid ?? v.id)}" title="Confirma o recebimento integral e conclui a venda">
          <i data-lucide="circle-check"></i><span>Confirmar pagamento</span>
        </button>
        <button class="btn btn--ghost btn--sm" type="button" data-acao="cancelar-venda"
                data-id="${esc(v.uuid ?? v.id)}">
          <i data-lucide="ban"></i><span>Cancelar</span>
        </button>
      ` : ''}
      ${v.status === 'Concluída' ? `
        <button class="btn btn--ghost btn--sm" type="button" data-acao="estornar-venda"
                data-id="${esc(v.uuid ?? v.id)}" title="Estornar e devolver o estoque">
          <i data-lucide="rotate-ccw"></i><span>Estornar</span>
        </button>
      ` : ''}
    `}
  </div>
`

/**
 * Colunas da tabela de vendas. A coluna de Ações só existe para quem pode
 * estornar: para os demais, a tabela é a de antes — sem coluna vazia.
 */
const colunas = ({ podeEditar = false } = {}) => [
  { key: 'id', label: 'Pedido', render: (v) => `<span class="mono">${esc(v.id)}</span>` },
  {
    key: 'cliente',
    label: 'Cliente',
    render: (v) => `
      <span class="cell-main">${esc(v.cliente)}</span>
      <span class="cell-sub">${v.itens} ${v.itens === 1 ? 'item' : 'itens'}</span>
    `,
  },
  { key: 'hora', label: 'Hora', render: (v) => `<span class="muted">${esc(v.hora)}</span>` },
  {
    key: 'tipoVenda',
    label: 'Tipo',
    render: (v) => `
      <span class="cell-main">${esc(v.tipoVenda ?? '—')}</span>
      ${v.plataforma ? `<span class="cell-sub">${esc(v.plataforma)}${v.pedidoExterno ? ` · ${esc(v.pedidoExterno)}` : ''}</span>` : ''}
      ${v.taxaEntrega ? `<span class="cell-sub">Entrega: ${formatBRL(v.taxaEntrega)}</span>` : ''}
      ${v.tipoVenda === 'Aplicativo' ? `<span class="cell-sub">Líquido est.: ${formatBRL(v.valorLiquidoEstimado ?? 0)} · Comissão: ${formatBRL(v.comissaoEstimada ?? 0)}</span>` : ''}
    `,
  },
  {
    key: 'pagamento',
    label: 'Pagamento',
    render: (v) => `
      <span class="cell-main">${esc(v.pagamento)}</span>
      <span class="cell-sub">${esc(v.pagamentoStatus ?? 'Pendente')}</span>
    `,
  },
  {
    key: 'total',
    label: 'Total',
    align: 'right',
    render: (v) => `<strong>${formatBRL(v.total)}</strong>`,
  },
  { key: 'status', label: 'Status', render: badgeStatusVenda },
  { key: 'acoes', label: 'Ações', render: (v) => acoesVenda(v, podeEditar) },
]

const filtrar = (dados, termo, filtros = {}) => {
  const busca = termo.trim().toLowerCase()
  return dados.filter((venda) =>
    (!busca ||
      [venda.id, venda.cliente, venda.pagamento, venda.tipoVenda, venda.plataforma, venda.pedidoExterno, venda.status]
        .join(' ')
        .toLowerCase()
        .includes(busca)) &&
    (!filtros.status || (venda.estornadaEm ? 'Estornada' : venda.status) === filtros.status) &&
    (!filtros.pagamento || venda.pagamento === filtros.pagamento) &&
    (!filtros.canal ||
      (filtros.canal.startsWith('tipo:')
        ? venda.tipoVenda === filtros.canal.slice('tipo:'.length)
        : filtros.canal.startsWith('plataforma:') &&
          venda.plataforma === filtros.canal.slice('plataforma:'.length))),
  )
}

const totalEmCentavos = (venda) => {
  if (venda.total == null || venda.total === '') return null
  const valor = Number(venda.total)
  const centavos = Math.round(valor * 100)
  return Number.isFinite(valor) && Number.isSafeInteger(centavos) ? centavos : null
}

const agruparVendas = (dados, campo) => {
  const grupos = new Map()
  for (const venda of dados) {
    const rotulo =
      campo === 'status'
        ? venda.estornadaEm
          ? 'Estornada'
          : venda.status || 'Não informado'
        : venda[campo] || 'Não informado'
    const grupo = grupos.get(rotulo) ?? { quantidade: 0, centavos: 0, valoresValidos: true }
    const centavos = totalEmCentavos(venda)
    if (centavos == null) {
      grupo.valoresValidos = false
    } else {
      grupo.centavos += centavos
      if (!Number.isSafeInteger(grupo.centavos)) grupo.valoresValidos = false
    }
    grupo.quantidade += 1
    grupos.set(rotulo, grupo)
  }
  return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
}

const formatarDataRelatorio = (dia) =>
  new Intl.DateTimeFormat('pt-BR').format(new Date(`${dia}T12:00:00`))

/**
 * Selo de idempotência da venda (ver `registrarVenda`).
 *
 * Uma chave por abertura do formulário: se o POST chegar duas vezes — clique
 * duplo, rede que repetiu, operador que tentou de novo depois de um erro — a
 * segunda volta traz a venda que já foi gravada, em vez de criar outra.
 */
const novaChave = () =>
  globalThis.crypto?.randomUUID?.() ??
  `venda-${Date.now()}-${Math.random().toString(16).slice(2)}`

export function vendasPage() {
  const podeEditar = pode('vendas', 'editar')
  const colunasVenda = colunas({ podeEditar })

  return {
    html: `
      <section class="grid grid--stats">
        ${statCard({
          kpi: 'vendasHoje',
          label: 'Vendas hoje',
          valor: resumoExemplo.vendasHoje,
          delta: resumoExemplo.vendasHojeDelta,
          icon: 'clipboard-list',
          hint: 'Pedidos registrados',
        })}
        ${statCard({
          kpi: 'faturamentoHoje',
          label: 'Faturamento hoje',
          valor: formatBRL(resumoExemplo.faturamentoHoje),
          delta: resumoExemplo.faturamentoHojeDelta,
          icon: 'circle-dollar-sign',
          hint: 'Antes de taxas de cartão',
        })}
        ${statCard({
          kpi: 'ticketMedio',
          label: 'Ticket médio',
          valor: formatBRL(resumoExemplo.ticketMedio),
          delta: resumoExemplo.ticketMedioDelta,
          icon: 'trending-up',
          hint: 'Média por pedido',
        })}
        ${statCard({
          kpi: 'cancelamentos',
          label: 'Cancelamentos',
          valor: resumoExemplo.cancelamentos,
          icon: 'alert-triangle',
          hint: 'Pedidos cancelados hoje',
        })}
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Pedidos',
          descricao: podeEditar
            ? 'Acompanhe pedidos, confirme pagamentos e gerencie preparo, cancelamentos e estornos'
            : 'Escolha o dia e acompanhe os pedidos',
          acoes: `
            <button class="btn btn--ghost" type="button" data-acao="exportar-vendas"
                    title="Baixar os pedidos do dia em CSV">
              <i data-lucide="clipboard-list"></i><span>Exportar CSV</span>
            </button>
            ${botaoPrimario({ label: 'Nova venda', icon: 'plus', acao: 'nova-venda' })}
          `,
        })}
        ${toolbar({
          buscaId: 'busca-vendas',
          placeholder: 'Buscar por pedido, cliente ou pagamento...',
          // O dia vem antes da busca: é o filtro que dá sentido à lista.
          filtros: `
            <div class="dia-nav" role="group" aria-label="Dia dos pedidos">
              <button class="btn btn--ghost btn--sm" type="button" data-dia="-1"
                      title="Dia anterior" aria-label="Dia anterior">
                <i data-lucide="chevron-left"></i>
              </button>
              <input class="dia-nav__campo" id="dia-vendas" type="date"
                     value="${hoje()}" max="${hoje()}" aria-label="Dia dos pedidos" />
              <button class="btn btn--ghost btn--sm" type="button" data-dia="1"
                      title="Próximo dia" aria-label="Próximo dia">
                <i data-lucide="chevron-right"></i>
              </button>
              <button class="btn btn--ghost btn--sm" type="button" data-acao="dia-hoje">Hoje</button>
            </div>
            <label class="campo" for="filtro-vendas-status">
              <span class="campo__label">Status</span>
              <select class="campo__input" id="filtro-vendas-status">
                <option value="">Todos</option>
              </select>
            </label>
            <label class="campo" for="filtro-vendas-canal">
              <span class="campo__label">Canal / origem</span>
              <select class="campo__input" id="filtro-vendas-canal">
                <option value="">Todos</option>
              </select>
            </label>
            <label class="campo" for="filtro-vendas-pagamento">
              <span class="campo__label">Forma de pagamento</span>
              <select class="campo__input" id="filtro-vendas-pagamento">
                <option value="">Todas</option>
              </select>
            </label>
          `,
        })}
        <p class="table__count" id="contagem-vendas"></p>
        ${tabela({ colunas: colunasVenda, linhas: vendasExemplo, id: 'tabela-vendas' })}
      </section>

      <section class="card" id="relatorio-vendas" aria-labelledby="relatorio-vendas-titulo">
        <div class="card__head">
          <div>
            <h2 class="card__title" id="relatorio-vendas-titulo">Relatório de vendas</h2>
            <p class="card__desc">Resumo dos mesmos pedidos carregados na tabela, considerando o dia e os filtros atuais. Não realiza uma consulta adicional.</p>
          </div>
        </div>
        <dl class="vendas-relatorio__metadados" id="relatorio-vendas-metadados"></dl>
        <div class="vendas-relatorio__resumo" id="relatorio-vendas-resumo"></div>
        <p class="campo__ajuda">Os totais são a soma dos valores exibidos por status; não recalculam estornos, taxas, liquidações nem substituem relatório financeiro ou conciliação.</p>
        <div class="vendas-relatorio__grupos" id="relatorio-vendas-grupos"></div>
      </section>
    `,

    mount(root) {
      let dados = vendasExemplo
      // O dia mostrado. Nasce em hoje; a navegação troca e busca de novo.
      let dia = hoje()
      let diaCarregado = dia

      const contagem = root.querySelector('#contagem-vendas')
      const input = root.querySelector('#busca-vendas')
      const campoDia = root.querySelector('#dia-vendas')
      const botaoHoje = root.querySelector('[data-acao="dia-hoje"]')
      const botaoProximo = root.querySelector('[data-dia="1"]')
      const botaoExportar = root.querySelector('[data-acao="exportar-vendas"]')
      const filtroStatus = root.querySelector('#filtro-vendas-status')
      const filtroCanal = root.querySelector('#filtro-vendas-canal')
      const filtroPagamento = root.querySelector('#filtro-vendas-pagamento')
      const relatorioMetadados = root.querySelector('#relatorio-vendas-metadados')
      const relatorioResumo = root.querySelector('#relatorio-vendas-resumo')
      const relatorioGrupos = root.querySelector('#relatorio-vendas-grupos')
      const seletorFilial = document.querySelector('#filial-atual')
      let origemDados = 'exemplo'
      let modalDetalhes = null

      const reconstruirOpcoes = (campo, opcoes, todos) => {
        const selecionado = campo.value
        const unicas = [...new Map(opcoes.filter((opcao) => opcao.valor).map((opcao) => [opcao.valor, opcao])).values()]
          .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
        campo.innerHTML = `<option value="">${todos}</option>${unicas
          .map(({ valor, rotulo }) => `<option value="${esc(valor)}">${esc(rotulo)}</option>`)
          .join('')}`
        campo.value = unicas.some(({ valor }) => valor === selecionado) ? selecionado : ''
      }

      const atualizarOpcoesFiltros = () => {
        reconstruirOpcoes(
          filtroStatus,
          dados.map((venda) => {
            const valor = venda.estornadaEm ? 'Estornada' : venda.status
            return { valor, rotulo: valor }
          }),
          'Todos',
        )
        reconstruirOpcoes(
          filtroCanal,
          dados.flatMap((venda) => [
            { valor: venda.tipoVenda ? `tipo:${venda.tipoVenda}` : '', rotulo: `Tipo · ${venda.tipoVenda ?? ''}` },
            { valor: venda.plataforma ? `plataforma:${venda.plataforma}` : '', rotulo: `Plataforma · ${venda.plataforma ?? ''}` },
          ]),
          'Todos',
        )
        reconstruirOpcoes(
          filtroPagamento,
          dados.map((venda) => ({ valor: venda.pagamento, rotulo: venda.pagamento })),
          'Todas',
        )
      }

      const filtrosAtuais = () => ({
        status: filtroStatus.value,
        canal: filtroCanal.value,
        pagamento: filtroPagamento.value,
      })

      const atualizarRelatorio = (linhas) => {
        const filialIndicada = seletorFilial?.value
          ? seletorFilial.selectedOptions[0]?.textContent?.trim() ?? 'Não informada no cabeçalho'
          : 'Não informada no cabeçalho'
        const filtros = [
          input.value.trim() ? `Busca: ${input.value.trim()}` : '',
          filtroStatus.value ? `Status: ${filtroStatus.selectedOptions[0]?.textContent}` : '',
          filtroCanal.value ? `Canal/origem: ${filtroCanal.selectedOptions[0]?.textContent}` : '',
          filtroPagamento.value ? `Pagamento: ${filtroPagamento.selectedOptions[0]?.textContent}` : '',
        ].filter(Boolean)
        const valoresEmCentavos = linhas.map(totalEmCentavos)
        const totalCentavos = valoresEmCentavos.reduce((soma, valor) => soma + (valor ?? 0), 0)
        const totaisValidos =
          valoresEmCentavos.every((valor) => valor != null) && Number.isSafeInteger(totalCentavos)
        const limiteAtingido = dados.length >= LIMITE_DIA
        const cobertura =
          origemDados !== 'neon'
            ? `Demonstração; não representa dados operacionais.${limiteAtingido ? ` O teto de ${LIMITE_DIA} registros carregados também foi atingido; a amostra pode estar incompleta.` : ''}`
            : limiteAtingido
              ? `Parcial: até ${LIMITE_DIA} pedidos mais recentes; o dia pode conter outros pedidos.`
              : `Consulta do dia abaixo do limite de ${LIMITE_DIA}; sem consolidação de outros períodos.`

        relatorioMetadados.innerHTML = `
          <div><dt>Período consultado</dt><dd>${esc(formatarDataRelatorio(diaCarregado))}</dd></div>
          <div><dt>Filial indicada no cabeçalho</dt><dd>${esc(filialIndicada)}</dd></div>
          <div><dt>Gerado em</dt><dd>${esc(new Date().toLocaleString('pt-BR'))}</dd></div>
          <div><dt>Origem dos dados</dt><dd>${origemDados === 'neon' ? 'Neon Data API' : 'Dados de demonstração'}</dd></div>
          <div><dt>Cobertura</dt><dd>${esc(cobertura)}</dd></div>
          <div><dt>Filtros aplicados</dt><dd>${esc(filtros.length ? filtros.join(' · ') : 'Nenhum além do dia selecionado')}</dd></div>
        `
        relatorioResumo.innerHTML = `
          <div><span>Pedidos no resultado</span><strong>${linhas.length}</strong></div>
          <div><span>Soma dos valores listados</span><strong>${totaisValidos ? formatBRL(totalCentavos / 100) : '—'}</strong></div>
        `
        const tabelaGrupo = (titulo, campo) => {
          const grupos = agruparVendas(linhas, campo)
          return `
            <section>
              <h3>${titulo}</h3>
              ${grupos.length
                ? `<div class="table-wrap"><table class="table"><thead><tr><th>${campo === 'status' ? 'Status' : 'Pagamento'}</th><th>Pedidos</th><th class="ta-right">Soma dos valores</th></tr></thead><tbody>${grupos
                  .map(([rotulo, grupo]) => `<tr><td>${esc(rotulo)}</td><td>${grupo.quantidade}</td><td class="ta-right">${grupo.valoresValidos ? formatBRL(grupo.centavos / 100) : '—'}</td></tr>`)
                  .join('')}</tbody></table></div>`
                : '<p class="muted">Nenhum pedido com os filtros atuais.</p>'}
            </section>
          `
        }
        relatorioGrupos.innerHTML = `${tabelaGrupo('Pedidos por status', 'status')}${tabelaGrupo('Pedidos por forma de pagamento', 'pagamento')}`
      }

      const aplicar = (termo) => {
        const linhas = filtrar(dados, termo, filtrosAtuais())
        atualizarTabela(root, 'tabela-vendas', colunasVenda, linhas)
        // O rótulo do dia fica junto da contagem: é ele que diz ao operador que
        // a lista NÃO é a de hoje quando ele navegou para outro dia.
        //
        // Quando o dia bate o teto da consulta, os carregados são os MAIS
        // RECENTES (a consulta ordena de trás para frente) — e "300 de 300"
        // sozinho faria o operador achar que o dia teve 300 pedidos.
        const cortado = dados.length >= LIMITE_DIA ? ' · mostrando os mais recentes' : ''
        contagem.textContent = `${rotuloDia(diaCarregado, hoje())} · ${linhas.length} de ${dados.length} pedidos${cortado}`
        botaoExportar.disabled = dia !== diaCarregado
        botaoExportar.title = cortado
          ? 'Exportação indisponível: o dia atingiu o limite de 300 pedidos e pode estar incompleto.'
          : 'Baixar em CSV os pedidos carregados com os filtros atuais.'
        atualizarRelatorio(linhas)
        renderIcons(root)
        ligarAcoes()
      }

      atualizarOpcoesFiltros()
      aplicar('')
      const observarFilial = seletorFilial && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => aplicar(input.value))
        : null
      observarFilial?.observe(seletorFilial, { childList: true })

      input.addEventListener('input', () => aplicar(input.value))
      filtroStatus.addEventListener('change', () => aplicar(input.value))
      filtroCanal.addEventListener('change', () => aplicar(input.value))
      filtroPagamento.addEventListener('change', () => aplicar(input.value))

      // Exporta exatamente o resultado carregado depois da busca e dos filtros locais.
      root.querySelector('[data-acao="exportar-vendas"]').addEventListener('click', () => {
        const linhas = filtrar(dados, input.value, filtrosAtuais())
        if (!linhas.length) {
          toast('Nada para exportar com os filtros atuais.')
          return
        }
        if (dados.length >= LIMITE_DIA) {
          toast('Exportação bloqueada: o dia atingiu o limite de 300 pedidos e pode estar incompleto.')
          return
        }
        baixarCsv(`vendas-${diaCarregado}.csv`, gerarCsvVendas(linhas))
      })

      // A busca da barra superior também filtra esta tabela.
      const aoBuscarGlobal = (evento) => {
        input.value = evento.detail
        aplicar(evento.detail)
      }
      window.addEventListener('busca-global', aoBuscarGlobal)

      const aplicarResumo = (r) => {
        atualizarKpi(root, 'vendasHoje', { valor: r.vendasHoje, delta: r.vendasHojeDelta })
        atualizarKpi(root, 'faturamentoHoje', {
          valor: formatBRL(r.faturamentoHoje),
          delta: r.faturamentoHojeDelta,
        })
        atualizarKpi(root, 'ticketMedio', {
          valor: formatBRL(r.ticketMedio),
          delta: r.ticketMedioDelta,
        })
        atualizarKpi(root, 'cancelamentos', { valor: r.cancelamentos })
      }

      const diaInicial = dia
      const pararVendas = observar(listarVendas({ dia: diaInicial }), ({ dados: remotas, origem }) => {
        // O operador pode ter trocado o dia enquanto esta resposta vinha: a
        // resposta antiga não pode sobrescrever a lista do dia novo.
        if (dia !== diaInicial) return
        dados = remotas
        origemDados = origem
        diaCarregado = diaInicial
        atualizarOpcoesFiltros()
        aplicar(input.value)
      })

      const pararResumo = observar(carregarResumo(), ({ dados: r }) => aplicarResumo(r))

      /** Busca o dia escolhido e redesenha — ao navegar e depois de gravar. */
      const recarregar = async () => {
        const pedido = dia
        const [{ dados: remotas, origem }, { dados: r }] = await Promise.all([
          listarVendas({ dia: pedido }),
          carregarResumo(),
        ])

        // Dois cliques rápidos em "dia anterior": só a resposta do último vale.
        if (dia !== pedido) return

        dados = remotas
        origemDados = origem
        diaCarregado = pedido
        atualizarOpcoesFiltros()
        aplicar(input.value)
        aplicarResumo(r)
      }

      /** Deixa os controles coerentes com o dia (não existe pedido no futuro). */
      const ajustarDia = () => {
        const limite = hoje()
        campoDia.value = dia
        campoDia.max = limite
        botaoProximo.disabled = dia >= limite
        botaoHoje.disabled = dia >= limite
      }

      /** Troca o dia e busca de novo. */
      const irPara = async (novo) => {
        const alvo = diaValido(novo) ? novo : hoje()
        if (alvo === dia) {
          ajustarDia()
          return
        }

        dia = alvo
        botaoExportar.disabled = true
        ajustarDia()
        await recarregar()
      }

      campoDia.addEventListener('change', () => irPara(campoDia.value))
      botaoHoje.addEventListener('click', () => irPara(hoje()))
      root.querySelectorAll('[data-dia]').forEach((botao) => {
        botao.addEventListener('click', () => irPara(somarDias(dia, Number(botao.dataset.dia))))
      })

      ajustarDia()

      /** (Re)liga os botões da tabela: cada redesenho troca os botões antigos. */
      function ligarAcoes() {
        root.querySelectorAll('[data-acao="estornar-venda"]').forEach((btn) => {
          btn.addEventListener('click', () => estornar(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="preparar-venda"]').forEach((btn) => {
          btn.addEventListener('click', () => alterarStatus(btn.dataset.id, 'Em preparo'))
        })
        root.querySelectorAll('[data-acao="concluir-venda"]').forEach((btn) => {
          btn.addEventListener('click', () => alterarStatus(btn.dataset.id, 'Concluída'))
        })
        root.querySelectorAll('[data-acao="cancelar-venda"]').forEach((btn) => {
          btn.addEventListener('click', () => cancelar(btn.dataset.id))
        })
        root.querySelectorAll('[data-acao="detalhes-venda"]').forEach((btn) => {
          btn.addEventListener('click', () => verDetalhes(btn.dataset.id))
        })
      }

      async function alterarStatus(vendaId, novoStatus) {
        const venda = dados.find((item) => (item.uuid ?? item.id) === vendaId)
        if (!venda) return

        try {
          const { dados: resultado, origem } = await atualizarStatusVenda({
            vendaId: venda.uuid ?? null,
            codigo: venda.id,
            novoStatus,
          })
          if (origem === 'exemplo') {
            dados = dados.map((item) =>
              (item.uuid ?? item.id) === vendaId
                ? {
                    ...item,
                    status: resultado.status,
                    pagamentoStatus: resultado.status === 'Concluída' ? 'Confirmado' : 'Pendente',
                    statusHistorico: [
                      ...(item.statusHistorico ?? []),
                      { statusAnterior: item.status, statusNovo: resultado.status, criadoEm: new Date().toISOString() },
                    ],
                  }
                : item,
            )
            aplicar(input.value)
            toast(novoStatus === 'Concluída'
              ? `Pedido ${venda.id}: pagamento confirmado e venda concluída.`
              : `Pedido ${venda.id} enviado para preparo.`)
            return
          }

          await recarregar()
          toast(resultado.jaEstavaAtualizado
            ? `Pedido ${venda.id} já estava com status ${resultado.status}.`
            : novoStatus === 'Concluída'
              ? `Pedido ${venda.id}: pagamento confirmado e venda concluída.`
              : `Pedido ${venda.id} enviado para preparo.`)
        } catch (erro) {
          console.error('[vendas] Não foi possível atualizar o status do pedido.', erro)
          toast(erro?.message ?? 'Não foi possível atualizar o status da venda.')
        }
      }

      function cancelar(vendaId) {
        const venda = dados.find((item) => (item.uuid ?? item.id) === vendaId)
        if (!venda) return

        abrirFormulario({
          titulo: `Cancelar pedido ${venda.id}`,
          descricao: 'O motivo será registrado no histórico. O estoque movimentado pelo pedido será devolvido uma única vez.',
          campos: [{
            nome: 'motivo',
            label: 'Motivo do cancelamento',
            tipo: 'textarea',
            obrigatorio: true,
            largo: true,
            placeholder: 'Ex.: cliente desistiu, pedido lançado em duplicidade...',
          }],
          textoBotao: 'Cancelar pedido',
          aoSalvar: async ({ motivo }) => {
            const { dados: cancelada, origem } = await cancelarVendaPendente({
              vendaId: venda.uuid ?? null,
              codigo: venda.id,
              motivo,
            })

            if (origem === 'exemplo') {
              dados = dados.map((item) =>
                (item.uuid ?? item.id) === vendaId
                  ? { ...item, status: 'Cancelada', pagamentoStatus: 'Cancelado' }
                  : item,
              )
              aplicar(input.value)
              return cancelada.jaCancelada
                ? `Pedido ${venda.id} já estava cancelado.`
                : `Pedido ${venda.id} cancelado nesta demonstração.`
            }

            await recarregar()
            return cancelada.jaCancelada
              ? `Pedido ${venda.id} já estava cancelado; nenhum movimento foi repetido.`
              : `Pedido ${venda.id} cancelado; ${cancelada.movimentos} movimento(s) de estoque revertido(s).`
          },
        })
      }

      async function verDetalhes(vendaId) {
        const venda = dados.find((item) => (item.uuid ?? item.id) === vendaId)
        if (!venda) return
        modalDetalhes?.remove()

        modalDetalhes = document.createElement('div')
        modalDetalhes.className = 'modal venda-detalhe'
        modalDetalhes.setAttribute('role', 'dialog')
        modalDetalhes.setAttribute('aria-modal', 'true')
        modalDetalhes.setAttribute('aria-labelledby', 'venda-detalhe-titulo')
        modalDetalhes.innerHTML = `
          <div class="modal__scrim" data-detalhe-fechar></div>
          <section class="modal__caixa venda-detalhe__caixa">
            <header class="modal__head">
              <div>
                <h2 class="modal__titulo" id="venda-detalhe-titulo">Pedido ${esc(venda.id)}</h2>
                <p class="modal__desc">Carregando os dados históricos do pedido...</p>
              </div>
              <button class="modal__x" type="button" data-detalhe-fechar aria-label="Fechar detalhes">
                <i data-lucide="x"></i>
              </button>
            </header>
            <div class="venda-detalhe__conteudo" aria-live="polite">
              <p>Carregando detalhes e histórico...</p>
            </div>
          </section>
        `
        document.body.append(modalDetalhes)
        renderIcons(modalDetalhes)

        const fecharDetalhes = () => {
          modalDetalhes?.removeEventListener('keydown', aoTeclar)
          modalDetalhes?.remove()
          modalDetalhes = null
        }
        const aoTeclar = (evento) => {
          if (evento.key === 'Escape') fecharDetalhes()
        }
        modalDetalhes.querySelectorAll('[data-detalhe-fechar]').forEach((botao) => {
          botao.addEventListener('click', fecharDetalhes)
        })
        modalDetalhes.addEventListener('keydown', aoTeclar)
        modalDetalhes.querySelector('[data-detalhe-fechar]:not(.modal__scrim)')?.focus()

        try {
          const [resultadoDetalhes, resultadoHistorico] = await Promise.all([
            detalharVenda(venda.uuid ?? venda.id),
            historicoStatusVenda(venda.uuid ?? venda.id),
          ])
          if (!modalDetalhes?.isConnected) return

          const detalhe = resultadoDetalhes.origem === 'neon'
            ? resultadoDetalhes.dados
            : null
          const historico = resultadoHistorico.origem === 'neon'
            ? resultadoHistorico.dados
            : venda.statusHistorico ?? []
          const itens = detalhe?.itensVenda ?? []
          const dadosDoPedido = detalhe ?? venda
          const total = Number(dadosDoPedido.total ?? 0)
          const totalItens = Number(dadosDoPedido.subtotal ?? total)
          const taxaEntrega = Number(dadosDoPedido.taxaEntrega ?? 0)
          const statusPagamento = dadosDoPedido.pagamentoStatus ??
            (dadosDoPedido.status === 'Concluída'
              ? 'Confirmado'
              : dadosDoPedido.status === 'Cancelada' ? 'Cancelado' : 'Pendente')
          const listaItens = itens.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th>Produto e quantidade</th><th>Preço</th><th class="ta-right">Total</th></tr></thead><tbody>${itens.map((item) => {
                const quantidade = item.metodoPeso
                  ? `${formatNumero(item.pesoLiquidoGramas)} g líquidos${item.pesoBrutoGramas == null ? '' : ` · bruto ${formatNumero(item.pesoBrutoGramas)} g · tara ${formatNumero(item.taraGramas)} g`}${item.recipienteId ? ` · recipiente ${esc(item.recipienteId)}` : ''}`
                  : `${formatNumero(item.quantidade)} un.`
                return `<tr><td><strong>${esc(item.descricao)}</strong><span class="cell-sub">${esc(quantidade)}</span></td><td>${formatBRL(item.precoUnitario)}${item.metodoPeso ? '/kg' : ''}</td><td class="ta-right">${formatBRL(item.total)}</td></tr>`
              }).join('')}</tbody></table></div>`
            : `<p class="muted">${resultadoDetalhes.origem === 'exemplo'
                ? 'A demonstração não possui itens históricos detalhados para este pedido.'
                : 'Nenhum item detalhado foi retornado para este pedido.'}</p>`
          const eventos = historico.length
            ? `<ol class="venda-detalhe__historico">${historico.map((evento) => `
                <li>
                  <strong>${esc(evento.statusAnterior ? `${evento.statusAnterior} → ${evento.statusNovo}` : evento.statusNovo)}</strong>
                  <time>${esc(evento.criadoEm ? new Date(evento.criadoEm).toLocaleString('pt-BR') : 'Data não disponível')}</time>
                  ${evento.motivo ? `<span>${esc(evento.motivo)}</span>` : ''}
                </li>
              `).join('')}</ol>`
            : '<p class="muted">Histórico detalhado indisponível para este pedido.</p>'
          modalDetalhes.querySelector('.modal__desc').textContent =
            `${dadosDoPedido.cliente ?? 'Consumidor'} · ${dadosDoPedido.tipoVenda ?? 'Tipo não informado'} · ${dadosDoPedido.pagamento ?? 'Pagamento não informado'}`
          modalDetalhes.querySelector('.venda-detalhe__conteudo').innerHTML = `
            <dl class="venda-detalhe__resumo">
              <div><dt>Status do pedido</dt><dd>${esc(dadosDoPedido.estornadaEm ? 'Estornada' : dadosDoPedido.status)}</dd></div>
              <div><dt>Situação do pagamento</dt><dd>${esc(statusPagamento)}</dd></div>
              <div><dt>Data e hora</dt><dd>${esc(dadosDoPedido.criadoEm ? new Date(dadosDoPedido.criadoEm).toLocaleString('pt-BR') : dadosDoPedido.hora ?? 'Não disponível')}</dd></div>
              <div><dt>Subtotal dos itens</dt><dd>${formatBRL(totalItens)}</dd></div>
              ${taxaEntrega ? `<div><dt>Taxa de entrega cobrada do cliente</dt><dd>${formatBRL(taxaEntrega)}</dd></div>` : ''}
              <div><dt>Total cobrado</dt><dd><strong>${formatBRL(total)}</strong></dd></div>
              ${dadosDoPedido.valorRecebido == null ? '' : `<div><dt>Valor recebido</dt><dd>${formatBRL(dadosDoPedido.valorRecebido)} · troco ${formatBRL(dadosDoPedido.troco ?? 0)}</dd></div>`}
              ${dadosDoPedido.tipoVenda === 'Aplicativo' ? `<div><dt>Plataforma / pedido externo</dt><dd>${esc(dadosDoPedido.plataforma ?? '—')} · ${esc(dadosDoPedido.pedidoExterno ?? 'sem identificador')}</dd></div><div><dt>Comissão e outras taxas</dt><dd>${formatBRL(dadosDoPedido.comissaoEstimada ?? 0)} · ${formatBRL(dadosDoPedido.taxaAplicativo ?? 0)}</dd></div><div><dt>Líquido estimado</dt><dd>${formatBRL(dadosDoPedido.valorLiquidoEstimado ?? 0)}</dd></div>` : ''}
              ${dadosDoPedido.enderecoEntrega ? `<div class="venda-detalhe__largo"><dt>Endereço de entrega</dt><dd>${esc(dadosDoPedido.enderecoEntrega)}</dd></div>` : ''}
              <div class="venda-detalhe__largo"><dt>Descontos</dt><dd>Descontos não são registrados separadamente nos dados deste pedido.</dd></div>
            </dl>
            <h3>Itens</h3>${listaItens}
            <h3>Histórico de status</h3>${eventos}
            ${resultadoDetalhes.origem !== 'neon' ? '<p class="campo__ajuda">Dados de demonstração são temporários e não representam um registro histórico no banco.</p>' : ''}
          `
        } catch (erro) {
          console.error('[vendas] Não foi possível carregar os detalhes do pedido.', erro)
          if (modalDetalhes?.isConnected) {
            modalDetalhes.querySelector('.modal__desc').textContent = 'Falha ao consultar os detalhes.'
            modalDetalhes.querySelector('.venda-detalhe__conteudo').innerHTML =
              `<p class="alert alert--danger" role="alert">${esc(erro?.message ?? 'Não foi possível consultar os detalhes do pedido.')}</p>`
          }
        }
      }

      /**
       * Estorna uma venda (migração 11).
       *
       * O motivo é obrigatório no banco — sem ele o estorno não se audita. Uma
       * janela de verdade (e não um "tem certeza?") porque o operador precisa
       * dizer POR QUE está desfazendo a venda.
       */
      async function estornar(vendaId) {
        const venda = dados.find((v) => (v.uuid ?? v.id) === vendaId)
        if (!venda) return

        abrirFormulario({
          titulo: `Estornar pedido ${venda.id}`,
          descricao:
            'O pedido sai do faturamento e o estoque que ele tirou volta para a prateleira. O histórico guarda quem estornou, quando e por quê.',
          campos: [
            {
              nome: 'motivo',
              label: 'Motivo do estorno',
              tipo: 'textarea',
              obrigatorio: true,
              largo: true,
              placeholder: 'Ex.: cliente desistiu, pedido lançado em duplicidade...',
            },
          ],
          textoBotao: 'Estornar venda',
          aoSalvar: async ({ motivo }) => {
            const { dados: estornada, origem } = await estornarVenda({
              vendaId: venda.uuid ?? null,
              codigo: venda.id,
              motivo,
            })

            if (origem === 'exemplo') {
              dados = dados.map((v) =>
                (v.uuid ?? v.id) === vendaId
                  ? { ...v, status: 'Cancelada', estornadaEm: estornada.estornadaEm }
                  : v,
              )
              aplicar(input.value)
              return `Pedido ${venda.id} estornado só nesta sessão — o Neon não está configurado.`
            }

            await recarregar()

            if (estornada.jaEstornada) {
              return `Pedido ${venda.id} já estava estornado — nada foi devolvido de novo.`
            }

            return estornada.movimentos
              ? `Pedido ${venda.id} estornado — ${estornada.movimentos} ${estornada.movimentos === 1 ? 'movimento devolvido' : 'movimentos devolvidos'} ao estoque.`
              : `Pedido ${venda.id} estornado — não havia estoque a devolver.`
          },
        })
      }

      const botaoNova = root.querySelector('[data-acao="nova-venda"]')

      botaoNova.addEventListener('click', async () => {
        // O formulário precisa das listas de clientes e produtos para os selects.
        const rotulo = botaoNova.innerHTML
        botaoNova.disabled = true
        botaoNova.textContent = 'Carregando...'

        try {
          const [
            { dados: listaClientes },
            { dados: listaProdutos },
            { dados: listaRecipientes },
            { dados: tiposVenda },
            { dados: formasPagamento },
            codigo,
          ] = await Promise.all([
            listarClientes(),
            listarProdutos(),
            listarRecipientes({ somenteAtivos: true }),
            listarTiposVenda({ somenteAtivos: true }),
            listarFormasPagamento({ somenteAtivos: true }),
            proximoCodigoVenda(),
          ])
          if (!tiposVenda.length || !formasPagamento.length) {
            throw new Error('Cadastre pelo menos um tipo de venda e uma forma de pagamento nas Configurações.')
          }

          let fotosDisponiveis = new Map()
          try {
            const resultadoFotos = await listarImagensProdutos(
              listaProdutos.map((produto) => produto.uuid).filter(Boolean),
            )
            if (resultadoFotos.disponivel) fotosDisponiveis = resultadoFotos.imagens
          } catch (erro) {
            console.error('[vendas] Não foi possível consultar as fotos dos produtos.', erro)
          }
          const produtosComFotos = listaProdutos.map((produto) => ({
            ...produto,
            imagemPath: fotosDisponiveis.get(produto.uuid) ?? null,
          }))

          // Uma chave por abertura de formulário (ver `novaChave`).
          const chave = novaChave()
          const tipoInicial = tiposVenda.find((tipo) => tipo.codigo === 'balcao') ?? tiposVenda[0]
          const pagamentoInicial =
            formasPagamento.find((forma) => forma.categoria === 'pix') ?? formasPagamento[0]
          const urlsFotos = new Map()
          let modalVenda = null
          let observarFechamento = null
          const carregarFotoProduto = async (produtoId) => {
            if (!fotosDisponiveis.has(produtoId)) return null
            if (urlsFotos.has(produtoId)) return urlsFotos.get(produtoId)
            const blob = await carregarImagemProduto(produtoId)
            if (!blob) return null
            if (!modalVenda?.isConnected) return null
            const url = URL.createObjectURL(blob)
            urlsFotos.set(produtoId, url)
            return url
          }

          abrirFormulario({
            titulo: 'Nova venda',
            descricao:
              'Novos pedidos começam Aguardando. Confirme o pagamento somente quando receber; itens por peso usam o peso lido na balança. Taxas e comissões são estimativas.',
            campos: [
              {
                nome: 'codigo',
                label: 'Pedido',
                tipo: 'texto',
                placeholder: codigo,
                ajuda:
                  'Pode deixar em branco: o sistema numera o pedido. Digite só se precisar escolher o número.',
              },
              {
                nome: 'clienteId',
                label: 'Cliente',
                tipo: 'select',
                vazio: 'Consumidor (sem cadastro)',
                opcoes: listaClientes.map((c) => ({ valor: c.uuid ?? c.id, rotulo: c.nome })),
              },
              {
                nome: 'tipoVendaId',
                label: 'Tipo de venda',
                tipo: 'select',
                opcoes: tiposVenda.map((tipo) => ({
                  valor: tipo.id,
                  rotulo: tipo.nome,
                })),
                obrigatorio: true,
              },
              {
                nome: 'formaPagamentoId',
                label: 'Forma de pagamento',
                tipo: 'select',
                opcoes: formasPagamento.map((forma) => ({
                  valor: forma.id,
                  rotulo: forma.nome,
                })),
                obrigatorio: true,
              },
              {
                nome: 'enderecoEntrega',
                label: 'Endereço de entrega',
                tipo: 'texto',
                largo: true,
                placeholder: 'Rua, número, bairro e referência',
              },
              {
                nome: 'taxaEntrega',
                label: 'Taxa de entrega',
                tipo: 'moeda',
              },
              {
                nome: 'plataforma',
                label: 'Aplicativo / plataforma',
                tipo: 'texto',
                placeholder: 'Ex.: iFood',
              },
              {
                nome: 'pedidoExterno',
                label: 'Número do pedido no aplicativo',
                tipo: 'texto',
                placeholder: 'Identificador externo (opcional)',
              },
              {
                nome: 'comissaoPercentual',
                label: 'Comissão do aplicativo',
                tipo: 'numero',
                ajuda: 'Percentual aplicado sobre o total cobrado.',
                placeholder: '0',
              },
              {
                nome: 'taxaAplicativo',
                label: 'Outras taxas do aplicativo',
                tipo: 'moeda',
              },
              {
                nome: 'valorRecebido',
                label: 'Valor recebido em dinheiro',
                tipo: 'moeda',
                placeholder: 'Opcional — usado para calcular o troco',
              },
              {
                nome: 'itens',
                label: 'Itens do pedido',
                tipo: 'itens',
                obrigatorio: true,
                produtos: produtosComFotos,
                recipientes: listaRecipientes,
                carregarImagem: carregarFotoProduto,
              },
            ],
            valores: {
              tipoVendaId: tipoInicial.id,
              formaPagamentoId: pagamentoInicial.id,
              taxaEntrega: 0,
              comissaoPercentual: 0,
              taxaAplicativo: 0,
            },
            textoBotao: 'Registrar venda',
            aoSalvar: async (valores) => {
              const tipoVenda = tiposVenda.find((tipo) => tipo.id === valores.tipoVendaId)
              const formaPagamento = formasPagamento.find(
                (forma) => forma.id === valores.formaPagamentoId,
              )
              if (!tipoVenda || !formaPagamento) {
                throw new Error('Selecione um tipo de venda e uma forma de pagamento ativos.')
              }

              const valorRecebido =
                formaPagamento.categoria === 'dinheiro' && Number.isFinite(valores.valorRecebido)
                  ? valores.valorRecebido
                  : undefined
              if (valores.valorRecebido !== '' && valores.valorRecebido != null &&
                  (!Number.isFinite(valores.valorRecebido) || valores.valorRecebido < 0)) {
                throw new Error('Informe um valor recebido válido.')
              }

              const clienteNome = listaClientes.find(
                (c) => (c.uuid ?? c.id) === valores.clienteId,
              )?.nome

              const { dados: criada, origem } = await registrarVenda({
                ...valores,
                clienteNome,
                tipoVendaNome: tipoVenda.nome,
                formaPagamentoNome: formaPagamento.nome,
                formaPagamentoCategoria: formaPagamento.categoria,
                valorRecebido,
                chave,
              })

              if (origem === 'exemplo') {
                dados = [criada, ...dados]
                aplicar(input.value)
                return `Pedido ${criada.id} entrou só nesta sessão — o Neon não está configurado.`
              }

              await recarregar()

              if (criada.jaExistia) {
                return `Pedido ${criada.id} já estava registrado — nada foi duplicado.`
              }

              return criada.movimentos
                ? `Pedido ${criada.id} registrado — ${formatBRL(criada.total)} (estoque baixado).`
                : `Pedido ${criada.id} registrado — ${formatBRL(criada.total)}.`
            },
          })
          modalVenda = document.querySelector('.modal')
          if (modalVenda && typeof MutationObserver !== 'undefined') {
            observarFechamento = new MutationObserver(() => {
              if (modalVenda.isConnected) return
              observarFechamento.disconnect()
              urlsFotos.forEach((url) => URL.revokeObjectURL(url))
              urlsFotos.clear()
            })
            observarFechamento.observe(document.body, { childList: true })
          }

          const modal = document.querySelector('.modal')
          const campoTipo = modal?.querySelector('[name="tipoVendaId"]')
          const campoForma = modal?.querySelector('[name="formaPagamentoId"]')
          const camposEntrega = ['enderecoEntrega', 'taxaEntrega']
          const camposAplicativo = ['plataforma', 'pedidoExterno', 'comissaoPercentual', 'taxaAplicativo']
          const resumo = document.createElement('p')
          resumo.className = 'campo__ajuda campo--largo'
          resumo.id = 'resumo-venda-cobranca'
          modal?.querySelector('[data-campo="itens"]')?.after(resumo)

          const atualizarCampos = () => {
            const categoria = tiposVenda.find((tipo) => tipo.id === campoTipo?.value)?.categoria
            for (const nome of camposEntrega) {
              const campo = modal?.querySelector(`[data-campo="${nome}"]`)
              if (campo) campo.hidden = !['delivery', 'aplicativo'].includes(categoria)
            }
            for (const nome of camposAplicativo) {
              const campo = modal?.querySelector(`[data-campo="${nome}"]`)
              if (campo) campo.hidden = categoria !== 'aplicativo'
            }
            const dinheiro =
              formasPagamento.find((forma) => forma.id === campoForma?.value)?.categoria === 'dinheiro'
            const campoRecebido = modal?.querySelector('[data-campo="valorRecebido"]')
            if (campoRecebido) campoRecebido.hidden = !dinheiro
          }

          const atualizarResumoCobranca = () => {
            if (!modal || !resumo) return
            const textoTotal = modal.querySelector('[data-itens-total]')?.textContent ?? ''
            const subtotalCentavos = Number(textoTotal.replace(/\D/g, '')) || 0
            const taxaEl = modal.querySelector('[name="taxaEntrega"]')
            const taxaTexto = taxaEl && !taxaEl.closest('[data-campo]')?.hidden ? taxaEl.value.trim() : ''
            const taxaCentavos = taxaTexto ? paraCentavos(taxaTexto) : 0
            if (!Number.isSafeInteger(taxaCentavos)) {
              resumo.textContent = 'Informe valores monetários válidos para calcular o total.'
              return
            }
            const totalCentavos = subtotalCentavos + taxaCentavos
            const recebidoTexto = modal.querySelector('[name="valorRecebido"]')?.value.trim()
            const categoriaForma = formasPagamento.find((forma) => forma.id === campoForma?.value)?.categoria
            const recebidoCentavos =
              categoriaForma === 'dinheiro' && recebidoTexto ? paraCentavos(recebidoTexto) : totalCentavos
            if (!Number.isSafeInteger(recebidoCentavos)) {
              resumo.textContent = 'Informe valores monetários válidos para calcular o troco.'
              return
            }
            const trocoCentavos =
              categoriaForma === 'dinheiro' ? Math.max(0, recebidoCentavos - totalCentavos) : 0
            resumo.textContent = `Total a cobrar: ${formatBRL(centavosParaReais(totalCentavos))} · Troco: ${formatBRL(centavosParaReais(trocoCentavos))}`
          }

          campoTipo?.addEventListener('change', atualizarCampos)
          campoForma?.addEventListener('change', atualizarCampos)
          modal?.addEventListener('input', atualizarResumoCobranca)
          modal?.addEventListener('change', atualizarResumoCobranca)
          atualizarCampos()
          atualizarResumoCobranca()
        } catch (erro) {
          console.error('[vendas] Não foi possível abrir o formulário.', erro)
          toast('Não foi possível carregar clientes e produtos.')
        } finally {
          botaoNova.disabled = false
          botaoNova.innerHTML = rotulo
          renderIcons(botaoNova)
        }
      })

      return () => {
        window.removeEventListener('busca-global', aoBuscarGlobal)
        observarFilial?.disconnect()
        // O formulário é anexado ao `body`; sem fechar aqui ele sobrevive à
        // troca de rota (com o MutationObserver e as fotos em memória) e o
        // "Salvar" continuaria agindo sobre o estado da página anterior.
        fechar()
        modalDetalhes?.remove()
        modalDetalhes = null
        pararVendas()
        pararResumo()
      }
    },
  }
}
