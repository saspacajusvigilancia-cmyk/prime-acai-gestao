import './style.css'
import 'login-projetos/estilo.css'
import './styles/config.css'
import './styles/produtos.css'

import { telaDeEspera, carregarFonteAuth } from 'login-projetos/auth-ui'
import {
  configurarLogin,
  config,
  ehRotaAuthConfigurada,
  rotaAuthHabilitada,
} from 'login-projetos/config'
import { renderIcons } from './icons.js'
import { esc, toast } from './ui.js'
import { renderShell } from './layout/shell.js'
import { mostrarSaidaDemonstracao } from './demo-saida.js'
import { loginProjetosConfig } from './login-config.js'
import { authConfigurado, clienteAuth, neonConfigurado } from 'login-projetos/neon'
import { createRouter } from './router.js'
import { routes } from './routes.js'
import { observarAuth, sair, sessaoAtual } from 'login-projetos/auth'
import { carregarEmpresa, carregarLogo, urlDaLogo } from './services/empresa.js'
import { carregarPermissoes, podeAcessar, sincronizarPermissoes } from './services/permissoes.js'
import { classificarErroNeon, EVENTOS_DADOS, verificarConexaoNeon } from './services/base.js'
import { contarNaoLidas, listarNotificacoes, marcarLida, marcarTodasLidas } from './services/notificacoes.js'
import { estadoSessao, iniciais, logado } from 'login-projetos/sessao'
import { initTheme } from './theme.js'
import { dadosTesteHabilitados } from './demo-test-data.js'
import { minhasFiliaisAutorizadas, selecionarFilial } from './services/filiais.js'
import {
  cancelarAprovacaoSaida,
  confirmar,
  confirmarSaidaComRascunhos,
  suprimirProximoAvisoAntesDeSair,
} from './formulario.js'

const app = document.querySelector('#app')

/* ==========================================================================
   Login_projetos — telas de autenticação (marca, rotas e textos)

   O login/cadastro/recuperação de senha vêm do pacote `Login_projetos`
   (dependência local `file:../Login_projetos`), compartilhado com outros
   projetos. A configuração da Prime Açaí está em `src/login-config.js`.
   ========================================================================== */

configurarLogin(loginProjetosConfig)

/* ==========================================================================
   Sessao
   ========================================================================== */

async function lerSessao() {
  try {
    if (authConfigurado()) {
      const { error } = await clienteAuth().auth.getSession({ forceFetch: true })
      if (error) throw error
    }

    const sessao = await sessaoAtual()

    estadoSessao.usuario = sessao?.usuario ?? null
    estadoSessao.perfil = sessao?.perfil ?? null

    const semAcesso = estadoSessao.usuario && (!estadoSessao.perfil || !estadoSessao.perfil.ativo)

    if (semAcesso) {
      const motivo = estadoSessao.perfil
        ? (estadoSessao.perfil.aprovadoEm ? 'Esta conta esta desativada.' : 'Esta conta esta pendente de aprovacao pelo administrador.')
        : 'Nao encontramos o perfil desta conta.'

      try {
        await sair()
      } catch (erroLogout) {
        console.error('[auth] Nao foi possivel encerrar a sessao sem acesso.', erroLogout)
      }
      estadoSessao.usuario = null
      estadoSessao.perfil = null
      estadoSessao.aviso = `${motivo} Fale com um administrador.`
    } else {
      await carregarPermissoes()
      estadoConexaoNeon = (await verificarConexaoNeon()).status
    }
  } catch (erro) {
    console.error('[auth] Nao foi possivel ler a sessao:', erro)
    estadoConexaoNeon = classificarErroNeon(erro)
    estadoSessao.usuario = null
    estadoSessao.perfil = null
    estadoSessao.permissoes = new Set()
    estadoSessao.aviso = 'Nao foi possivel verificar a sessao. Entre novamente.'
  } finally {
    estadoSessao.carregando = false
  }
}

let router = null
let sincronizando = null
const falhasCarregamento = new Map()
let estadoConexaoNeon = neonConfigurado ? 'verificando' : 'nao-configurado'

function sincronizar() {
  if (sincronizando) return sincronizando

  sincronizando = lerSessao()
    .then(() => router?.render())
    .finally(() => {
      sincronizando = null
    })

  return sincronizando
}

async function renovarSessao() {
  if (!authConfigurado() || !logado()) return

  try {
    const { data, error } = await clienteAuth().auth.getSession({ forceFetch: true })
    if (error) throw error
    if (!data.session) await sincronizar()
  } catch (erro) {
    console.error('[auth] Não foi possível renovar a sessão automaticamente.', erro)
  }
}

setInterval(() => void renovarSessao(), 10 * 60 * 1000)
window.addEventListener('focus', () => void renovarSessao())

/* Guarda de rota */

function guarda(rota) {
  if (!authConfigurado()) return rota.publica ? '/' : null

  if (rota.publica && ehRotaAuthConfigurada(rota.path) && !rotaAuthHabilitada(rota.path)) {
    return rota.path === config.rotas.login ? '/acesso-negado' : config.rotas.login
  }

  if (rota.publica) {
    return logado() && !rota.permiteLogado ? config.rotas.depoisDoLogin : null
  }

  if (!logado()) return config.rotas.login

  if (rota.modulo && !podeAcessar(rota.modulo)) return '/acesso-negado'

  return null
}

/* ==========================================================================
   Involucros
   ========================================================================== */

function usuarioDoShell() {
  if (!logado()) {
    return { nome: 'Modo demonstracao', papel: 'Dados de exemplo', iniciais: 'PA' }
  }

  const perfil = estadoSessao.perfil
  return { nome: perfil.nome, papel: perfil.papelRotulo, iniciais: iniciais(perfil.nome) }
}

let limparShellApp = null

const shells = {
  app: {
    html: () => renderShell(routes, usuarioDoShell(), podeAcessar),
    outlet: '#view',
    aoMontar: montarShellApp,
    aoDesmontar: () => {
      limparShellApp?.()
      limparShellApp = null
    },
  },
  auth: {
    html: () => '<div id="auth-view"></div>',
    outlet: '#auth-view',
    aoMontar: () => carregarFonteAuth(),
  },
}

const consultaEstreita = window.matchMedia('(max-width: 1024px)')

function telaEstreita() {
  return consultaEstreita.matches
}

function abrirMenu() {
  if (!telaEstreita()) return
  app.querySelector('#sidebar')?.classList.add('is-open')
  const scrim = app.querySelector('#scrim')
  if (scrim) scrim.hidden = false
  document.body.classList.add('sem-scroll')
}

function fecharMenu() {
  app.querySelector('#sidebar')?.classList.remove('is-open')
  const scrim = app.querySelector('#scrim')
  if (scrim) scrim.hidden = true
  document.body.classList.remove('sem-scroll')
}

function alternarMenu() {
  if (telaEstreita()) {
    abrirMenu()
    return
  }
  app.querySelector('.app')?.classList.toggle('menu-recolhido')
}

function marcarMenuAtivo(path) {
  app.querySelectorAll('.nav__link').forEach((link) => {
    const ativo = link.dataset.route === path
    link.classList.toggle('is-active', ativo)
    if (ativo) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
}

function pintarOrigemDados() {
  const pill = app.querySelector('#status-dados')
  const texto = app.querySelector('#status-dados-texto')
  if (!pill || !texto) return

  pill.classList.remove('status-pill--ok', 'status-pill--exemplo', 'status-pill--erro')

  if (neonConfigurado) {
    const falha = [...falhasCarregamento.values()].at(-1)
    const estado = falha ?? estadoConexaoNeon
    const mensagens = {
      conectado: ['Banco conectado', 'Conexão com o Neon confirmada.'],
      verificando: ['Verificando banco', 'Aguardando confirmação de conexão com o Neon.'],
      indisponivel: ['Banco indisponível', 'Falha de rede ou tempo limite ao acessar o banco. Verifique a conexão.'],
      autenticacao: ['Falha de autenticação', 'A sessão não foi aceita pelo Neon Auth. Entre novamente.'],
      permissao: ['Sem permissão', 'O banco recusou o acesso desta conta ou filial. Confira as permissões.'],
      consulta: ['Erro no banco', 'O banco recusou a consulta. Confira o schema e as permissões.'],
    }

    if (estado !== 'conectado') {
      pill.classList.add('status-pill--erro')
      const [rotulo, descricao] = mensagens[estado] ?? mensagens.consulta
      texto.textContent = rotulo
      pill.title = descricao
      return
    }

    pill.classList.add('status-pill--ok')
    const [rotulo, descricao] = mensagens.conectado
    texto.textContent = rotulo
    pill.title = descricao
  } else {
    pill.classList.add('status-pill--exemplo')
    texto.textContent = import.meta.env.MODE === 'demo'
      ? 'Demo local'
      : dadosTesteHabilitados
        ? 'Teste fictício'
        : 'Dados de exemplo'
    pill.title = import.meta.env.MODE === 'demo'
      ? 'O modo demo não conecta ao banco. Para testar persistência, use npm run dev:teste com homologação sintética; não use a configuração de produção.'
      : 'Dados de exemplo; operações críticas exigem conexão confirmada com o Neon.'
  }
}

function pintarUsuario() {
  const nome = app.querySelector('.user__info strong')
  const papel = app.querySelector('.user__info small')
  const avatar = app.querySelector('.user__avatar')
  if (!nome) return

  const usuario = usuarioDoShell()
  nome.textContent = usuario.nome
  nome.title = usuario.nome
  if (papel) papel.textContent = usuario.papel
  if (avatar) avatar.textContent = usuario.iniciais
}

async function pintarMarca() {
  const marca = app.querySelector('#brand-mark')
  const imagem = app.querySelector('#brand-logo')
  if (!marca || !imagem) return

  let resultado
  try {
    resultado = await carregarLogo()
  } catch {
    // carregar() registra a falha no indicador global.
    return
  }

  const { dados } = resultado
  const url = urlDaLogo(dados)

  if (url) {
    imagem.src = url
    imagem.hidden = false
    marca.classList.add('brand__mark--com-logo')
  } else {
    imagem.removeAttribute('src')
    imagem.hidden = true
    marca.classList.remove('brand__mark--com-logo')
  }
}

async function pintarNomeEmpresa() {
  const nomeEl = app.querySelector('#brand-nome')
  if (!nomeEl) return
  try {
    const { dados, origem } = await carregarEmpresa()
    if (origem === 'neon' && dados?.nome_fantasia) {
      nomeEl.textContent = dados.nome_fantasia
    }
  } catch (e) {
    // mantem o padrao
  }
}

function montarShellApp(raiz) {
  const outlet = raiz.querySelector('#view')
  const scrim = raiz.querySelector('#scrim')
  const buscaGlobal = raiz.querySelector('#busca-global')

  renderIcons(raiz)
  initTheme()
  pintarOrigemDados()
  pintarUsuario()
  pintarMarca()
  pintarNomeEmpresa()
  const limparSeletorFilial = instalarSeletorFilial(raiz)

  raiz.querySelector('#sidebar-open').addEventListener('click', alternarMenu)
  raiz.querySelector('#sidebar-close').addEventListener('click', fecharMenu)
  scrim.addEventListener('click', fecharMenu)

  const aoRedimensionar = () => {
    if (telaEstreita()) app.querySelector('.app')?.classList.remove('menu-recolhido')
    else fecharMenu()
  }
  window.addEventListener('resize', aoRedimensionar)

  raiz.querySelector('#btn-config')?.addEventListener('click', () => router.navigate('/configuracoes'))

  const aoTeclar = (evento) => {
    if (evento.key === 'Escape') fecharMenu()
  }
  document.addEventListener('keydown', aoTeclar)

  raiz.querySelector('[data-skip]').addEventListener('click', () => outlet.focus())

  buscaGlobal.addEventListener('input', () => {
    window.dispatchEvent(new CustomEvent('busca-global', { detail: buscaGlobal.value }))
  })

  raiz.querySelector('#btn-sair')?.addEventListener('click', async (evento) => {
    const botao = evento.currentTarget
    if (!authConfigurado()) {
      mostrarSaidaDemonstracao(app, () => router?.navigate('/'))
      return
    }

    if (!await confirmarSaidaComRascunhos()) return
    const tituloOriginal = botao.title
    botao.disabled = true
    botao.title = 'Saindo...'
    botao.setAttribute('aria-busy', 'true')

    try {
      await sair()
      estadoSessao.usuario = null
      estadoSessao.perfil = null
      estadoSessao.permissoes = new Set()
      estadoSessao.aviso = null
      estadoSessao.carregando = false
      router?.navigate(config.rotas.depoisDoLogout)
    } catch (erro) {
      cancelarAprovacaoSaida()
      console.error('[auth] Falha ao sair:', erro)
      botao.disabled = false
      botao.title = tituloOriginal
      botao.removeAttribute('aria-busy')
      toast('Não foi possível sair da conta. Verifique a conexão e tente novamente.')
    }
  })

  const aoAtualizarEmpresa = () => { pintarMarca(); pintarNomeEmpresa() }
  window.addEventListener('logo-mudou', aoAtualizarEmpresa)
  window.addEventListener('empresa-mudou', aoAtualizarEmpresa)

  /* ---------- Notificacoes ---------- */
  const badge = raiz.querySelector('#notif-badge')
  const painel = raiz.querySelector('#notif-painel')
  const lista = raiz.querySelector('#notif-lista')
  const btnNotif = raiz.querySelector('#btn-notif')

  async function atualizarBadge() {
    if (!badge) return
    try {
      const n = await contarNaoLidas()
      badge.textContent = n > 99 ? '99+' : String(n)
      badge.hidden = n === 0
    } catch (erro) {
      console.error('[notificacoes] Falha ao consultar notificações não lidas.', erro)
    }
  }

  function definirPainelNotif(aberto) {
    if (!painel) return
    painel.hidden = !aberto
    btnNotif?.setAttribute('aria-expanded', String(aberto))
  }

  async function carregarPainel() {
    if (!lista) return
    lista.innerHTML = '<p class="notif-estado">Carregando...</p>'
    try {
      const notifs = await listarNotificacoes(20)
      if (!notifs.length) {
        lista.innerHTML = '<p class="notif-estado">Sem notificações.</p>'
        return
      }
      lista.innerHTML = notifs.map((n) => {
        const acao = n.tipo === 'novo_usuario_pendente' ? 'Definir perfil de acesso' : 'Ver'
        return `
        <article class="notif-item${n.lida ? ' is-lida' : ''}">
          <div class="notif-item__top">
            <strong class="notif-item__titulo">${esc(n.titulo)}</strong>
            ${n.lida ? '' : '<span class="notif-item__nova">Nova</span>'}
          </div>
          <p class="notif-item__mensagem">${esc(n.mensagem)}</p>
          <div class="notif-item__rodape">
            <span class="notif-item__meta">${esc(n.tipo || '')} · ${new Date(n.criado_em).toLocaleString('pt-BR')}</span>
            <div class="notif-item__acoes">
              ${n.link ? `<button class="btn btn--ghost btn--sm" type="button" data-notif-link="${esc(n.link)}" data-notif-id="${esc(n.id)}" data-notif-alvo="${esc(n.actor_id || '')}">${acao}</button>` : ''}
              ${!n.lida ? `<button class="btn btn--ghost btn--sm" type="button" data-notif-lida="${esc(n.id)}">Marcar lida</button>` : ''}
            </div>
          </div>
        </article>
      `}).join('')
      renderIcons(lista)

      lista.querySelectorAll('[data-notif-lida]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await marcarLida(btn.dataset.notifLida)
          await carregarPainel()
          await atualizarBadge()
        })
      })
      lista.querySelectorAll('[data-notif-link]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await marcarLida(btn.dataset.notifId)
          definirPainelNotif(false)
          window.__notifAlvo = btn.dataset.notifAlvo || null
          router?.navigate(btn.dataset.notifLink)
          await atualizarBadge()
        })
      })
    } catch (erro) {
      console.error('[notificacoes] Falha ao carregar o painel.', erro)
      lista.innerHTML = '<p class="notif-estado" role="alert">Não foi possível carregar as notificações. Tente novamente.</p>'
    }
  }

  const aoTeclarNotif = (evento) => {
    if (evento.key === 'Escape' && painel && !painel.hidden) definirPainelNotif(false)
  }
  document.addEventListener('keydown', aoTeclarNotif)

  btnNotif?.addEventListener('click', async () => {
    if (!painel) return
    definirPainelNotif(painel.hidden)
    if (!painel.hidden) await carregarPainel()
  })

  raiz.querySelector('#notif-marcar-todas')?.addEventListener('click', async () => {
    await marcarTodasLidas()
    await carregarPainel()
    await atualizarBadge()
  })

  // fecha painel ao clicar fora
  const aoClicarFora = (e) => {
    if (painel && !painel.hidden && !raiz.querySelector('#notif-wrap')?.contains(e.target)) {
      definirPainelNotif(false)
    }
  }
  document.addEventListener('click', aoClicarFora)

  atualizarBadge()
  const intervalo = setInterval(atualizarBadge, 30000)

  limparShellApp = () => {
    limparSeletorFilial()
    clearInterval(intervalo)
    document.removeEventListener('click', aoClicarFora)
    document.removeEventListener('keydown', aoTeclarNotif)
    document.removeEventListener('keydown', aoTeclar)
    window.removeEventListener('logo-mudou', aoAtualizarEmpresa)
    window.removeEventListener('empresa-mudou', aoAtualizarEmpresa)
    window.removeEventListener('resize', aoRedimensionar)
  }
}

function instalarSeletorFilial(raiz) {
  const seletor = raiz.querySelector('#filial-atual')
  const status = raiz.querySelector('#filial-atual-status')
  if (!seletor || !status) return () => {}
  const controle = seletor.closest('.filial-atual')

  if (!neonConfigurado) {
    if (controle) controle.hidden = true
    return () => {}
  }

  let ativo = true
  let filialAnterior = ''
  let trocando = false

  const aoSelecionar = async () => {
    const filialId = seletor.value
    if (!filialId || filialId === filialAnterior || trocando) return

    trocando = true
    seletor.disabled = true
    status.textContent = 'Confirme a troca de filial.'
    const confirmado = await confirmar({
      titulo: 'Trocar filial operacional?',
      descricao:
        'A troca recarrega o sistema e pode descartar o que ainda não foi salvo nesta tela. Salve rascunhos e alterações antes de continuar.',
      textoBotao: 'Trocar filial',
    })
    if (!confirmado) {
      seletor.value = filialAnterior
      seletor.disabled = false
      status.textContent = 'Unidade operacional'
      trocando = false
      return
    }

    if (!await confirmarSaidaComRascunhos()) {
      seletor.value = filialAnterior
      seletor.disabled = false
      status.textContent = 'Unidade operacional'
      trocando = false
      return
    }

    status.textContent = 'Validando acesso...'
    try {
      await selecionarFilial(filialId)
      suprimirProximoAvisoAntesDeSair()
      window.location.reload()
    } catch (erro) {
      cancelarAprovacaoSaida()
      console.error('[filiais] Não foi possível atualizar o contexto operacional.', {
        code: erro?.code ?? 'sem código',
        name: erro?.name ?? 'Error',
      })
      seletor.value = filialAnterior
      seletor.disabled = false
      status.textContent = 'A filial não foi alterada.'
      toast('Não foi possível selecionar essa filial. Verifique sua autorização e tente novamente.')
    } finally {
      trocando = false
    }
  }

  seletor.addEventListener('change', aoSelecionar)

  minhasFiliaisAutorizadas()
    .then((filiais) => {
      if (!ativo) return
      seletor.replaceChildren()

      if (!filiais.length) {
        const opcao = document.createElement('option')
        opcao.value = ''
        opcao.textContent = 'Sem filial autorizada'
        seletor.append(opcao)
        seletor.disabled = true
        status.textContent = 'Solicite acesso ao administrador.'
        return
      }

      const atual = filiais.find((filial) => filial.atual)
      filialAnterior = atual?.id ?? ''
      for (const filial of filiais) {
        const opcao = document.createElement('option')
        opcao.value = filial.id
        opcao.textContent = `LOJA ${String(filial.numero ?? '').padStart(2, '0')} — ${filial.nome_fantasia || filial.nome}`
        opcao.selected = Boolean(filial.atual)
        seletor.append(opcao)
      }
      seletor.disabled = filiais.length < 2 && Boolean(atual)
      status.textContent = atual ? 'Unidade operacional' : 'Selecione sua unidade para continuar.'
    })
    .catch((erro) => {
      if (!ativo) return
      console.error('[filiais] Não foi possível carregar as filiais autorizadas.', {
        code: erro?.code ?? 'sem código',
        name: erro?.name ?? 'Error',
      })
      seletor.innerHTML = '<option value="">Falha ao carregar filiais</option>'
      seletor.disabled = true
      status.textContent = 'Atualize a página ou verifique a conexão.'
    })

  return () => {
    ativo = false
    seletor.removeEventListener('change', aoSelecionar)
  }
}

/* ==========================================================================
   Boot
   ========================================================================== */

async function iniciar() {
  initTheme()

  window.addEventListener(EVENTOS_DADOS.carregamentoFalhou, (evento) => {
    const nome = evento.detail?.nome ?? 'consulta'
    falhasCarregamento.set(`consulta:${nome}`, evento.detail?.categoria ?? 'consulta')
    estadoConexaoNeon = evento.detail?.categoria ?? 'consulta'
    pintarOrigemDados()
  })
  window.addEventListener(EVENTOS_DADOS.carregamentoConcluido, (evento) => {
    const nome = evento.detail?.nome ?? 'consulta'
    falhasCarregamento.delete(`consulta:${nome}`)
    estadoConexaoNeon = 'conectado'
    pintarOrigemDados()
  })
  window.addEventListener(EVENTOS_DADOS.operacaoFalhou, (evento) => {
    const nome = evento.detail?.nome ?? 'operação'
    falhasCarregamento.set(`operacao:${nome}`, evento.detail?.categoria ?? 'consulta')
    estadoConexaoNeon = evento.detail?.categoria ?? 'consulta'
    pintarOrigemDados()
  })
  window.addEventListener(EVENTOS_DADOS.operacaoConcluida, (evento) => {
    const nome = evento.detail?.nome ?? 'operação'
    falhasCarregamento.delete(`operacao:${nome}`)
    estadoConexaoNeon = 'conectado'
    pintarOrigemDados()
  })

  if (authConfigurado()) {
    app.innerHTML = telaDeEspera()
    renderIcons(app)
    await lerSessao()
  } else {
    estadoSessao.carregando = false
  }

  router = createRouter({
    routes,
    raiz: app,
    shells,
    guarda,
    beforeNavigate: confirmarSaidaComRascunhos,
    onRender({ rota, path, outlet, shell }) {
      const rotulo = rota.title ?? rota.label
      document.title = `${rotulo} - Prime Acai`

      if (shell === 'app') {
        const titulo = app.querySelector('#page-title')
        const subtitulo = app.querySelector('#page-subtitle')
        const titulos = app.querySelector('.topbar__titles')
        const buscaGlobal = app.querySelector('#busca-global')
        const controleBuscaGlobal = buscaGlobal?.closest('.search')
        const buscaLocal = outlet.querySelector('input[type="search"]')

        if (titulo) titulo.textContent = rotulo
        if (subtitulo) subtitulo.textContent = rota.subtitle ?? ''
        if (titulos) titulos.hidden = Boolean(rota.hideTopbarTitle)
        if (buscaGlobal) buscaGlobal.value = ''
        if (controleBuscaGlobal) {
          controleBuscaGlobal.hidden = Boolean(buscaLocal) || rota.path === '/configuracoes'
        }

        marcarMenuAtivo(path)
        fecharMenu()
        pintarUsuario()
      }

      renderIcons(outlet)
    },
  })

  window.addEventListener('sessao-mudou', sincronizar)

  window.addEventListener('permissoes-mudaram', () => router?.reconstruirMenu())

  observarAuth((evento) => {
    if (evento === 'INITIAL_SESSION' || evento === 'TOKEN_REFRESHED' || evento === 'PASSWORD_RECOVERY') {
      return
    }

    setTimeout(sincronizar, 0)
  })

  router.render()
}

iniciar()
