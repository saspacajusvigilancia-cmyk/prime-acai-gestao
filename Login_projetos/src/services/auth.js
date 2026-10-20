/**
 * Autenticação — tudo que fala com o Neon Auth (Managed Better Auth) e com a
 * Data API.
 *
 * Senha nenhuma passa por aqui: `criarConta`, `entrar` e `definirNovaSenha`
 * mandam o texto para o serviço de autenticação, que guarda o hash no schema
 * `neon_auth`. Nós nunca lemos, comparamos nem gravamos senha.
 *
 * A API é a mesma do Supabase porque o cliente usa o `SupabaseAuthAdapter`
 * (veja `../lib/neon.js`). Só três coisas mudam de verdade, e estão marcadas
 * neste arquivo:
 *
 *   1. o cadastro manda o nome em `options.data.displayName`;
 *   2. não existe `updateUser({ password })` — a nova senha vai por
 *      `resetPassword`, com o token que chega no link do e-mail;
 *   3. o perfil do usuário nasce de uma chamada ao RPC configurado
 *      (`config.rpcPerfil`, por padrão `garantir_perfil()`) no banco, logo
 *      depois de entrar.
 *
 * Quem manda na autorização é o RLS das tabelas — não o JavaScript. Esconder um
 * botão aqui não protege nada; o que protege é a política no banco.
 */

import { config } from '../config.js'
import { neon, neonConfigurado } from '../lib/neon.js'
import { checarSenha, emailValido, mensagemDeErro, rotuloPapel, senhaForte } from '../validacao.js'

// As regras puras são reexportadas para o host ter um só ponto de importação.
export { checarSenha, emailValido, mensagemDeErro, rotuloPapel, senhaForte }

/** Erro amigável quando o projeto ainda não configurou a conexão. */
function exigirCliente() {
  if (!neonConfigurado) {
    throw new Error(
      'Login indisponível: defina VITE_NEON_URL no .env do projeto (veja .env.example).',
    )
  }
}

/* ------------------------------------------------------------------ perfil -- */

const perfilParaApp = (linha) => ({
  id: linha.id,
  nome: linha.full_name,
  email: linha.email ?? null,
  papel: linha.role,
  papelRotulo: rotuloPapel(linha.role),
  organizacao: linha.organization_id,
  ativo: linha.is_active,
  aprovadoEm: linha.aprovado_em ?? null,
})

/**
 * Lê o perfil do usuário. A política `perfis_leitura_propria` garante que só dá
 * para ler o próprio — mesmo que alguém troque o id na chamada.
 */
export async function carregarPerfil(id) {
  exigirCliente()

  const { data, error } = await neon
    .from(config.tabelaPerfis)
    .select('id, full_name, email, role, organization_id, is_active, aprovado_em')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? perfilParaApp(data) : null
}

/**
 * Garante que existe perfil para quem está logado e o devolve.
 *
 * No Neon Auth as contas vivem num schema gerenciado (`neon_auth`), então quem
 * cria a linha na tabela de perfis é uma função `security definer` no banco
 * (`garantir_perfil()`), que fixa papel e organização NO BANCO. Chamamos uma
 * vez, logo depois de entrar.
 *
 * Por que as tentativas de novo: logo após o cadastro/login, a PRIMEIRA chamada
 * à Data API pode sair antes de o cliente ter o JWT em mãos — e volta 401/403
 * ("o seu token não vale"). Em poucos instantes o token existe e a chamada
 * passa. Como a função é idempotente, tentar de novo é seguro — e é o que salva
 * o cadastro de terminar com sessão mas sem perfil.
 */
export async function garantirPerfil(tentativas = 4) {
  exigirCliente()
  let ultimoErro = null

  for (let i = 0; i < tentativas; i++) {
    try { await neon.auth.getSession() } catch { /* ignora */ }
    const { data, error } = await neon.rpc(config.rpcPerfil)
    if (!error) return data ? perfilParaApp(data) : null

    ultimoErro = error
    if (!erroPareceDeToken(error)) break
    if (i < tentativas - 1) await esperar(200 + 250 * i)
  }

  throw ultimoErro
}

/** O erro é do tipo "ainda não tenho um token válido"? (Vale a pena tentar de novo.) */
function erroPareceDeToken(erro) {
  if (erro?.name === 'AuthRequiredError') return true
  const status = Number(erro?.status ?? erro?.statusCode ?? 0)
  if (status === 400 || status === 401 || status === 403) return true

  const codigo = String(erro?.code ?? '')
  if (codigo === '42501' || codigo === 'PGRST301') return true

  return /jwt|not a valid|unauthorized|permission denied for function|row-level security/i.test(
    erro?.message ?? '',
  )
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sessão atual, já com o perfil.
 *
 * Devolve `null` quando não há ninguém logado. O host decide o que fazer com
 * `perfil.ativo` — a checagem também existe no banco (as políticas exigem
 * `authenticated`, e a tela de login recusa conta inativa).
 */
export async function sessaoAtual() {
  if (!neonConfigurado) return null

  const { data, error } = await neon.auth.getSession()
  if (error) throw error

  const usuario = data.session?.user
  if (!usuario) return null

  let perfil
  try {
    perfil = await garantirPerfil()
  } catch (erro) {
    // Se a função falhar (por exemplo, o token ainda não estava pronto), ainda
    // vale tentar ler o perfil que já exista — assim uma conta antiga continua
    // entrando mesmo com a criação indisponível.
    console.warn('[auth] rpc de perfil falhou; tentando apenas ler o perfil.', erro)
    perfil = await carregarPerfil(usuario.id)
  }

  return { usuario, perfil }
}

/* ------------------------------------------------------------------ ações -- */

export async function entrar({ email, senha }) {
  exigirCliente()

  const { data, error } = await neon.auth.signInWithPassword({
    email: String(email).trim(),
    password: senha,
  })

  if (error) throw error
  return data.user
}

/**
 * Cria a conta.
 *
 * No metadata vai **só o nome**, e no campo que o adapter lê: `displayName`.
 * Papel e organização são decididos no banco: se o navegador mandasse
 * `role: 'admin'`, o valor seria ignorado.
 *
 * O Managed Better Auth devolve sessão já no cadastro (com a verificação de
 * e-mail desligada no projeto). Se estiver ligada, `signUp` não devolve sessão
 * e a pessoa precisa confirmar o e-mail antes de entrar.
 */
export async function criarConta({ nome, email, senha }) {
  exigirCliente()

  const { data, error } = await neon.auth.signUp({
    email: String(email).trim(),
    password: senha,
    options: {
      data: { displayName: String(nome).trim() },
    },
  })

  if (error) throw error

  return { usuario: data.user, precisaConfirmarEmail: !data.session, jaExistia: false }
}

export async function sair() {
  // Sem cliente configurado não há sessão para encerrar.
  if (!neonConfigurado) return

  const { error } = await neon.auth.signOut()
  if (error) throw error
}

export async function enviarLinkDeRecuperacao(email) {
  exigirCliente()

  const { error } = await neon.auth.resetPasswordForEmail(String(email).trim(), {
    redirectTo: urlDeRetorno(config.rotas.redefinir),
  })

  if (error) throw error
}

/**
 * Define a nova senha a partir do link do e-mail.
 *
 * O Managed Better Auth usa `resetPassword({ newPassword, token })`, e não uma
 * "sessão de recuperação" como o Supabase. O token vem na URL que a pessoa
 * abriu (`?token=...`), depois do `#` ou antes dele — leia com
 * `tokenDeRecuperacao()`.
 */
export async function definirNovaSenha(senha, token) {
  exigirCliente()

  const betterAuth = neon.auth.getBetterAuthInstance()
  const { error } = await betterAuth.resetPassword({ newPassword: senha, token })
  if (error) throw error
}

/**
 * Lê o `token` do link de recuperação da barra de endereço.
 *
 * O roteador é por hash, então o token pode chegar tanto em
 * `#/redefinir-senha?token=...` quanto em `?token=...`. Procuramos nos dois.
 */
export function tokenDeRecuperacao() {
  const daQuery = (texto) => {
    const indice = texto.indexOf('?')
    if (indice < 0) return null
    return new URLSearchParams(texto.slice(indice + 1)).get('token')
  }

  return daQuery(window.location.hash) ?? daQuery(window.location.search)
}

/** Atualiza o nome do próprio perfil (a única coluna que o RLS deixa mudar). */
export async function atualizarNome(nome) {
  exigirCliente()

  const { data, error } = await neon.auth.getUser()
  if (error) throw error

  const { data: linha, error: erroPerfil } = await neon
    .from(config.tabelaPerfis)
    .update({ full_name: String(nome).trim() })
    .eq('id', data.user.id)
    .select('id, full_name, email, role, organization_id, is_active, aprovado_em')
    .single()

  if (erroPerfil) throw erroPerfil
  return perfilParaApp(linha)
}

/**
 * Avisa quando a sessão troca de estado (login em outra aba, saída, token
 * expirado). O host usa isso para redirecionar sozinho.
 */
export function observarAuth(callback) {
  if (!neonConfigurado) return () => {}

  const { data } = neon.auth.onAuthStateChange((evento, sessao) => callback(evento, sessao))
  return () => data.subscription.unsubscribe()
}

/* ------------------------------------------------------------------- apoio -- */

/**
 * Monta o endereço de volta para onde o serviço manda o usuário depois de
 * redefinir a senha.
 *
 * O roteador é por hash, então a rota vai depois do `#`. O serviço acrescenta o
 * `?token=...` no fim, e `tokenDeRecuperacao()` o encontra.
 */
function urlDeRetorno(rota) {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#${rota}`
}
