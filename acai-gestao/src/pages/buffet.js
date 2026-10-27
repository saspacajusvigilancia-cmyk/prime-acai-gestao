import { formatNumero, esc, toast } from '../ui.js'
import { renderIcons } from '../icons.js'
import { confirmar } from '../formulario.js'
import {
  abrirFechamentoBuffet,
  fecharFechamentoBuffet,
  listarFechamentosBuffet,
  listarItensFechamentoBuffet,
  reabrirFechamentoBuffet,
} from '../services/fechamentos-buffet.js'
import { listarSaldosEstoqueLocais } from '../services/movimentacoes.js'
import {
  abastecerBuffet,
  devolverProdutoBuffet,
  listarOperacoesBuffet,
  mensagemErroBuffet,
  registrarPerdaBuffet,
  resumoFechamentoBuffet,
} from '../services/operacoes-buffet.js'
import { pode } from '../services/permissoes.js'
import { listarProdutos } from '../services/produtos.js'
import { neonConfigurado } from 'login-projetos/neon'

const dataHora = (valor) =>
  valor ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(valor)) : '—'

const statusRotulo = {
  aberto: 'Aberto',
  fechado: 'Fechado',
  reaberto: 'Reaberto',
}

const localRotulo = {
  abertura: 'Saldo inicial',
  contagem: 'Contagem',
  fornecedor: 'Fornecedor',
  estoque: 'Estoque da loja',
  estoque_geral: 'Estoque geral',
  buffet: 'Buffet',
  perda: 'Perda',
  sobra: 'Sobra',
  cliente: 'Venda',
  preparacao: 'Preparação',
  producao: 'Produção',
}

const tipoOperacaoRotulo = {
  transferencia: 'Transferência',
  perda: 'Perda',
  devolucao: 'Devolução',
  ajuste: 'Ajuste de fechamento',
}

const motivoPerdaRotulo = {
  vencimento: 'Vencimento',
  deterioracao: 'Deterioração',
  contaminacao: 'Contaminação',
  derramamento: 'Derramamento',
  desperdicio_operacional: 'Desperdício operacional',
  outro: 'Outro',
}

const condicaoRotulo = {
  lacrado: 'Lacrado',
  reaproveitavel: 'Reaproveitável',
}

const dataLocal = (data) => {
  const ano = data.getFullYear()
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const dia = String(data.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

const novaChave = () =>
  globalThis.crypto?.randomUUID?.() ??
  `buffet-${Date.now()}-${Math.random().toString(16).slice(2)}`

export function buffetPage() {
  return {
    html: `
      <section class="page">
        <header class="page-head">
          <div>
            <p class="page-eyebrow">Operação</p>
            <h1 class="page-title">Estoque Buffet</h1>
            <p class="page-subtitle">Acompanhe o saldo, faça o fechamento e preserve o histórico de ajustes.</p>
          </div>
        </header>
        <div id="buffet-root"></div>
      </section>
    `,
    mount(root) {
      const host = root.querySelector('#buffet-root')
      let produtos = []
      let saldos = new Map()
      let fechamentos = []
      let operacoes = []
      const dataAte = dataLocal(new Date())
      const dataDesdeObj = new Date()
      dataDesdeObj.setDate(dataDesdeObj.getDate() - 29)
      let filtrosOperacoes = { desde: dataLocal(dataDesdeObj), ate: dataAte, produtoId: '' }
      const chavesIdempotencia = {
        abastecimento: novaChave(),
        perda: novaChave(),
        devolucao: novaChave(),
      }
      let erro = ''

      const saldoBuffet = (produto) =>
        saldos.get(produto.uuid ?? produto.id)?.buffet ?? 0
      const saldoLocal = (produto, local) =>
        saldos.get(produto.uuid ?? produto.id)?.[local] ?? 0

      const itensElegiveis = () =>
        produtos.filter((produto) =>
          produto.ativo &&
          produto.controlaEstoque &&
          ['buffet', 'insumo'].includes(produto.tipoProduto),
        )

      async function carregarDados() {
        erro = ''
        try {
          const [resultadoProdutos, resultadoSaldos, resultadoFechamentos, resultadoOperacoes] = await Promise.all([
            listarProdutos(),
            listarSaldosEstoqueLocais(),
            listarFechamentosBuffet(),
            listarOperacoesBuffet(filtrosOperacoes),
          ])
          produtos = resultadoProdutos.dados
          saldos = new Map(resultadoSaldos.dados.map((item) => [item.produtoId, item]))
          fechamentos = resultadoFechamentos.dados
          operacoes = resultadoOperacoes.dados
        } catch (falha) {
          console.error('[buffet] Não foi possível carregar os dados do Buffet.', falha)
          erro = 'Não foi possível carregar o estoque ou o histórico do Buffet. Verifique a conexão e tente novamente.'
        }
        render()
      }

      function render() {
        const aberto = fechamentos.find((item) => item.status === 'aberto')
        const elegiveis = itensElegiveis()
        const comSaldoBuffet = elegiveis.filter((produto) => saldoBuffet(produto) > 0)
        const disponiveisNormais = elegiveis.filter((produto) =>
          saldoLocal(produto, 'loja') > 0 || saldoLocal(produto, 'geral') > 0,
        )
        const autorizadosRetorno = comSaldoBuffet.filter((produto) => produto.permiteRetornoBuffet)
        const opcoesProduto = (lista, selecionado = '') => lista.map((produto) => `
          <option value="${esc(produto.uuid ?? produto.id)}"${String(produto.uuid ?? produto.id) === String(selecionado) ? ' selected' : ''}>
            ${esc(produto.nome)} — ${formatNumero(saldoBuffet(produto))} ${esc(produto.unidade)}
          </option>
        `).join('')
        host.innerHTML = `
          ${erro ? `<div class="alert alert--danger" role="alert">${esc(erro)}</div>` : ''}
          ${!neonConfigurado ? '<p class="alert alert--warning">Modo demonstração: fechamentos e ajustes não serão salvos.</p>' : ''}
          <section class="card">
            <div class="card__head">
              <div><h2 class="card__title">Fechamento atual</h2>
                <p class="card__desc">${aberto ? `Aberto em ${esc(dataHora(aberto.abertoEm))} — ${esc(aberto.turno ?? 'Geral')}. Informe a contagem física do Buffet.` : 'Abra um ciclo para contar os produtos e reconciliar o saldo do Buffet.'}</p>
              </div>
              ${!aberto && pode('estoque', 'fechar_buffet')
                ? `<label class="campo"><span class="campo__label">Turno</span><select class="campo__input" id="buffet-turno"><option>Manhã</option><option>Tarde</option><option>Noite</option><option selected>Geral</option></select></label><button class="btn btn--primary" type="button" data-acao="abrir"><i data-lucide="clipboard-check"></i><span>Abrir fechamento</span></button>`
                : ''}
            </div>
            ${aberto ? `
              ${elegiveis.length ? `
                <div class="table-wrap">
                  <table class="table">
                    <thead><tr><th>Produto</th><th>Unidade</th><th class="ta-right">Sistema</th><th>Contagem física</th></tr></thead>
                    <tbody>${elegiveis.map((produto) => `
                      <tr>
                        <td><strong>${esc(produto.nome)}</strong><span class="cell-sub">${esc(produto.id)}</span></td>
                        <td>${esc(produto.unidade)}</td>
                        <td class="ta-right">${formatNumero(saldoBuffet(produto))}</td>
                        <td><input class="campo__input" type="number" min="0" step="0.001"
                          data-produto="${esc(produto.uuid ?? produto.id)}"
                          value="${saldoBuffet(produto)}" aria-label="Contagem de ${esc(produto.nome)}" /></td>
                      </tr>
                    `).join('')}</tbody>
                  </table>
                </div>
                <div class="card__actions">
                  ${pode('estoque', 'fechar_buffet')
                    ? '<button class="btn btn--primary" type="button" data-acao="fechar">Confirmar fechamento</button>'
                    : ''}
                </div>
              ` : '<p class="alert alert--warning">Não há produtos ativos de Buffet ou insumos com controle de estoque para contar.</p>'}
            ` : '<p class="muted">Nenhum fechamento está aberto.</p>'}
          </section>
          <section class="card">
            <div class="card__head"><div><h2 class="card__title">Operação do Buffet</h2>
              <p class="card__desc">Abasteça a partir de um local autorizado, registre perdas e devolva somente produtos previamente autorizados.</p></div>
            </div>
            <div class="table-wrap"><table class="table"><thead><tr><th>Indicador</th><th>Resultado</th></tr></thead>
              <tbody><tr><td>Produtos controlados com saldo no Buffet</td><td>${comSaldoBuffet.length}</td></tr>
              <tr><td>Produtos autorizados para retorno ao Estoque Normal</td><td>${autorizadosRetorno.length}</td></tr></tbody></table></div>
            ${elegiveis.length ? `<div class="table-wrap"><table class="table">
              <thead><tr><th>Produto</th><th>Unidade</th><th>Estoque da loja</th><th>Estoque geral</th><th>Buffet</th></tr></thead>
              <tbody>${elegiveis.map((produto) => `<tr>
                <td>${esc(produto.nome)}</td><td>${esc(produto.unidade)}</td>
                <td>${formatNumero(saldoLocal(produto, 'loja'))}</td>
                <td>${formatNumero(saldoLocal(produto, 'geral'))}</td>
                <td>${formatNumero(saldoBuffet(produto))}</td></tr>`).join('')}</tbody>
              </table></div>` : '<p class="muted">Cadastre produtos como Buffet ou insumos e habilite o controle de estoque para operar este local.</p>'}
            ${pode('estoque', 'criar') ? `
              <form data-form-operacao="abastecimento" class="buffet__form">
                <label class="campo"><span class="campo__label">Produto a abastecer</span><select class="campo__input" name="produtoId" required>${opcoesProduto(disponiveisNormais)}</select></label>
                <label class="campo"><span class="campo__label">Origem</span><select class="campo__input" name="origem"><option value="estoque">Estoque da loja</option><option value="estoque_geral">Estoque geral</option></select></label>
                <label class="campo"><span class="campo__label">Quantidade</span><input class="campo__input" name="quantidade" type="number" min="0.001" step="0.001" required /></label>
                <label class="campo"><span class="campo__label">Motivo</span><input class="campo__input" name="motivo" maxlength="500" required value="Abastecimento do Buffet" /></label>
                <button class="btn btn--primary" type="submit">Abastecer Buffet</button>
              </form>
              <form data-form-operacao="perda" class="buffet__form">
                <label class="campo"><span class="campo__label">Produto perdido</span><select class="campo__input" name="produtoId" required>${opcoesProduto(comSaldoBuffet)}</select></label>
                <label class="campo"><span class="campo__label">Quantidade</span><input class="campo__input" name="quantidade" type="number" min="0.001" step="0.001" required /></label>
                <label class="campo"><span class="campo__label">Motivo da perda</span><select class="campo__input" name="motivo" required><option value="vencimento">Vencimento</option><option value="deterioracao">Deterioração</option><option value="contaminacao">Contaminação</option><option value="derramamento">Derramamento</option><option value="desperdicio_operacional">Desperdício operacional</option><option value="outro">Outro</option></select></label>
                <label class="campo"><span class="campo__label">Observações</span><input class="campo__input" name="observacoes" maxlength="1000" /></label>
                <button class="btn btn--ghost" type="submit">Registrar perda</button>
              </form>
              <form data-form-operacao="devolucao" class="buffet__form">
                <label class="campo"><span class="campo__label">Produto autorizado</span><select class="campo__input" name="produtoId" required>${opcoesProduto(autorizadosRetorno)}</select></label>
                <label class="campo"><span class="campo__label">Quantidade</span><input class="campo__input" name="quantidade" type="number" min="0.001" step="0.001" required /></label>
                <label class="campo"><span class="campo__label">Condição</span><select class="campo__input" name="condicao"><option value="lacrado">Lacrado</option><option value="reaproveitavel">Reaproveitável</option></select></label>
                <label class="campo"><span class="campo__label">Motivo</span><input class="campo__input" name="motivo" maxlength="500" required /></label>
                <label class="campo"><span class="campo__label">Observações</span><input class="campo__input" name="observacoes" maxlength="1000" /></label>
                <button class="btn btn--ghost" type="submit">Devolver ao Estoque Normal</button>
              </form>
            ` : '<p class="muted">Sua conta não tem permissão para registrar operações de estoque.</p>'}
          </section>
          <section class="card">
            <div class="card__head"><div><h2 class="card__title">Operações recentes</h2>
              <p class="card__desc">Histórico de abastecimentos, perdas e devoluções no período selecionado (até 500 registros mais recentes).</p></div></div>
            <form data-form-filtro="operacoes" class="buffet__form">
              <label class="campo"><span class="campo__label">De</span><input class="campo__input" type="date" name="desde" value="${esc(filtrosOperacoes.desde)}" /></label>
              <label class="campo"><span class="campo__label">Até</span><input class="campo__input" type="date" name="ate" value="${esc(filtrosOperacoes.ate)}" /></label>
              <label class="campo"><span class="campo__label">Produto</span><select class="campo__input" name="produtoId"><option value="">Todos</option>${opcoesProduto(elegiveis, filtrosOperacoes.produtoId)}</select></label>
              <button class="btn btn--ghost" type="submit">Filtrar</button>
            </form>
            ${operacoes.length ? `<div class="table-wrap"><table class="table">
              <thead><tr><th>Data</th><th>Operação</th><th>Produto</th><th>Quantidade</th><th>Detalhe</th><th>Responsável</th></tr></thead>
              <tbody>${operacoes.map((item) => `<tr>
                <td>${esc(dataHora(item.criadoEm))}</td><td>${esc(tipoOperacaoRotulo[item.tipo] ?? item.tipo)}</td>
                <td>${esc(item.produtoNome)}</td><td>${formatNumero(item.quantidade)} ${esc(item.unidade)}</td>
                <td>${esc(`${localRotulo[item.origem] ?? item.origem} → ${localRotulo[item.destino] ?? item.destino}${item.condicao ? ` · ${condicaoRotulo[item.condicao] ?? item.condicao}` : ''} · ${motivoPerdaRotulo[item.motivo] ?? item.motivo}`)}</td>
                <td>${esc(item.responsavel)}</td></tr>`).join('')}</tbody></table></div>`
              : '<p class="muted">Nenhuma operação encontrada no período selecionado.</p>'}
          </section>
          <section class="card">
            <div class="card__head">
              <div><h2 class="card__title">Histórico</h2>
                <p class="card__desc">Fechamentos, ajustes e reaberturas permanecem registrados.</p></div>
            </div>
            ${fechamentos.length ? `
              <div class="table-wrap"><table class="table">
                <thead><tr><th>Data operacional</th><th>Turno</th><th>Aberto em</th><th>Fechado em</th><th>Status</th><th>Motivo de reabertura</th><th>Ações</th></tr></thead>
                <tbody>${fechamentos.map((item) => `
                  <tr>
                    <td>${esc(item.dataOperacional ?? '—')}</td>
                    <td>${esc(item.turno ?? 'Geral')}</td>
                    <td>${esc(dataHora(item.abertoEm))}</td>
                    <td>${esc(dataHora(item.fechadoEm))}</td>
                    <td>${esc(statusRotulo[item.status] ?? item.status)}</td>
                    <td>${esc(item.motivoReabertura ?? '—')}</td>
                    <td>
                      <button class="btn btn--ghost btn--sm" type="button" data-acao="detalhes" data-id="${esc(item.id)}">Ver itens</button>
                      ${item.status === 'fechado' && pode('estoque', 'reabrir_buffet') ? `
                        <form data-form-reabertura="${esc(item.id)}" class="table__acoes">
                          <input class="campo__input" name="motivo" required maxlength="300" placeholder="Motivo da reabertura" aria-label="Motivo da reabertura" />
                          <button class="btn btn--ghost btn--sm" type="submit">Reabrir</button>
                        </form>
                      ` : ''}
                    </td>
                  </tr>`).join('')}
                </tbody>
              </table></div>
            ` : '<p class="muted">Ainda não há fechamentos registrados.</p>'}
          </section>
          <section class="card" id="buffet-detalhes" hidden></section>
        `
        renderIcons(host)

        host.querySelector('[data-acao="abrir"]')?.addEventListener('click', async (evento) => {
          const botao = evento.currentTarget
          botao.disabled = true
          try {
            const turno = host.querySelector('#buffet-turno')?.value ?? 'Geral'
            const resultado = await abrirFechamentoBuffet(turno)
            if (resultado.origem === 'exemplo') {
              toast('Modo demonstração: o fechamento não foi salvo.')
              return
            }
            toast('Fechamento do Buffet aberto.')
            await carregarDados()
          } catch (falha) {
            console.error('[buffet] Falha ao abrir fechamento.', falha)
            toast(mensagemErroBuffet(falha))
          } finally {
            if (botao.isConnected) botao.disabled = false
          }
        })

        host.querySelector('[data-acao="fechar"]')?.addEventListener('click', async () => {
          // Campo vazio não é zero: `Number('')` vira 0 e fecharia o turno
          // zerando o saldo de produtos que ninguém contou.
          const itens = [...host.querySelectorAll('[data-produto]')].map((campo) => ({
            produtoId: campo.dataset.produto,
            quantidade: campo.value.trim() === '' ? Number.NaN : Number(campo.value),
          }))
          if (itens.some((item) => !Number.isFinite(item.quantidade) || item.quantidade < 0)) {
            toast('Informe a contagem de todos os produtos antes de fechar o turno.')
            return
          }
          const aceitou = await confirmar({
            titulo: 'Confirmar fechamento do Buffet?',
            descricao: 'A contagem vai registrar os ajustes no livro-razão e preservar o resumo deste turno.',
            textoBotao: 'Confirmar fechamento',
          })
          if (!aceitou) return
          const botao = host.querySelector('[data-acao="fechar"]')
          botao.disabled = true
          try {
            const resultado = await fecharFechamentoBuffet(aberto.id, itens)
            if (resultado.origem === 'exemplo') {
              toast('Modo demonstração: o fechamento não foi salvo.')
              return
            }
            toast(`Fechamento concluído. ${resultado.dados.ajustes} ajuste(s) registrado(s).`)
            await carregarDados()
          } catch (falha) {
            console.error('[buffet] Falha ao fechar estoque.', falha)
            toast(mensagemErroBuffet(falha))
          } finally {
            if (botao.isConnected) botao.disabled = false
          }
        })

        host.querySelectorAll('[data-form-operacao]').forEach((formulario) => {
          formulario.addEventListener('submit', async (evento) => {
            evento.preventDefault()
            if (!formulario.reportValidity()) return
            const tipo = formulario.dataset.formOperacao
            const valores = new FormData(formulario)
            const produtoId = valores.get('produtoId')
            const produto = produtos.find((item) => (item.uuid ?? item.id) === produtoId)
            const quantidade = Number(valores.get('quantidade'))
            const descricao = `${formatNumero(quantidade)} ${produto?.unidade ?? ''} de ${produto?.nome ?? 'produto'}`
            const titulo = tipo === 'abastecimento'
              ? 'Confirmar abastecimento do Buffet?'
              : tipo === 'perda'
                ? 'Confirmar registro da perda?'
                : 'Confirmar devolução ao Estoque Normal?'
            const detalhe = tipo === 'abastecimento'
              ? `Será transferido ${descricao} para o Buffet.`
              : tipo === 'perda'
                ? `Será baixado ${descricao} do saldo do Buffet.`
                : `Será transferido ${descricao} do Buffet para o Estoque da loja.`
            if (!await confirmar({ titulo, descricao: detalhe, textoBotao: 'Confirmar operação' })) return

            const botao = formulario.querySelector('[type="submit"]')
            botao.disabled = true
            try {
              let resultado
              if (tipo === 'abastecimento') {
                resultado = await abastecerBuffet({
                  produtoId,
                  quantidade,
                  origem: valores.get('origem'),
                  motivo: valores.get('motivo'),
                  chaveIdempotencia: chavesIdempotencia.abastecimento,
                })
              } else if (tipo === 'perda') {
                resultado = await registrarPerdaBuffet({
                  produtoId,
                  quantidade,
                  motivo: valores.get('motivo'),
                  observacoes: valores.get('observacoes'),
                  chaveIdempotencia: chavesIdempotencia.perda,
                })
              } else {
                resultado = await devolverProdutoBuffet({
                  produtoId,
                  quantidade,
                  condicao: valores.get('condicao'),
                  motivo: valores.get('motivo'),
                  observacoes: valores.get('observacoes'),
                  chaveIdempotencia: chavesIdempotencia.devolucao,
                })
              }
              if (resultado.origem === 'exemplo') {
                toast('Modo demonstração: a operação não foi salva.')
                return
              }
              chavesIdempotencia[tipo] = novaChave()
              toast(tipo === 'abastecimento'
                ? 'Abastecimento do Buffet registrado.'
                : tipo === 'perda'
                  ? 'Perda do Buffet registrada.'
                  : 'Devolução ao Estoque Normal registrada.')
              await carregarDados()
            } catch (falha) {
              console.error(`[buffet] Falha na operação ${tipo}.`, falha)
              toast(mensagemErroBuffet(falha))
            } finally {
              if (botao.isConnected) botao.disabled = false
            }
          })
        })

        host.querySelector('[data-form-filtro="operacoes"]')?.addEventListener('submit', async (evento) => {
          evento.preventDefault()
          const valores = new FormData(evento.currentTarget)
          filtrosOperacoes = {
            desde: valores.get('desde') || '',
            ate: valores.get('ate') || '',
            produtoId: valores.get('produtoId') || '',
          }
          await carregarDados()
        })

        host.querySelectorAll('[data-acao="detalhes"]').forEach((botao) => {
          botao.addEventListener('click', async () => {
            const detalhes = host.querySelector('#buffet-detalhes')
            try {
              const [resultado, resumo] = await Promise.all([
                listarItensFechamentoBuffet(botao.dataset.id),
                resumoFechamentoBuffet(botao.dataset.id),
              ])
              const resumoPorProduto = new Map(resumo.dados.map((item) => [item.produtoId, item]))
              detalhes.hidden = false
              detalhes.innerHTML = `
                <div class="card__head"><div><h2 class="card__title">Reconciliação do turno</h2>
                  <p class="card__desc">Consumo estimado = saldo inicial + abastecimentos − devoluções − perdas − vendas diretas − saldo contado. Consumo aparente não desconta perdas.</p></div></div>
                <div class="table-wrap"><table class="table">
                  <thead><tr><th>Produto</th><th>Un.</th><th>Inicial</th><th>Abastecido</th><th>Devolvido</th><th>Perdas</th><th>Venda direta</th><th>Consumo aparente</th><th>Consumo estimado</th><th>Sistema</th><th>Contado</th><th>Divergência</th></tr></thead>
                  <tbody>${resultado.dados.map((item) => `
                    ${(() => {
                      const metricas = resumoPorProduto.get(item.produtoId)
                      return `<tr><td>${esc(item.produtoNome)}</td><td>${esc(metricas?.unidade ?? '')}</td>
                        <td>${formatNumero(metricas?.saldoInicial ?? 0)}</td><td>${formatNumero(metricas?.abastecido ?? 0)}</td>
                        <td>${formatNumero(metricas?.devolvido ?? 0)}</td><td>${formatNumero(metricas?.perdas ?? 0)}</td>
                        <td>${formatNumero(metricas?.vendaDireta ?? 0)}</td><td>${formatNumero(metricas?.consumoAparente ?? 0)}</td>
                        <td>${formatNumero(metricas?.consumoEstimado ?? 0)}</td><td>${formatNumero(item.saldoSistema)}</td>
                        <td>${formatNumero(item.saldoContado)}</td><td>${formatNumero(item.diferenca)}</td></tr>`
                    })()}
                  `).join('')}</tbody>
                </table></div>
                ${resumo.dados.length ? '' : '<p class="alert alert--warning">Este fechamento é anterior ao registro de snapshots por turno; os dados históricos de consumo não estão disponíveis.</p>'}
                <p class="campo__ajuda">O custo histórico por turno não é calculado: o sistema não mantém snapshot de custo por fechamento, então o custo atual não seria confiável para este relatório.</p>`
            } catch (falha) {
              console.error('[buffet] Falha ao consultar itens do fechamento.', falha)
              toast(mensagemErroBuffet(falha))
            }
          })
        })

        host.querySelectorAll('[data-form-reabertura]').forEach((formulario) => {
          formulario.addEventListener('submit', async (evento) => {
            evento.preventDefault()
            const motivo = new FormData(formulario).get('motivo')
            try {
              const resultado = await reabrirFechamentoBuffet(formulario.dataset.formReabertura, motivo)
              if (resultado.origem === 'exemplo') {
                toast('Modo demonstração: a reabertura não foi salva.')
                return
              }
              toast('Fechamento reaberto. O histórico original foi preservado.')
              await carregarDados()
            } catch (falha) {
              console.error('[buffet] Falha ao reabrir fechamento.', falha)
              toast(mensagemErroBuffet(falha))
            }
          })
        })
      }

      render()
      void carregarDados()
    },
  }
}
