import { abrirFormulario } from '../formulario.js'
import { renderIcons } from '../icons.js'
import {
  alterarFormaPagamentoAtivo,
  alterarTipoVendaAtivo,
  listarFormasPagamento,
  listarTiposVenda,
  salvarFormaPagamento,
  salvarTipoVenda,
} from '../services/config-vendas.js'
import { pode } from '../services/permissoes.js'
import { esc, toast } from '../ui.js'

const CATEGORIAS_TIPO = [
  { valor: 'balcao', rotulo: 'Balcão' },
  { valor: 'delivery', rotulo: 'Delivery próprio' },
  { valor: 'aplicativo', rotulo: 'Aplicativo' },
  { valor: 'personalizado', rotulo: 'Personalizado' },
]

const CATEGORIAS_PAGAMENTO = [
  { valor: 'dinheiro', rotulo: 'Dinheiro (com troco)' },
  { valor: 'pix', rotulo: 'PIX' },
  { valor: 'debito', rotulo: 'Cartão de débito' },
  { valor: 'credito', rotulo: 'Cartão de crédito' },
  { valor: 'outros', rotulo: 'Outras formas' },
]

const esquemas = {
  tipo: {
    titulo: 'tipo de venda',
    plural: 'Tipos de venda',
    colunas: CATEGORIAS_TIPO,
    listar: listarTiposVenda,
    salvar: salvarTipoVenda,
    ativar: alterarTipoVendaAtivo,
  },
  pagamento: {
    titulo: 'forma de pagamento',
    plural: 'Formas de pagamento',
    colunas: CATEGORIAS_PAGAMENTO,
    listar: listarFormasPagamento,
    salvar: salvarFormaPagamento,
    ativar: alterarFormaPagamentoAtivo,
  },
}

const rotuloCategoria = (esquema, categoria) =>
  esquema.colunas.find((item) => item.valor === categoria)?.rotulo ?? categoria

function tabelaHtml(chave) {
  const esquema = esquemas[chave]
  return `
    <section class="card config__bloco" aria-labelledby="titulo-${chave}-venda">
      <header class="config__bloco-head">
        <span class="config__bloco-icon"><i data-lucide="${chave === 'tipo' ? 'shopping-bag' : 'wallet'}"></i></span>
        <div>
          <h2 class="card__title" id="titulo-${chave}-venda">${esquema.plural}</h2>
          <p class="card__desc">Pesquise, edite e ative ou inative. Registros usados em vendas ficam preservados no histórico.</p>
        </div>
        <button class="btn btn--primary" type="button" data-novo="${chave}">
          <i data-lucide="plus"></i><span>Novo</span>
        </button>
      </header>
      <div class="toolbar">
        <input class="campo__input" type="search" data-busca="${chave}" placeholder="Pesquisar ${esquema.titulo}..." aria-label="Pesquisar ${esquema.titulo}" />
      </div>
      <div class="table-wrap">
        <table class="table" id="tabela-${chave}-venda">
          <thead><tr><th>Nome</th><th>Categoria</th><th>Situação</th><th>Ações</th></tr></thead>
          <tbody data-linhas="${chave}"><tr><td colspan="4" class="muted">Carregando...</td></tr></tbody>
        </table>
      </div>
    </section>
  `
}

export function configVendasPage() {
  return {
    html: `
      <div class="config">
        <div id="config-vendas-aviso"></div>
        ${tabelaHtml('tipo')}
        ${tabelaHtml('pagamento')}
      </div>
    `,
    mount(root) {
      let tipos = []
      let pagamentos = []
      let vivo = true
      const podeEditar = pode('configuracoes', 'editar')
      const aviso = root.querySelector('#config-vendas-aviso')

      if (!podeEditar) {
        aviso.innerHTML = '<div class="alert alert--info"><i data-lucide="info"></i><div><strong>Somente leitura</strong><p>Você pode consultar os cadastros, mas apenas quem tem permissão para editar configurações pode alterá-los.</p></div></div>'
      }

      function renderizar(chave) {
        const lista = chave === 'tipo' ? tipos : pagamentos
        const termo = root.querySelector(`[data-busca="${chave}"]`).value.trim().toLocaleLowerCase('pt-BR')
        const esquema = esquemas[chave]
        const filtrados = lista.filter((item) =>
          `${item.nome} ${item.codigo} ${rotuloCategoria(esquema, item.categoria)}`
            .toLocaleLowerCase('pt-BR')
            .includes(termo),
        )
        const tbody = root.querySelector(`[data-linhas="${chave}"]`)

        tbody.innerHTML = filtrados.length
          ? filtrados.map((item) => `
              <tr>
                <td><span class="cell-main">${esc(item.nome)}</span></td>
                <td>${esc(rotuloCategoria(esquema, item.categoria))}</td>
                <td><span class="badge ${item.ativo ? 'badge--success' : 'badge--neutral'}">${item.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td>
                  <div class="table__acoes">
                    <button class="btn btn--ghost btn--sm" type="button" data-editar="${chave}" data-id="${esc(item.id)}"${podeEditar ? '' : ' disabled'}>
                      <i data-lucide="pencil"></i><span>Editar</span>
                    </button>
                    <button class="btn btn--ghost btn--sm" type="button" data-alternar="${chave}" data-id="${esc(item.id)}"${podeEditar ? '' : ' disabled'}>
                      <i data-lucide="${item.ativo ? 'pause' : 'play'}"></i><span>${item.ativo ? 'Inativar' : 'Ativar'}</span>
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')
          : '<tr><td colspan="4" class="muted">Nenhum registro encontrado.</td></tr>'

        root.querySelector(`[data-novo="${chave}"]`).disabled = !podeEditar
        renderIcons(tbody)
      }

      async function carregarDados() {
        try {
          const [resultadoTipos, resultadoPagamentos] = await Promise.all([
            esquemas.tipo.listar(),
            esquemas.pagamento.listar(),
          ])
          if (!vivo) return
          tipos = resultadoTipos.dados
          pagamentos = resultadoPagamentos.dados
          renderizar('tipo')
          renderizar('pagamento')
        } catch (erro) {
          console.error('[config-vendas] Não foi possível carregar os cadastros.', erro)
          aviso.innerHTML = `<div class="alert alert--perigo"><i data-lucide="alert-circle"></i><div><strong>Falha ao carregar</strong><p>${esc(erro?.message ?? 'Confira a conexão e as permissões.')}</p></div></div>`
          renderIcons(aviso)
        }
      }

      function editar(chave, existente = null) {
        const esquema = esquemas[chave]
        abrirFormulario({
          titulo: existente ? `Editar ${esquema.titulo}` : `Novo ${esquema.titulo}`,
          descricao: 'Cadastros já usados não são excluídos; inative-os para removê-los das novas vendas.',
          campos: [
            {
              nome: 'nome',
              label: 'Nome',
              tipo: 'texto',
              obrigatorio: true,
              largo: true,
              placeholder: chave === 'tipo' ? 'Ex.: Retirada no balcão' : 'Ex.: Vale-refeição',
            },
            {
              nome: 'categoria',
              label: 'Categoria',
              tipo: 'select',
              opcoes: esquema.colunas,
              obrigatorio: true,
            },
          ],
          valores: existente ?? { categoria: esquema.colunas[0].valor },
          textoBotao: 'Salvar cadastro',
          aoSalvar: async (valores) => {
            const resposta = await esquema.salvar({
              ...valores,
              id: existente?.id,
              codigo: existente?.codigo,
              ativo: existente?.ativo ?? true,
            })
            const registro = resposta.origem === 'exemplo'
              ? { ...resposta.dados, id: existente?.id ?? `${chave}-${Date.now()}` }
              : resposta.dados
            const lista = chave === 'tipo' ? tipos : pagamentos
            const indice = lista.findIndex((item) => item.id === registro.id)
            if (indice >= 0) lista.splice(indice, 1, registro)
            else lista.push(registro)
            renderizar(chave)
            return resposta.origem === 'exemplo'
              ? `${esquema.titulo} salvo somente nesta sessão; o banco não está configurado.`
              : `${esquema.titulo} salvo.`
          },
        })
      }

      async function alternar(chave, id) {
        const lista = chave === 'tipo' ? tipos : pagamentos
        const item = lista.find((registro) => registro.id === id)
        if (!item) return

        try {
          const resposta = await esquemas[chave].ativar({ id, ativo: !item.ativo })
          const alterado = resposta.origem === 'exemplo'
            ? { ...item, ativo: !item.ativo }
            : resposta.dados
          const indice = lista.findIndex((registro) => registro.id === id)
          lista.splice(indice, 1, alterado)
          renderizar(chave)
          toast(resposta.origem === 'exemplo'
            ? 'Situação alterada somente nesta sessão; o banco não está configurado.'
            : `${item.nome} ${alterado.ativo ? 'ativado' : 'inativado'}.`)
        } catch (erro) {
          console.error('[config-vendas] Não foi possível alterar a situação.', erro)
          toast(erro?.message ?? 'Não foi possível alterar a situação.')
        }
      }

      const aoClicar = (evento) => {
        const novo = evento.target.closest('[data-novo]')
        if (novo) return editar(novo.dataset.novo)

        const botaoEditar = evento.target.closest('[data-editar]')
        if (botaoEditar) {
          const chave = botaoEditar.dataset.editar
          const lista = chave === 'tipo' ? tipos : pagamentos
          return editar(chave, lista.find((item) => item.id === botaoEditar.dataset.id))
        }

        const botaoAlternar = evento.target.closest('[data-alternar]')
        if (botaoAlternar) return alternar(botaoAlternar.dataset.alternar, botaoAlternar.dataset.id)
      }

      root.addEventListener('click', aoClicar)
      root.querySelectorAll('[data-busca]').forEach((campo) => {
        campo.addEventListener('input', () => renderizar(campo.dataset.busca))
      })
      renderIcons(root)
      void carregarDados()

      return () => {
        vivo = false
        root.removeEventListener('click', aoClicar)
      }
    },
  }
}
