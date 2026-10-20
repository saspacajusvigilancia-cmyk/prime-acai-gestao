/**
 * ============================================================================
 * Login_projetos — API pública
 * ============================================================================
 *
 * Módulo de login, cadastro e recuperação de senha para SPAs em JavaScript
 * puro, com Neon Auth (Managed Better Auth) + Data API.
 *
 * Uso típico (veja `docs/INTEGRACAO.md` e `exemplos/main.exemplo.js`):
 *
 *   import { configurarLogin, telasAuth, sessaoAtual, estadoSessao, observarAuth } from 'login-projetos'
 *   import 'login-projetos/estilo.css'
 *
 *   configurarLogin({ marca: { nome: 'Minha Empresa' } })
 *
 *   const rotas = { ...telasAuth(), '/': () => ({ html: '<h1>Início</h1>', mount() {} }) }
 *
 * Nada aqui decide autorização: quem autoriza é o RLS do banco (veja `sql/`).
 */

import { config, configurarLogin, texto } from './config.js'
import { cadastroPage } from './pages/cadastro.js'
import { loginPage } from './pages/login.js'
import { recuperarSenhaPage } from './pages/recuperar-senha.js'
import { redefinirSenhaPage } from './pages/redefinir-senha.js'

/* ------------------------------------------------------- configuração ----- */

export { config, configurarLogin, texto }

/* ------------------------------------------------------------ clientes ---- */

export { neon, neonConfigurado } from './lib/neon.js'
export { renderIcons } from './lib/icons.js'
export { esc } from './ui.js'

/* ----------------------------------------------------- estado de sessão --- */

export { estadoSessao, logado, avisarSessao, iniciais } from './sessao.js'

/* ------------------------------------------------------------ serviço ----- */

export {
  atualizarNome,
  carregarPerfil,
  checarSenha,
  criarConta,
  definirNovaSenha,
  emailValido,
  entrar,
  enviarLinkDeRecuperacao,
  garantirPerfil,
  mensagemDeErro,
  observarAuth,
  rotuloPapel,
  sair,
  senhaForte,
  sessaoAtual,
  tokenDeRecuperacao,
} from './services/auth.js'

/* ------------------------------------------------------------ peças UI ---- */

export {
  alertaAuth,
  campoAuth,
  carregarFonteAuth,
  definirCarregando,
  esconderAlerta,
  focarPrimeiroErro,
  layoutAuth,
  ligarOlhos,
  limparErros,
  marcarErro,
  mostrarAlerta,
  regrasSenha,
  telaDeEspera,
} from './auth-ui.js'

/* --------------------------------------------------------------- telas ---- */

export { cadastroPage, loginPage, recuperarSenhaPage, redefinirSenhaPage }

/** Mapa `rota -> fábrica de página`, pronto para o roteador do host. */
export function telasAuth() {
  return {
    [config.rotas.login]: loginPage,
    [config.rotas.cadastro]: cadastroPage,
    [config.rotas.recuperar]: recuperarSenhaPage,
    [config.rotas.redefinir]: redefinirSenhaPage,
  }
}

/** `true` se a rota é uma das telas de autenticação (a query é ignorada). */
export function ehRotaAuth(rota) {
  const caminho = String(rota ?? '').split('?')[0]
  return [
    config.rotas.login,
    config.rotas.cadastro,
    config.rotas.recuperar,
    config.rotas.redefinir,
  ].includes(caminho)
}
