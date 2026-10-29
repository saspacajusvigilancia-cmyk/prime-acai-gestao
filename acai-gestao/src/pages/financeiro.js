import Chart from 'chart.js/auto'
import {
  comparativoMensal as comparativoExemplo,
  fluxoMensal as fluxoExemplo,
  lancamentos as lancamentosExemplo,
} from '../data.js'
import { abrirFormulario } from '../formulario.js'
import { observar, hoje, neonConfigurado } from '../services/base.js'
import {
  carregarComparativoMensal,
  carregarFluxoMensal,
  criarLancamento,
  listarLancamentos,
} from '../services/lancamentos.js'
import {
  baixarParcela,
  carregarResumoFinanceiro,
  listarFormasPagamento,
  listarTitulos,
  exemploResumoFinanceiro,
} from '../services/financeiro.js'
import {
  atualizarKpi,
  atualizarTabela,
  badge,
  botaoPrimario,
  cardHead,
  esc,
  formatBRL,
  formatData,
  statCard,
  tabela,
  toolbar,
} from '../ui.js'

const colunas = [
  {
    key: 'descricao',
    label: 'Lançamento',
    render: (l) => `
      <span class="cell-main">${esc(l.descricao)}</span>
      <span class="cell-sub mono">${esc(l.id)}</span>
    `,
  },
  { key: 'data', label: 'Data', render: (l) => `<span class="muted">${formatData(l.data)}</span>` },
  { key: 'categoria', label: 'Categoria', render: (l) => esc(l.categoria) },
  { key: 'forma', label: 'Forma', render: (l) => `<span class="muted">${esc(l.forma)}</span>` },
  {
    key: 'tipo',
    label: 'Tipo',
    render: (l) =>
      badge(l.tipo === 'entrada' ? 'Entrada' : 'Saída', l.tipo === 'entrada' ? 'success' : 'danger'),
  },
  {
    key: 'valor',
    label: 'Valor',
    align: 'right',
    render: (l) =>
      `<strong class="${l.tipo === 'entrada' ? 'valor--entrada' : 'valor--saida'}">
         ${l.tipo === 'entrada' ? '+' : '−'} ${formatBRL(l.valor)}
       </strong>`,
  },
]

const filtrar = (dados, termo) => {
  const busca = termo.trim().toLowerCase()
  if (!busca) return dados
  return dados.filter((l) =>
    [l.id, l.descricao, l.categoria, l.forma, l.tipo].join(' ').toLowerCase().includes(busca),
  )
}

const statusTitulo = (titulo) => {
  const vencido =
    titulo.status !== 'liquidado' &&
    titulo.status !== 'cancelado' &&
    titulo.vencimento &&
    titulo.vencimento < hoje()

  if (vencido && titulo.saldo > 0) return badge('Vencido', 'danger')
  if (titulo.status === 'liquidado') return badge('Liquidado', 'success')
  if (titulo.status === 'parcial') return badge('Parcial', 'warning')
  if (titulo.status === 'cancelado') return badge('Cancelado', 'danger')
  return badge('Aberto', 'warning')
}

const colunasTitulos = [
  {
    key: 'descricao',
    label: 'Título',
    render: (t) => `
      <span class="cell-main">${esc(t.descricao)}</span>
      <span class="cell-sub mono">${esc(t.numero)}</span>
    `,
  },
  { key: 'pessoa', label: 'Pessoa', render: (t) => `<span class="muted">${esc(t.pessoa)}</span>` },
  {
    key: 'vencimento',
    label: 'Vencimento',
    render: (t) => `<span class="muted">${t.vencimento ? formatData(t.vencimento) : '—'}</span>`,
  },
  { key: 'status', label: 'Status', render: statusTitulo },
  {
    key: 'saldo',
    label: 'Saldo',
    align: 'right',
    render: (t) => `<strong>${formatBRL(t.saldo)}</strong>`,
  },
  {
    key: 'acao',
    label: '',
    align: 'right',
    render: (t) =>
      t.saldo > 0.001 && t.status !== 'cancelado'
        ? `<button class="btn btn--ghost btn--sm" type="button" data-baixar="${esc(t.parcelaId)}"
             data-titulo="${esc(t.descricao)}" data-saldo="${t.saldo}">
             Baixar
           </button>`
        : '',
  },
]

/** Indicadores do mês mais recente presente na série. */
function indicadores(fluxo) {
  const ultimo = fluxo.entradas.length - 1
  const entradas = fluxo.entradas[ultimo] ?? 0
  const saidas = fluxo.saidas[ultimo] ?? 0
  const resultado = entradas - saidas

  return {
    entradas,
    saidas,
    resultado,
    margem: entradas ? (resultado / entradas) * 100 : 0,
  }
}

/**
 * Variação do cartão "Entradas do mês": mês em curso contra o mesmo trecho do
 * mês passado. Comparar com o mês anterior inteiro acusaria uma queda falsa,
 * porque o mês em curso ainda está pela metade.
 */
function deltaEntradas({ entradas, entradasAnterior }) {
  if (!entradasAnterior) return undefined
  return ((entradas - entradasAnterior) / entradasAnterior) * 100
}

export function financeiroPage() {
  const inicial = indicadores(fluxoExemplo)

  return {
    html: `
      <section class="grid grid--stats">
        ${statCard({
          kpi: 'entradas',
          label: 'Entradas do mês',
          valor: formatBRL(inicial.entradas),
          delta: deltaEntradas(comparativoExemplo),
          icon: 'arrow-up-right',
          hint: 'Total recebido no mês',
        })}
        ${statCard({
          kpi: 'saidas',
          label: 'Saídas do mês',
          valor: formatBRL(inicial.saidas),
          icon: 'arrow-down-right',
          hint: 'Custos e despesas pagos',
        })}
        ${statCard({
          kpi: 'resultado',
          label: 'Resultado do mês',
          valor: formatBRL(inicial.resultado),
          icon: 'circle-dollar-sign',
          hint: 'Entradas menos saídas',
        })}
        ${statCard({
          kpi: 'margem',
          label: 'Margem',
          valor: `${inicial.margem.toFixed(1).replace('.', ',')}%`,
          icon: 'chart-line',
          hint: 'Sobre o faturamento',
        })}
        ${statCard({
          kpi: 'aReceber',
          label: 'A receber',
          valor: neonConfigurado ? '—' : formatBRL(exemploResumoFinanceiro.a_receber),
          icon: 'hand-coins',
          hint: neonConfigurado ? 'Carregando…' : 'Títulos em aberto',
        })}
        ${statCard({
          kpi: 'aPagar',
          label: 'A pagar',
          valor: neonConfigurado ? '—' : formatBRL(exemploResumoFinanceiro.a_pagar),
          icon: 'receipt',
          hint: neonConfigurado ? 'Carregando…' : 'Títulos em aberto',
        })}
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Entradas x Saídas',
          descricao: 'Comparativo dos últimos meses',
        })}
        <div class="chart chart--bar"><canvas id="grafico-fluxo"></canvas></div>
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Lançamentos',
          descricao: 'Movimentações recentes do caixa',
          acoes: botaoPrimario({ label: 'Novo lançamento', icon: 'plus', acao: 'novo-lancamento' }),
        })}
        ${toolbar({ buscaId: 'busca-financeiro', placeholder: 'Buscar por descrição, categoria ou tipo...' })}
        <p class="table__count" id="contagem-financeiro"></p>
        ${tabela({ colunas, linhas: lancamentosExemplo, id: 'tabela-financeiro' })}
      </section>

      <section class="card">
        ${cardHead({
          titulo: 'Contas a receber e a pagar',
          descricao: 'Títulos gerados pelas vendas e pelos recebimentos de compra',
        })}
        <div class="financeiro-duas-colunas">
          <div>
            <h3 class="financeiro-titulos__titulo">A receber</h3>
            <p class="table__count" id="contagem-receber"></p>
            ${tabela({ colunas: colunasTitulos, linhas: [], id: 'tabela-receber' })}
          </div>
          <div>
            <h3 class="financeiro-titulos__titulo">A pagar</h3>
            <p class="table__count" id="contagem-pagar"></p>
            ${tabela({ colunas: colunasTitulos, linhas: [], id: 'tabela-pagar' })}
          </div>
        </div>
      </section>
    `,

    mount(root) {
      const estilo = getComputedStyle(root)
      let dados = lancamentosExemplo
      // O cartão "Entradas do mês" junta o valor da série mensal com a variação
      // do comparativo; guardo os dois para que cheguem na ordem que chegarem.
      let entradasMes = inicial.entradas
      let entradasAnterior = comparativoExemplo.entradasAnterior

      const contagem = root.querySelector('#contagem-financeiro')
      const input = root.querySelector('#busca-financeiro')

      const pintarEntradas = () =>
        atualizarKpi(root, 'entradas', {
          valor: formatBRL(entradasMes),
          delta: deltaEntradas({ entradas: entradasMes, entradasAnterior }),
        })

      const aplicar = (termo) => {
        const linhas = filtrar(dados, termo)
        atualizarTabela(root, 'tabela-financeiro', colunas, linhas)
        contagem.textContent = `${linhas.length} de ${dados.length} lançamentos`
      }

      aplicar('')

      input.addEventListener('input', () => aplicar(input.value))

      const aoBuscarGlobal = (evento) => {
        input.value = evento.detail
        aplicar(evento.detail)
      }
      window.addEventListener('busca-global', aoBuscarGlobal)

      const grafico = new Chart(root.querySelector('#grafico-fluxo'), {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Entradas',
              data: [],
              backgroundColor: estilo.getPropertyValue('--marca-verde').trim(),
              borderRadius: 6,
              maxBarThickness: 34,
            },
            {
              label: 'Saídas',
              data: [],
              backgroundColor: estilo.getPropertyValue('--marca-dourado').trim(),
              borderRadius: 6,
              maxBarThickness: 34,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } },
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: estilo.getPropertyValue('--borda').trim() },
              ticks: { callback: (v) => formatBRL(Number(v)) },
            },
            x: { grid: { display: false } },
          },
        },
      })

      const aplicarLancamentos = (remotos) => {
        dados = remotos
        aplicar(input.value)
      }

      let receber = []
      let pagar = []
      let formas = []

      const contagemReceber = root.querySelector('#contagem-receber')
      const contagemPagar = root.querySelector('#contagem-pagar')

      const aplicarTitulos = (tipo, remotos) => {
        if (tipo === 'receber') {
          receber = remotos
          atualizarTabela(root, 'tabela-receber', colunasTitulos, remotos)
          contagemReceber.textContent = `${remotos.length} título(s) em aberto`
        } else {
          pagar = remotos
          atualizarTabela(root, 'tabela-pagar', colunasTitulos, remotos)
          contagemPagar.textContent = `${remotos.length} título(s) em aberto`
        }
      }

      const aplicarHint = (kpi, texto) => {
        const alvo = root.querySelector(`[data-kpi="${kpi}"] .stat__hint`)
        if (alvo) alvo.textContent = texto
      }

      const aplicarResumo = (resumo) => {
        atualizarKpi(root, 'aReceber', { valor: formatBRL(resumo.a_receber) })
        aplicarHint(
          'aReceber',
          resumo.a_receber_vencido > 0
            ? `${formatBRL(resumo.a_receber_vencido)} vencido`
            : 'Títulos em aberto',
        )

        atualizarKpi(root, 'aPagar', { valor: formatBRL(resumo.a_pagar) })
        aplicarHint(
          'aPagar',
          resumo.a_pagar_vencido > 0
            ? `${formatBRL(resumo.a_pagar_vencido)} vencido`
            : 'Títulos em aberto',
        )
      }

      /**
       * As views de títulos chegam na migração 33. Enquanto ela não estiver
       * aplicada, a tela não pode exibir os valores de exemplo como se fossem
       * reais: zera o indicador e diz o que falta.
       */
      const titulosIndisponiveis = (tipo) => {
        const id = tipo === 'receber' ? 'tabela-receber' : 'tabela-pagar'
        const contagem = tipo === 'receber' ? contagemReceber : contagemPagar
        atualizarTabela(root, id, colunasTitulos, [])
        contagem.textContent = 'Indisponível — recurso ainda não ativado neste ambiente'
      }

      const resumoIndisponivel = () => {
        atualizarKpi(root, 'aReceber', { valor: '—' })
        atualizarKpi(root, 'aPagar', { valor: '—' })
        aplicarHint('aReceber', 'Indisponível neste banco')
        aplicarHint('aPagar', 'Indisponível neste banco')
      }

      const abrirBaixa = (parcelaId, descricao, saldo) => {
        // A chave nasce com o formulário: se a resposta se perder e o usuário
        // tentar de novo, o banco devolve a mesma baixa em vez de debitar duas.
        const chave = `manual:${parcelaId}:${Date.now()}`

        abrirFormulario({
          titulo: 'Baixar título',
          descricao: descricao,
          campos: [
            {
              nome: 'valor',
              label: 'Valor',
              tipo: 'moeda',
              obrigatorio: true,
              largo: true,
            },
            {
              nome: 'data',
              label: 'Data',
              tipo: 'data',
              obrigatorio: true,
            },
            {
              nome: 'forma_pagamento_id',
              label: 'Forma',
              tipo: 'select',
              opcoes: formas.map((f) => ({ valor: f.id, rotulo: f.nome })),
            },
            {
              nome: 'observacoes',
              label: 'Observações',
              tipo: 'texto',
              largo: true,
            },
          ],
          valores: {
            valor: Number(saldo).toFixed(2).replace('.', ','),
            data: hoje(),
            forma_pagamento_id: formas[0]?.id ?? '',
          },
          aoSalvar: async (valores) => {
            const { origem } = await baixarParcela({
              parcelaId,
              valor: valores.valor,
              data: valores.data,
              formaPagamentoId: valores.forma_pagamento_id,
              observacoes: valores.observacoes,
              chave,
            })

            if (origem === 'exemplo') {
              return 'A baixa ficou só nesta sessão — o Neon não está configurado.'
            }

            await recarregar()
            return 'Baixa registrada no caixa.'
          },
        })
      }

      const aoClicar = (evento) => {
        const botao = evento.target.closest('[data-baixar]')
        if (!botao) return
        abrirBaixa(botao.dataset.baixar, botao.dataset.titulo, botao.dataset.saldo)
      }
      root.addEventListener('click', aoClicar)

      const aplicarFluxo = (fluxo) => {
        grafico.data.labels = fluxo.labels
        grafico.data.datasets[0].data = fluxo.entradas
        grafico.data.datasets[1].data = fluxo.saidas
        grafico.update()

        const kpi = indicadores(fluxo)
        entradasMes = kpi.entradas
        pintarEntradas()
        atualizarKpi(root, 'saidas', { valor: formatBRL(kpi.saidas) })
        atualizarKpi(root, 'resultado', { valor: formatBRL(kpi.resultado) })
        atualizarKpi(root, 'margem', { valor: `${kpi.margem.toFixed(1).replace('.', ',')}%` })
      }

      /**
       * O comparativo só entra se a consulta deu certo. Quando falha, `carregar`
       * devolve o exemplo — e misturar o número de exemplo com o valor real do
       * cartão seria pior do que não ter etiqueta nenhuma.
       */
      const comparativoDe = ({ dados, erro }) => (erro ? { entradasAnterior: null } : dados)

      const aplicarComparativo = ({ entradasAnterior: anterior }) => {
        entradasAnterior = anterior
        pintarEntradas()
      }

      const pararLancamentos = observar(listarLancamentos(), ({ dados: remotos }) =>
        aplicarLancamentos(remotos),
      )

      const pararFluxo = observar(carregarFluxoMensal(), ({ dados: fluxo }) => aplicarFluxo(fluxo))

      const pararComparativo = observar(carregarComparativoMensal(), (resultado) =>
        aplicarComparativo(comparativoDe(resultado)),
      )

      const pararReceber = observar(
        listarTitulos('receber'),
        ({ dados: remotos }) => aplicarTitulos('receber', remotos),
        () => titulosIndisponiveis('receber'),
      )
      const pararPagar = observar(
        listarTitulos('pagar'),
        ({ dados: remotos }) => aplicarTitulos('pagar', remotos),
        () => titulosIndisponiveis('pagar'),
      )
      const pararResumo = observar(
        carregarResumoFinanceiro(),
        ({ dados: resumo }) => aplicarResumo(resumo),
        resumoIndisponivel,
      )
      const pararFormas = observar(listarFormasPagamento({ somenteAtivos: true }), ({ dados }) => {
        formas = dados
      })

      /** Busca de novo no banco e redesenha — usado depois de gravar. */
      const recarregar = async () => {
        const [
          { dados: remotos },
          { dados: fluxo },
          comparativo,
          { dados: contasReceber },
          { dados: contasPagar },
          { dados: resumo },
        ] = await Promise.all([
          listarLancamentos(),
          carregarFluxoMensal(),
          carregarComparativoMensal(),
          listarTitulos('receber'),
          listarTitulos('pagar'),
          carregarResumoFinanceiro(),
        ])

        aplicarLancamentos(remotos)
        aplicarFluxo(fluxo)
        aplicarComparativo(comparativoDe(comparativo))
        aplicarTitulos('receber', contasReceber)
        aplicarTitulos('pagar', contasPagar)
        aplicarResumo(resumo)
      }

      root.querySelector('[data-acao="novo-lancamento"]').addEventListener('click', () => {
        abrirFormulario({
          titulo: 'Novo lançamento',
          descricao: 'Registre uma entrada ou uma saída do caixa.',
          campos: [
            { nome: 'descricao', label: 'Descrição', tipo: 'texto', obrigatorio: true, largo: true },
            {
              nome: 'tipo',
              label: 'Tipo',
              tipo: 'select',
              opcoes: [
                { valor: 'entrada', rotulo: 'Entrada' },
                { valor: 'saida', rotulo: 'Saída' },
              ],
              obrigatorio: true,
            },
            { nome: 'valor', label: 'Valor', tipo: 'moeda', obrigatorio: true },
            {
              nome: 'categoria',
              label: 'Categoria',
              tipo: 'texto',
              obrigatorio: true,
              sugestoes: [...new Set(dados.map((l) => l.categoria))].sort(),
            },
            {
              nome: 'forma',
              label: 'Forma',
              tipo: 'texto',
              placeholder: 'Pix, Dinheiro, Crédito...',
              sugestoes: [...new Set(dados.map((l) => l.forma).filter((f) => f && f !== '—'))].sort(),
            },
            { nome: 'data', label: 'Data', tipo: 'data', obrigatorio: true },
          ],
          valores: { tipo: 'entrada', data: hoje(), valor: 0 },
          aoSalvar: async (valores) => {
            const { dados: criado, origem } = await criarLancamento(valores)

            if (origem === 'exemplo') {
              dados = [criado, ...dados]
              aplicar(input.value)
              return `${criado.descricao} entrou só nesta sessão — o Neon não está configurado.`
            }

            await recarregar()
            return `${criado.descricao} lançado no caixa.`
          },
        })
      })

      return () => {
        grafico.destroy()
        window.removeEventListener('busca-global', aoBuscarGlobal)
        root.removeEventListener('click', aoClicar)
        pararLancamentos()
        pararFluxo()
        pararComparativo()
        pararReceber()
        pararPagar()
        pararResumo()
        pararFormas()
      }
    },
  }
}
