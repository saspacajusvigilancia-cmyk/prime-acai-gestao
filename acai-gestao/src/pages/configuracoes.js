/**
 * Configuração da Empresa.
 *
 * Chega-se aqui pela engrenagem do rodapé do menu lateral (o `main.js` liga o
 * clique ao roteador). A página tem a mesma cara do resto do sistema: cartões,
 * campos e botões já usados nos formulários modais.
 *
 * Três coisas que valem explicação:
 *
 * 1. A gravação é BLOQUEADA quando a leitura falha. Se o formulário abrisse
 *    vazio por causa de um erro de rede e o usuário salvasse, ele apagaria a
 *    configuração que existe no banco sem perceber.
 * 2. A imagem só é gravada ao clicar em "Salvar alterações" — assim "Cancelar"
 *    descarta de verdade a escolha.
 * 3. Sem o Neon configurado a tela funciona, mas diz em voz alta que nada
 *    foi gravado, em vez de fingir que salvou.
 */

import { campoHtml, confirmar } from '../formulario.js'
import { renderIcons } from '../icons.js'
import { estadoSessao } from 'login-projetos/sessao'
import { emailValido } from 'login-projetos/auth'
import { neonConfigurado } from '../services/base.js'
import {
  FUSOS,
  PREFERENCIAS_PADRAO,
  UFS,
  apenasDigitos,
  carregarEmpresa,
  carregarLogo,
  cepValido,
  cnpjValido,
  mascaraCep,
  mascaraCnpj,
  mascaraTelefone,
  mensagemDoErro,
  removerLogo,
  salvarEmpresa,
  salvarLogo,
  telefoneValido,
  urlDaLogo,
  validarLogo,
} from '../services/empresa.js'
import { esc, toast } from '../ui.js'
import { pode } from '../services/permissoes.js'
import { gerenciarFilial, listarFiliais } from '../services/filiais.js'
import { permissoesPage } from './permissoes.js'
import { usuariosPage } from './usuarios.js'
import { configProdutosPage, configVendasPage } from './config-vendas.js'

/* ==========================================================================
   Declaração dos grupos
   ========================================================================== */

const GRUPOS = [
  {
    id: 'identificacao',
    icone: 'building-2',
    titulo: 'Identificação da empresa',
    descricao: 'Como a empresa aparece no sistema e nos documentos.',
    campos: [
      {
        nome: 'nome_fantasia',
        label: 'Nome fantasia',
        obrigatorio: true,
        largo: true,
        placeholder: 'Prime Açaí',
      },
      {
        nome: 'razao_social',
        label: 'Razão social',
        obrigatorio: true,
        largo: true,
        placeholder: 'Prime Açaí Comércio de Alimentos LTDA',
      },
      {
        nome: 'cnpj',
        label: 'CNPJ',
        obrigatorio: true,
        mascara: 'cnpj',
        placeholder: '00.000.000/0000-00',
      },
      { nome: 'inscricao_estadual', label: 'Inscrição estadual', ajuda: 'Opcional' },
      { nome: 'inscricao_municipal', label: 'Inscrição municipal', ajuda: 'Opcional' },
    ],
  },
  {
    id: 'contato',
    icone: 'phone',
    titulo: 'Contato',
    descricao: 'Canais que aparecem no cupom e no atendimento ao cliente.',
    campos: [
      {
        nome: 'telefone',
        label: 'Telefone',
        obrigatorio: true,
        mascara: 'telefone',
        placeholder: '(85) 3333-4444',
      },
      {
        nome: 'whatsapp',
        label: 'WhatsApp',
        mascara: 'telefone',
        ajuda: 'Opcional',
        placeholder: '(85) 99999-8888',
      },
      {
        nome: 'email',
        label: 'E-mail',
        obrigatorio: true,
        placeholder: 'contato@primeacai.com.br',
      },
      {
        nome: 'site',
        label: 'Site ou rede social',
        ajuda: 'Opcional',
        placeholder: 'https://instagram.com/primeacai',
      },
    ],
  },
  {
    id: 'endereco',
    icone: 'map-pin',
    titulo: 'Endereço',
    descricao: 'Endereço da loja, usado em documentos e entregas.',
    campos: [
      {
        nome: 'cep',
        label: 'CEP',
        obrigatorio: true,
        mascara: 'cep',
        placeholder: '00000-000',
      },
      { nome: 'uf', label: 'Estado (UF)', tipo: 'select', opcoes: UFS, obrigatorio: true },
      { nome: 'municipio', label: 'Município', obrigatorio: true, placeholder: 'Fortaleza' },
      { nome: 'bairro', label: 'Bairro', obrigatorio: true },
      { nome: 'logradouro', label: 'Rua ou avenida', obrigatorio: true, largo: true },
      { nome: 'numero', label: 'Número', obrigatorio: true, placeholder: '123' },
      { nome: 'complemento', label: 'Complemento', ajuda: 'Opcional', placeholder: 'Loja 2' },
      {
        nome: 'referencia',
        label: 'Ponto de referência',
        ajuda: 'Opcional',
        largo: true,
        placeholder: 'Ao lado da praça',
      },
    ],
  },
]

const PREFERENCIAS = {
  id: 'preferencias',
  icone: 'clock',
  titulo: 'Preferências',
  descricao: 'Valores que o sistema aplica em todas as telas.',
  campos: [
    {
      nome: 'moeda',
      label: 'Moeda padrão',
      tipo: 'select',
      vazio: false,
      opcoes: [{ valor: 'BRL', rotulo: 'Real brasileiro (BRL)' }],
      ajuda: 'O sistema formata valores em reais em todas as telas.',
    },
    {
      nome: 'fuso',
      label: 'Fuso horário padrão',
      tipo: 'select',
      vazio: false,
      opcoes: FUSOS,
    },
    {
      nome: 'formato_data',
      label: 'Formato de data',
      tipo: 'select',
      vazio: false,
      opcoes: [{ valor: 'DD/MM/AAAA', rotulo: 'DD/MM/AAAA' }],
      ajuda: 'O sistema usa este formato em todas as telas.',
    },
  ],
}

/** Máscaras aplicadas enquanto o usuário digita. */
const MASCARAS = {
  cnpj: mascaraCnpj,
  cep: mascaraCep,
  telefone: mascaraTelefone,
}

/* ==========================================================================
   HTML
   ========================================================================== */

function grupoHtml(grupo) {
  return `
    <section class="card config__bloco" aria-labelledby="titulo-${grupo.id}">
      <header class="config__bloco-head">
        <span class="config__bloco-icon"><i data-lucide="${grupo.icone}"></i></span>
        <div>
          <h2 class="card__title" id="titulo-${grupo.id}">${esc(grupo.titulo)}</h2>
          <p class="card__desc">${esc(grupo.descricao)}</p>
        </div>
      </header>
      <div class="config__campos">
        ${grupo.campos.map((campo) => campoHtml(campo, '')).join('')}
      </div>
    </section>
  `
}

const LOGOMARCA_HTML = `
  <section class="card config__bloco" aria-labelledby="titulo-logomarca">
    <header class="config__bloco-head">
      <span class="config__bloco-icon"><i data-lucide="image"></i></span>
      <div>
        <h2 class="card__title" id="titulo-logomarca">Logomarca</h2>
        <p class="card__desc">PNG, JPG, JPEG ou WEBP, até 2 MB.</p>
      </div>
    </header>

    <div class="logo">
      <div class="logo__previa" id="logo-previa"></div>

      <div class="logo__lado">
        <p class="logo__nome" id="logo-nome">Nenhum arquivo selecionado.</p>
        <p class="logo__dica" id="logo-dica">A imagem é enviada ao salvar as alterações.</p>

        <div class="logo__acoes">
          <button class="btn btn--ghost" type="button" id="btn-escolher">
            <i data-lucide="upload"></i><span>Selecionar arquivo</span>
          </button>
          <button class="btn btn--danger" type="button" id="btn-remover" hidden>
            <i data-lucide="trash-2"></i><span>Remover logomarca</span>
          </button>
        </div>

        <input type="file" id="logo-arquivo" accept="image/png,image/jpeg,image/webp" hidden />
        <p class="logo__erro" id="logo-erro" role="alert" hidden></p>
      </div>
    </div>
  </section>
`

function painelFiliaisHtml(podeEditar) {
  const bloqueado = podeEditar ? '' : ' disabled'
  return `
    <div class="config-filiais">
      <header class="config-filiais__cabecalho">
        <div>
          <h2>Filiais e lojas</h2>
          <p>Cadastre unidades da empresa. O número e o código são gerados pelo banco.</p>
        </div>
      </header>

      <div id="filiais-aviso"></div>
      <p class="config-filiais__feedback" id="filiais-feedback" role="status" aria-live="polite" hidden></p>

      <form class="card config-filiais__form" id="filial-form" novalidate>
        <div class="config__bloco-head">
          <span class="config__bloco-icon"><i data-lucide="store"></i></span>
          <div>
            <h3 class="card__title" id="filial-form-titulo">Cadastrar filial</h3>
            <p class="card__desc">Os campos fiscais e de contato são opcionais.</p>
          </div>
        </div>

        <div class="config__campos">
          <label class="campo">
            <span class="campo__label">Nome da loja <span class="campo__req">*</span></span>
            <input class="campo__input" name="nome" maxlength="120" required${bloqueado} />
          </label>
          <label class="campo">
            <span class="campo__label">Nome fantasia</span>
            <input class="campo__input" name="nome_fantasia" maxlength="120"${bloqueado} />
          </label>
          <label class="campo">
            <span class="campo__label">CNPJ ou CPF</span>
            <input class="campo__input" name="cnpj" maxlength="20"${bloqueado} />
          </label>
          <label class="campo">
            <span class="campo__label">Responsável</span>
            <input class="campo__input" name="responsavel" maxlength="120"${bloqueado} />
          </label>
          <label class="campo">
            <span class="campo__label">Telefone</span>
            <input class="campo__input" name="telefone" type="tel" maxlength="30"${bloqueado} />
          </label>
          <label class="campo">
            <span class="campo__label">WhatsApp</span>
            <input class="campo__input" name="whatsapp" type="tel" maxlength="30"${bloqueado} />
          </label>
          <label class="campo">
            <span class="campo__label">E-mail</span>
            <input class="campo__input" name="email" type="email" maxlength="254"${bloqueado} />
          </label>
          <label class="campo config-filiais__endereco">
            <span class="campo__label">Endereço</span>
            <textarea class="campo__input" name="endereco" rows="2" maxlength="500"${bloqueado}></textarea>
          </label>
        </div>

        <div class="config-filiais__acoes">
          <button class="btn btn--ghost" type="button" id="filial-cancelar" hidden${bloqueado}>
            <i data-lucide="x"></i><span>Cancelar edição</span>
          </button>
          <button class="btn btn--primary" type="submit" id="filial-salvar"${bloqueado}>
            <i data-lucide="save"></i><span>Salvar filial</span>
          </button>
        </div>
      </form>

      <section class="config-filiais__lista" aria-labelledby="filiais-titulo">
        <header class="config-filiais__lista-head">
          <div>
            <h3 id="filiais-titulo">Unidades cadastradas</h3>
            <p>Filiais inativas permanecem no histórico e não são excluídas.</p>
          </div>
        </header>
        <div id="filiais-lista" aria-live="polite"></div>
      </section>
    </div>
  `
}

function iniciarPainelFiliais(root, podeEditar) {
  const form = root.querySelector('#filial-form')
  const lista = root.querySelector('#filiais-lista')
  const aviso = root.querySelector('#filiais-aviso')
  const feedback = root.querySelector('#filiais-feedback')
  const titulo = root.querySelector('#filial-form-titulo')
  const botaoSalvar = root.querySelector('#filial-salvar')
  const botaoCancelar = root.querySelector('#filial-cancelar')
  const podeGravar = podeEditar && neonConfigurado
  let filiais = []
  let filialEditada = null
  let salvando = false
  let vivo = true
  let consulta = 0

  function mostrarFeedback(texto, tipo = 'erro') {
    feedback.textContent = texto
    feedback.classList.toggle('config-filiais__feedback--erro', tipo === 'erro')
    feedback.hidden = !texto
  }

  function mostrarAviso() {
    const texto = !neonConfigurado
      ? 'Configure a conexão com o banco para consultar e salvar filiais. Nenhum dado de exemplo é usado nesta lista.'
      : !podeEditar
        ? 'Você pode consultar as unidades, mas não tem permissão para alterá-las.'
        : ''
    aviso.innerHTML = texto
      ? `<div class="alert alert--info"><i data-lucide="info"></i><div><strong>Filiais</strong><p>${esc(texto)}</p></div></div>`
      : ''
    renderIcons(aviso)
  }

  function renderizarLista() {
    if (!filiais.length) {
      lista.innerHTML = '<div class="card config-filiais__vazio">Nenhuma filial foi encontrada para esta empresa.</div>'
      return
    }

    lista.innerHTML = filiais
      .map((filial) => {
        const numero = String(filial.numero ?? '').padStart(2, '0')
        const descricao = filial.tipo === 'matriz' ? 'Matriz' : 'Filial'
        const acoes = podeGravar
          ? `
              <button class="btn btn--ghost btn--sm" type="button" data-filial-editar="${esc(filial.id)}">
                <i data-lucide="pencil"></i><span>Editar</span>
              </button>
              ${
                filial.tipo === 'matriz'
                  ? '<span class="config-filiais__principal"><i data-lucide="star"></i>Matriz</span>'
                  : filial.ativo
                    ? `<button class="btn btn--ghost btn--sm" type="button" data-filial-matriz="${esc(filial.id)}"><i data-lucide="star"></i><span>Definir matriz</span></button>`
                    : ''
              }
              <button class="btn btn--ghost btn--sm" type="button" data-filial-status="${esc(filial.id)}" data-ativo="${String(Boolean(filial.ativo))}">
                <i data-lucide="${filial.ativo ? 'ban' : 'check'}"></i><span>${filial.ativo ? 'Desativar' : 'Ativar'}</span>
              </button>
            `
          : ''
        return `
          <article class="card config-filiais__item">
            <div class="config-filiais__item-info">
              <div class="config-filiais__item-title">
                <span class="config-filiais__codigo">LOJA ${esc(numero)}</span>
                <span class="config-filiais__tipo">${esc(descricao)}</span>
                <span class="badge ${filial.ativo ? 'badge--success' : 'badge--neutral'}">${filial.ativo ? 'Ativa' : 'Inativa'}</span>
              </div>
              <h4>${esc(filial.nome)}</h4>
              ${filial.nome_fantasia ? `<p>${esc(filial.nome_fantasia)}</p>` : ''}
              <div class="config-filiais__detalhes">
                ${filial.cnpj ? `<span>${esc(filial.cnpj)}</span>` : ''}
                ${filial.telefone ? `<span>${esc(filial.telefone)}</span>` : ''}
                ${filial.email ? `<span>${esc(filial.email)}</span>` : ''}
                ${filial.endereco ? `<span>${esc(filial.endereco)}</span>` : ''}
              </div>
            </div>
            <div class="config-filiais__item-acoes">${acoes}</div>
          </article>
        `
      })
      .join('')
    renderIcons(lista)
  }

  function limparFormulario() {
    filialEditada = null
    form.reset()
    titulo.textContent = 'Cadastrar filial'
    botaoSalvar.querySelector('span').textContent = 'Salvar filial'
    botaoCancelar.hidden = true
    mostrarFeedback('')
  }

  function prepararEdicao(filial) {
    filialEditada = filial.id
    for (const campo of form.elements) {
      if (campo.name) campo.value = filial[campo.name] ?? ''
    }
    titulo.textContent = 'Editar filial'
    botaoSalvar.querySelector('span').textContent = 'Salvar alterações'
    botaoCancelar.hidden = false
    mostrarFeedback('')
    form.querySelector('[name="nome"]')?.focus()
  }

  async function carregarLista() {
    const idConsulta = ++consulta
    lista.innerHTML = '<div class="card config-filiais__vazio" role="status">Carregando filiais...</div>'
    mostrarFeedback('')

    try {
      const resultado = await listarFiliais()
      if (!vivo || idConsulta !== consulta) return
      filiais = resultado.origem === 'neon' ? resultado.dados ?? [] : []
      renderizarLista()
    } catch (erro) {
      if (!vivo || idConsulta !== consulta) return
      console.error('[configuracoes] Falha ao carregar filiais.', {
        code: erro?.code ?? 'sem código',
        name: erro?.name ?? 'Error',
      })
      lista.innerHTML = ''
      mostrarFeedback('Não foi possível carregar as filiais. Verifique a conexão e tente novamente.')
    }
  }

  async function salvar(evento) {
    evento.preventDefault()
    if (salvando || !podeGravar) return

    const dados = Object.fromEntries(new FormData(form).entries())
    for (const chave of Object.keys(dados)) dados[chave] = String(dados[chave]).trim()

    if (!dados.nome) {
      mostrarFeedback('Informe o nome da loja.')
      form.elements.nome.focus()
      return
    }
    const digitosDocumento = apenasDigitos(dados.cnpj)
    if (digitosDocumento && ![11, 14].includes(digitosDocumento.length)) {
      mostrarFeedback('CNPJ ou CPF deve conter 11 ou 14 dígitos.')
      form.elements.cnpj.focus()
      return
    }
    if (dados.email && !emailValido(dados.email)) {
      mostrarFeedback('Informe um e-mail válido ou deixe o campo em branco.')
      form.elements.email.focus()
      return
    }

    salvando = true
    const editando = Boolean(filialEditada)
    botaoSalvar.disabled = true
    botaoSalvar.querySelector('span').textContent = 'Salvando...'
    mostrarFeedback('')
    try {
      await gerenciarFilial(filialEditada ? 'editar' : 'criar', filialEditada, dados)
      limparFormulario()
      await carregarLista()
      toast(editando ? 'Filial atualizada.' : 'Filial cadastrada.')
    } catch (erro) {
      console.error('[configuracoes] Falha ao salvar filial.', {
        code: erro?.code ?? 'sem código',
        name: erro?.name ?? 'Error',
      })
      mostrarFeedback(
        erro?.code === '23505'
          ? 'Não foi possível gerar um código único para a filial. Atualize a lista e tente novamente.'
          : 'Não foi possível salvar a filial. Confira os dados, sua permissão e a conexão.',
      )
    } finally {
      salvando = false
      botaoSalvar.disabled = !podeGravar
      botaoSalvar.querySelector('span').textContent = filialEditada
        ? 'Salvar alterações'
        : 'Salvar filial'
    }
  }

  async function executarAcao(operacao, filial) {
    if (!podeGravar || salvando) return
    if (operacao === 'desativar') {
      const confirmado = await confirmar({
        titulo: `Desativar ${filial.nome}?`,
        descricao: 'A unidade deixa de receber novas operações, mas seus registros históricos serão preservados.',
        textoBotao: 'Desativar filial',
      })
      if (!confirmado) return
    }

    try {
      await gerenciarFilial(operacao, filial.id)
      if (filialEditada === filial.id) limparFormulario()
      await carregarLista()
      toast(
        operacao === 'definir_matriz'
          ? 'Matriz atualizada.'
          : operacao === 'desativar'
            ? 'Filial desativada.'
            : operacao === 'ativar'
              ? 'Filial ativada.'
              : 'Filial atualizada.',
      )
    } catch (erro) {
      console.error('[configuracoes] Falha ao alterar filial.', {
        code: erro?.code ?? 'sem código',
        name: erro?.name ?? 'Error',
        operacao,
      })
      mostrarFeedback(
        'Não foi possível alterar a filial. Confirme se ela pode receber esta operação e tente novamente.',
      )
    }
  }

  function acionarLista(evento) {
    const editar = evento.target.closest('[data-filial-editar]')
    const matriz = evento.target.closest('[data-filial-matriz]')
    const status = evento.target.closest('[data-filial-status]')
    if (editar) {
      const filial = filiais.find((item) => item.id === editar.dataset.filialEditar)
      if (filial) prepararEdicao(filial)
    } else if (matriz) {
      const filial = filiais.find((item) => item.id === matriz.dataset.filialMatriz)
      if (filial) executarAcao('definir_matriz', filial)
    } else if (status) {
      const filial = filiais.find((item) => item.id === status.dataset.filialStatus)
      if (filial) executarAcao(status.dataset.ativo === 'true' ? 'desativar' : 'ativar', filial)
    }
  }

  function aoCancelar() {
    limparFormulario()
  }

  form.addEventListener('submit', salvar)
  botaoCancelar.addEventListener('click', aoCancelar)
  lista.addEventListener('click', acionarLista)
  root.recarregarFiliais = carregarLista
  mostrarAviso()
  if (!podeGravar) {
    form.querySelectorAll('input, textarea, button').forEach((el) => {
      el.disabled = true
    })
  }
  carregarLista()

  return () => {
    vivo = false
    consulta += 1
    form.removeEventListener('submit', salvar)
    botaoCancelar.removeEventListener('click', aoCancelar)
    lista.removeEventListener('click', acionarLista)
    delete root.recarregarFiliais
  }
}

export function configuracoesPage() {
  // Gerenciar contas e permissões é restrito por permissão própria (o RPC do
  // banco também exige administrador). Mostrar a seção para quem não pode
  // usá-la só produzia uma tela que falha em todo clique.
  const podeUsuarios = pode('usuarios', 'ver')
  const podePermissoes = pode('permissoes', 'ver')
  const podeEditarFiliais = pode('configuracoes', 'editar')

  return {
    html: `
      <div class="config">
        <aside class="config__secoes">
          <p class="config__secoes-titulo">Preferências do sistema</p>
          <nav aria-label="Seções de configurações">
            <ul class="config__lista">
              <li>
                <button class="config__secao is-active" id="btn-empresa" type="button" data-painel="empresa" aria-controls="painel-empresa" aria-pressed="true">
                  <i data-lucide="building-2"></i><span>Configuração da Empresa</span>
                </button>
              </li>
              <li>
                <button class="config__secao" id="btn-filiais" type="button" data-painel="filiais" aria-controls="painel-filiais" aria-pressed="false">
                  <i data-lucide="store"></i><span>Filiais e lojas</span>
                </button>
              </li>
              ${podeUsuarios ? `<li>
                <button class="config__secao" id="btn-usuarios" type="button" data-painel="usuarios" aria-controls="painel-usuarios" aria-pressed="false">
                  <i data-lucide="users"></i><span>Usuários</span>
                </button>
              </li>` : ''}
              ${podePermissoes ? `<li>
                <button class="config__secao" id="btn-permissoes" type="button" data-painel="permissoes" aria-controls="painel-permissoes" aria-pressed="false">
                  <i data-lucide="shield-check"></i><span>Permissões</span>
                </button>
              </li>` : ''}
              <li>
                <button class="config__secao" id="btn-produtos" type="button" data-painel="produtos" aria-controls="painel-produtos" aria-pressed="false">
                  <i data-lucide="package"></i><span>Produtos</span>
                </button>
              </li>
              <li>
                <button class="config__secao" id="btn-vendas" type="button" data-painel="vendas" aria-controls="painel-vendas" aria-pressed="false">
                  <i data-lucide="shopping-bag"></i><span>Vendas</span>
                </button>
              </li>
            </ul>
          </nav>
          <div class="config__secoes-rodape">
            <i data-lucide="sliders-horizontal"></i>
            <span>Ajuste o sistema às necessidades da sua operação.</span>
          </div>
        </aside>

        <div class="config__conteudo">
          <section class="config__painel" id="painel-empresa" aria-labelledby="btn-empresa">
            <form id="form-empresa" novalidate>
              <div id="config-avisos"></div>

              ${GRUPOS.map(grupoHtml).join('')}
              ${LOGOMARCA_HTML}
              ${grupoHtml(PREFERENCIAS)}

              <p class="config__erro" id="config-erro" role="alert" hidden></p>

              <div class="config__acoes" id="config-acoes">
                <p class="config__acoes-texto" id="config-estado"></p>
                <div class="config__botoes">
                  <button class="btn btn--ghost" type="button" id="btn-cancelar">
                    <i data-lucide="rotate-ccw"></i><span>Cancelar</span>
                  </button>
                  <button class="btn btn--primary" type="submit" id="btn-salvar">
                    <i data-lucide="save"></i><span>Salvar alterações</span>
                  </button>
                </div>
              </div>
            </form>
          </section>
          <section class="config__painel" id="painel-filiais" aria-labelledby="btn-filiais" hidden>
            ${painelFiliaisHtml(podeEditarFiliais)}
          </section>
          ${podeUsuarios ? '<section class="config__painel" id="painel-usuarios" aria-labelledby="btn-usuarios" hidden></section>' : ''}
          ${podePermissoes ? '<section class="config__painel" id="painel-permissoes" aria-labelledby="btn-permissoes" hidden></section>' : ''}
          <section class="config__painel" id="painel-produtos" aria-labelledby="btn-produtos" hidden></section>
          <section class="config__painel" id="painel-vendas" aria-labelledby="btn-vendas" hidden></section>
        </div>
      </div>
    `,

    mount(root) {
      const form = root.querySelector('#form-empresa')
      const avisos = root.querySelector('#config-avisos')
      const erroGeral = root.querySelector('#config-erro')
      const acoes = root.querySelector('#config-acoes')
      const estado = root.querySelector('#config-estado')
      const botaoSalvar = root.querySelector('#btn-salvar')
      const botaoCancelar = root.querySelector('#btn-cancelar')

      // Painéis (lazy: monta Usuarios/Permissoes na primeira abertura).
      const painelUsuarios = root.querySelector('#painel-usuarios')
      const painelPermissoes = root.querySelector('#painel-permissoes')
      const painelProdutos = root.querySelector('#painel-produtos')
      const painelVendas = root.querySelector('#painel-vendas')
      const painelEmpresa = root.querySelector('#painel-empresa')
      const painelFiliais = root.querySelector('#painel-filiais')
      let pgUsuarios = null, pgPermissoes = null, pgProdutos = null, pgVendas = null
      let limparUsuarios = () => {}, limparPermissoes = () => {}, limparProdutos = () => {}, limparVendas = () => {}
      let montadoUsuarios = false, montadoPermissoes = false, montadoProdutos = false, montadoVendas = false
      let limparFiliais = () => {}
      let montadoFiliais = false

      function montarFiliais() {
        if (montadoFiliais || !painelFiliais) return
        montadoFiliais = true
        limparFiliais = iniciarPainelFiliais(painelFiliais, podeEditarFiliais)
      }

      function abrirFiliais() {
        const jaMontado = montadoFiliais
        montarFiliais()
        if (jaMontado) painelFiliais?.recarregarFiliais?.()
      }

      function montarUsuarios() {
        if (montadoUsuarios || !painelUsuarios) return
        montadoUsuarios = true
        pgUsuarios = usuariosPage()
        painelUsuarios.innerHTML = pgUsuarios.html
        renderIcons(painelUsuarios)
        limparUsuarios = pgUsuarios.mount(painelUsuarios) || (() => {})
      }
      function montarPermissoes() {
        if (montadoPermissoes || !painelPermissoes) return
        montadoPermissoes = true
        pgPermissoes = permissoesPage()
        painelPermissoes.innerHTML = pgPermissoes.html
        renderIcons(painelPermissoes)
        limparPermissoes = pgPermissoes.mount(painelPermissoes) || (() => {})
      }
      function montarVendas() {
        if (montadoVendas || !painelVendas) return
        montadoVendas = true
        pgVendas = configVendasPage()
        painelVendas.innerHTML = pgVendas.html
        renderIcons(painelVendas)
        limparVendas = pgVendas.mount(painelVendas) || (() => {})
      }
      function montarProdutos() {
        if (montadoProdutos || !painelProdutos) return
        montadoProdutos = true
        pgProdutos = configProdutosPage()
        painelProdutos.innerHTML = pgProdutos.html
        renderIcons(painelProdutos)
        limparProdutos = pgProdutos.mount(painelProdutos) || (() => {})
      }

      // Alterna entre os 3 paineis: so um visivel por vez.
      // Ao reabrir, recarrega os dados (senao o painel fica com dados velhos).
      function abrirUsuarios() {
        const jaMontado = montadoUsuarios
        montarUsuarios()
        if (jaMontado) painelUsuarios?.recarregarUsuarios?.()
      }
      function abrirPermissoes() {
        const jaMontado = montadoPermissoes
        montarPermissoes()
        if (jaMontado) painelPermissoes?.recarregarPermissoes?.()
      }
      function abrirVendas() {
        montarVendas()
      }
      function abrirProdutos() {
        montarProdutos()
      }
      function mostrarPainel(nome) {
        root.querySelectorAll('[data-painel]').forEach((botao) => {
          const ativo = botao.dataset.painel === nome
          botao.classList.toggle('is-active', ativo)
          botao.setAttribute('aria-pressed', String(ativo))
        })
        if (nome === 'usuarios') abrirUsuarios()
        if (nome === 'permissoes') abrirPermissoes()
        if (nome === 'produtos') abrirProdutos()
        if (nome === 'vendas') abrirVendas()
        if (nome === 'filiais') abrirFiliais()
        if (painelEmpresa) painelEmpresa.hidden = (nome !== 'empresa')
        if (painelFiliais) painelFiliais.hidden = (nome !== 'filiais')
        if (painelUsuarios) painelUsuarios.hidden = (nome !== 'usuarios')
        if (painelPermissoes) painelPermissoes.hidden = (nome !== 'permissoes')
        if (painelProdutos) painelProdutos.hidden = (nome !== 'produtos')
        if (painelVendas) painelVendas.hidden = (nome !== 'vendas')
      }
      ;['empresa', 'filiais', 'usuarios', 'permissoes', 'produtos', 'vendas'].forEach((nome) => {
        const btn = root.querySelector(`#btn-${nome}`)
        if (btn) btn.addEventListener('click', () => mostrarPainel(nome))
      })
      mostrarPainel('empresa')

      // Veio de uma notificacao? Abre Usuarios ja no registro indicado.
      const alvoNotif = window.__notifAlvo
      if (alvoNotif) {
        window.__notifAlvo = null
        if (podeUsuarios) {
          mostrarPainel('usuarios')
          Promise.resolve()
            .then(() => painelUsuarios?.abrirNotificacaoUsuario?.(alvoNotif))
            .catch(() => {})
        }
      }

      const arquivoInput = root.querySelector('#logo-arquivo')
      const btnEscolher = root.querySelector('#btn-escolher')
      const btnRemover = root.querySelector('#btn-remover')
      const previa = root.querySelector('#logo-previa')
      const nomeArquivo = root.querySelector('#logo-nome')
      const dicaLogo = root.querySelector('#logo-dica')
      const erroLogo = root.querySelector('#logo-erro')

      /** Último estado confirmado pelo banco. É o que "Cancelar" restaura. */
      let salvos = null
      /** Logomarca gravada no banco: `{ mime, conteudo }` ou `null`. */
      let logoAtual = null
      /** Arquivo escolhido e ainda não enviado. */
      let pendente = null
      /** Object URL da pré-visualização — precisa ser revogada. */
      let urlPrevia = null
      let falhouLeitura = false
      let salvando = false
      let vivo = true

      const papel = estadoSessao.perfil?.papel
      // Sem o Neon o app roda em demonstração, sem sessão: aí a tela fica
      // editável e o aviso de que nada é gravado aparece no topo.
      const podeEditar = !neonConfigurado || papel === 'admin' || papel === 'manager'

      /* ---------------------------------------------------- avisos ------ */

      function alerta(tom, titulo, texto) {
        const icone =
          tom === 'perigo' ? 'alert-circle' : tom === 'info' ? 'info' : 'alert-triangle'

        return `
          <div class="alert alert--${tom}">
            <i data-lucide="${icone}"></i>
            <div>
              <strong>${esc(titulo)}</strong>
              <p>${esc(texto)}</p>
            </div>
          </div>
        `
      }

      function pintarAvisos() {
        const blocos = []

        if (!neonConfigurado) {
          blocos.push(
            alerta(
              'info',
              'Modo demonstração',
              'O Neon não está configurado, então nada será gravado. Preencha o .env para salvar de verdade.',
            ),
          )
        } else if (falhouLeitura) {
          blocos.push(
            alerta(
              'perigo',
              'Não foi possível ler a configuração',
              'Os campos estão vazios e a gravação está bloqueada para não sobrescrever o que já existe no banco. Recarregue a página para tentar de novo.',
            ),
          )
        } else if (!podeEditar) {
          blocos.push(
            alerta(
              'info',
              'Somente leitura',
              'Você pode consultar os dados da empresa, mas só administradores e gerentes podem alterar. Fale com um administrador.',
            ),
          )
        }

        avisos.innerHTML = blocos.join('')
        renderIcons(avisos)
      }

      /* --------------------------------------------------- permissão ---- */

      function aplicarPermissao() {
        if (podeEditar) return

        form.querySelectorAll('.campo__input').forEach((el) => {
          el.disabled = true
        })

        arquivoInput.disabled = true
        btnEscolher.hidden = true
        btnRemover.hidden = true
        acoes.hidden = true
      }

      /* ------------------------------------------------------ campos ---- */

      function preencher(dados) {
        const valores = { ...PREFERENCIAS_PADRAO, ...(dados ?? {}) }

        form.querySelectorAll('[name]').forEach((el) => {
          el.value = valores[el.name] ?? ''
        })

        arquivoInput.value = ''
      }

      function coletar() {
        const valores = {}
        form.querySelectorAll('[name]').forEach((el) => {
          valores[el.name] = el.value.trim()
        })
        return valores
      }

      function limparErros() {
        form.querySelectorAll('[data-erro]').forEach((el) => {
          el.hidden = true
          el.textContent = ''
        })
        form.querySelectorAll('.campo__input').forEach((el) => el.classList.remove('is-erro'))
        erroGeral.hidden = true
      }

      function mostrarErro(nome, mensagem) {
        const alvo = form.querySelector(`[data-campo="${nome}"]`)
        if (!alvo) return

        const p = alvo.querySelector('[data-erro]')
        p.textContent = mensagem
        p.hidden = false
        alvo.querySelectorAll('.campo__input').forEach((el) => el.classList.add('is-erro'))
      }

      function validar(valores) {
        const erros = []

        if (!valores.nome_fantasia) erros.push(['nome_fantasia', 'Informe o nome fantasia.'])
        if (!valores.razao_social) erros.push(['razao_social', 'Informe a razão social.'])

        if (!valores.cnpj) erros.push(['cnpj', 'Informe o CNPJ.'])
        else if (!cnpjValido(valores.cnpj)) {
          erros.push(['cnpj', 'CNPJ inválido — confira os 14 dígitos.'])
        }

        if (!valores.telefone) erros.push(['telefone', 'Informe o telefone.'])
        else if (!telefoneValido(valores.telefone)) {
          erros.push(['telefone', 'Telefone inválido — use DDD + número.'])
        }

        if (valores.whatsapp && !telefoneValido(valores.whatsapp)) {
          erros.push(['whatsapp', 'WhatsApp inválido — use DDD + número.'])
        }

        if (!valores.email) erros.push(['email', 'Informe o e-mail.'])
        else if (!emailValido(valores.email)) erros.push(['email', 'E-mail inválido.'])

        if (!valores.cep) erros.push(['cep', 'Informe o CEP.'])
        else if (!cepValido(valores.cep)) erros.push(['cep', 'CEP inválido — são 8 dígitos.'])

        if (!valores.uf) erros.push(['uf', 'Selecione o estado.'])
        if (!valores.municipio) erros.push(['municipio', 'Informe o município.'])
        if (!valores.bairro) erros.push(['bairro', 'Informe o bairro.'])
        if (!valores.logradouro) erros.push(['logradouro', 'Informe a rua ou avenida.'])
        if (!valores.numero) erros.push(['numero', 'Informe o número.'])

        return erros
      }

      /* ------------------------------------------------------ máscara --- */

      /**
       * Formata o campo e devolve o cursor para o mesmo ponto (contando
       * dígitos), para não atrapalhar quem edita no meio do número.
       */
      function aplicarMascara(el) {
        const formatar = MASCARAS[el.dataset.mascara]
        if (!formatar) return

        const antes = el.value
        const posicao = el.selectionStart ?? antes.length
        const digitosAntes = apenasDigitos(antes.slice(0, posicao)).length

        const depois = formatar(antes)
        if (depois === antes) return

        el.value = depois

        if (digitosAntes === 0) {
          el.setSelectionRange(0, 0)
          return
        }

        let vistos = 0
        let novaPosicao = depois.length

        for (let i = 0; i < depois.length; i += 1) {
          if (/\d/.test(depois[i])) vistos += 1
          if (vistos === digitosAntes) {
            novaPosicao = i + 1
            break
          }
        }

        el.setSelectionRange(novaPosicao, novaPosicao)
      }

      /* ---------------------------------------------------- logomarca --- */

      function limparPrevia() {
        if (urlPrevia) {
          URL.revokeObjectURL(urlPrevia)
          urlPrevia = null
        }
      }

      function mostrarVazio(icone = 'file-image', texto = 'Sem logomarca') {
        previa.innerHTML = `
          <div class="logo__vazio">
            <i data-lucide="${icone}"></i>
            <span>${esc(texto)}</span>
          </div>
        `
        renderIcons(previa)
      }

      function mostrarImagem(url, alt) {
        previa.innerHTML = `<img class="logo__img" src="${esc(url)}" alt="${esc(alt)}" />`
      }

      async function pintarLogo() {
        if (!vivo) return

        erroLogo.hidden = true
        btnRemover.hidden = !logoAtual

        if (pendente) {
          mostrarImagem(urlPrevia, `Pré-visualização de ${pendente.arquivo.name}`)
          nomeArquivo.textContent = pendente.arquivo.name
          dicaLogo.textContent = 'A imagem será gravada quando você salvar as alterações.'
          btnEscolher.querySelector('span').textContent = 'Substituir imagem'
          return
        }

        btnEscolher.querySelector('span').textContent = logoAtual
          ? 'Substituir imagem'
          : 'Selecionar arquivo'

        if (!logoAtual) {
          limparPrevia()
          mostrarVazio()
          nomeArquivo.textContent = 'Nenhum arquivo selecionado.'
          dicaLogo.textContent = 'A imagem é gravada ao salvar as alterações.'
          return
        }

        nomeArquivo.textContent = `Logomarca atual (${logoAtual.mime.replace('image/', '').toUpperCase()})`
        dicaLogo.textContent = 'Logomarca atual da empresa.'

        const url = urlDaLogo(logoAtual)
        if (url) mostrarImagem(url, 'Logomarca da empresa')
        else mostrarVazio('alert-circle', 'Imagem indisponível')
      }

      /* --------------------------------------------------- carregando --- */

      function definirSalvando(ativo) {
        salvando = ativo
        botaoSalvar.disabled = ativo || falhouLeitura || !podeEditar
        botaoCancelar.disabled = ativo
        botaoSalvar.querySelector('span').textContent = ativo ? 'Salvando...' : 'Salvar alterações'
        if (ativo) erroGeral.hidden = true
      }

      /* ------------------------------------------------------- eventos -- */

      form.addEventListener('input', (evento) => {
        if (evento.target.dataset?.mascara) aplicarMascara(evento.target)
      })

      btnEscolher.addEventListener('click', () => arquivoInput.click())

      arquivoInput.addEventListener('change', async () => {
        const arquivo = arquivoInput.files?.[0]
        if (!arquivo) return

        erroLogo.hidden = true
        const resultado = await validarLogo(arquivo)

        if (!resultado.ok) {
          // Zera o input para que escolher o MESMO arquivo de novo dispare o
          // evento `change` outra vez.
          arquivoInput.value = ''
          erroLogo.textContent = resultado.mensagem
          erroLogo.hidden = false
          return
        }

        limparPrevia()
        urlPrevia = URL.createObjectURL(arquivo)
        pendente = { arquivo, tipo: resultado.tipo, extensao: resultado.extensao }
        await pintarLogo()
      })

      btnRemover.addEventListener('click', async () => {
        const confirmado = await confirmar({
          titulo: 'Remover a logomarca?',
          descricao:
            'A imagem sai do banco e a empresa volta a ficar sem logomarca. Os outros dados não mudam.',
          textoBotao: 'Remover logomarca',
        })

        if (!confirmado) return

        btnRemover.disabled = true
        erroLogo.hidden = true

        // Descartar a escolha pendente faz parte de "remover".
        limparPrevia()
        const tinhaPendente = Boolean(pendente)
        pendente = null
        arquivoInput.value = ''

        try {
          if (!logoAtual) {
            await pintarLogo()
            toast(tinhaPendente ? 'Seleção descartada.' : 'Não havia logomarca gravada.')
            return
          }

          if (!neonConfigurado) {
            await pintarLogo()
            toast('Modo demonstração: nada foi gravado.')
            return
          }

          await removerLogo()
          logoAtual = null

          await pintarLogo()
          window.dispatchEvent(new CustomEvent('logo-mudou'))
          window.dispatchEvent(new CustomEvent('empresa-mudou'))
          toast('Logomarca removida.')
        } catch (erro) {
          console.error('[empresa] Falha ao remover a logomarca:', erro)
          erroLogo.textContent = mensagemDoErro(erro)
          erroLogo.hidden = false
        } finally {
          btnRemover.disabled = false
        }
      })

      botaoCancelar.addEventListener('click', async () => {
        if (salvando) return

        limparErros()
        limparPrevia()
        pendente = null
        arquivoInput.value = ''
        erroLogo.hidden = true
        preencher(salvos)
        await pintarLogo()
        toast('Alterações descartadas.')
      })

      form.addEventListener('submit', async (evento) => {
        evento.preventDefault()
        if (salvando || !podeEditar) return

        limparErros()

        const valores = coletar()
        const erros = validar(valores)

        if (erros.length) {
          erros.forEach(([nome, mensagem]) => mostrarErro(nome, mensagem))
          form.querySelector('.campo__input.is-erro')?.focus()
          return
        }

        if (!neonConfigurado) {
          toast('Modo demonstração: nada foi gravado — o Neon não está configurado.')
          return
        }

        definirSalvando(true)

        try {
          // A logomarca vive numa tabela própria: grava antes da configuração.
          if (pendente) {
            logoAtual = await salvarLogo(pendente.arquivo, pendente.tipo)
          }

          const { dados: salvo, origem } = await salvarEmpresa(valores)

          if (origem !== 'neon') {
            toast('Nada foi gravado: o Neon não está configurado.')
            return
          }

          salvos = salvo
          falhouLeitura = false

          limparPrevia()
          pendente = null
          arquivoInput.value = ''
          preencher(salvo)
          await pintarLogo()
          window.dispatchEvent(new CustomEvent('logo-mudou'))
          window.dispatchEvent(new CustomEvent('empresa-mudou'))
          pintarAvisos()
          toast('Configuração da empresa salva.')
        } catch (erro) {
          console.error('[empresa] Falha ao salvar a configuração:', erro)
          erroGeral.textContent = mensagemDoErro(erro)
          erroGeral.hidden = false
          erroGeral.scrollIntoView({ block: 'nearest' })
        } finally {
          definirSalvando(false)
        }
      })

      /* --------------------------------------------------------- boot --- */

      estado.textContent = podeEditar
        ? 'Os campos marcados com * são obrigatórios.'
        : 'Somente leitura.'

      pintarAvisos()
      aplicarPermissao()
      mostrarVazio()

      async function iniciar() {
        // Modo demonstração: não há o que ler, e não há onde gravar.
        if (!neonConfigurado) {
          preencher(null)
          await pintarLogo()
          definirSalvando(false)
          return
        }

        botaoSalvar.disabled = true

        try {
          const { dados, origem } = await carregarEmpresa()
          if (!vivo) return

          if (origem === 'neon') {
            salvos = dados
            preencher(dados)
          } else {
            falhouLeitura = true
            preencher(null)
          }

          // A logomarca vem de uma tabela à parte: se só ela falhar, o resto da
          // configuração continua editável. Por isso o try/catch próprio — no
          // catch externo, a falha da logo marcaria a leitura inteira como
          // perdida e bloquearia o botão "Salvar".
          try {
            const { dados: logo, origem: origemLogo } = await carregarLogo()
            if (!vivo) return
            if (origemLogo === 'neon') logoAtual = logo

            await pintarLogo()
          } catch (falhaLogo) {
            console.error('[configuracoes] Falha ao carregar a logomarca.', falhaLogo)
            if (!vivo) return
          }

          pintarAvisos()
        } catch (falha) {
          // Sem isto, uma falha de leitura deixava o botão "Salvar" desabilitado
          // para sempre e sem explicação na tela.
          console.error('[configuracoes] Falha ao carregar a configuração.', falha)
          if (!vivo) return
          falhouLeitura = true
          pintarAvisos()
        } finally {
          if (vivo) definirSalvando(false)
        }
      }

      iniciar()

      return () => {
        vivo = false
        limparPrevia()
        limparUsuarios()
        limparPermissoes()
        limparProdutos()
        limparVendas()
        limparFiliais()
      }
    },
  }
}
