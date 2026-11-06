import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

export const PROJETO_NEON_PRODUCAO_ID = 'nameless-tooth-87377816'
export const BRANCH_PRODUCAO_ID = 'br-steep-truth-b610am4p'
export const ENDPOINT_PRODUCAO_ID = 'ep-fragrant-snow-b6xa862f'
export const PROJETO_NEON_HOMOLOGACAO_ID = 'divine-moon-14111763'
export const BRANCH_NEON_HOMOLOGACAO_ID = 'br-shy-scene-bdvqzyg4'
export const ENDPOINT_NEON_HOMOLOGACAO_ID = 'ep-winter-cloud-bdqhu8ca'
export const PROJETO_NEON_DESENVOLVIMENTO_ID = 'solitary-bonus-43107617'
export const BRANCH_NEON_DESENVOLVIMENTO_ID = 'br-autumn-dream-b65h5n3g'
export const ENDPOINT_NEON_DESENVOLVIMENTO_ID = 'ep-noisy-hall-b6dx7uts'

function parseEnv(texto) {
  const env = {}
  for (const linha of texto.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = linha.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match || match[1].startsWith('#')) continue

    let valor = match[2].trim()
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1)
    }
    env[match[1]] = valor
  }
  return env
}

export function carregarAmbiente(mode = 'test') {
  const env = {}
  for (const nome of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const arquivo = join(raiz, nome)
    if (existsSync(arquivo)) Object.assign(env, parseEnv(readFileSync(arquivo, 'utf8')))
  }
  return { ...env, ...process.env }
}

function endpointId(valor, nome) {
  if (!String(valor ?? '').trim()) return null

  let url
  try {
    url = new URL(String(valor).trim())
  } catch {
    throw new Error(`Configuração inválida em ${nome}; nenhum teste remoto foi iniciado.`)
  }

  const protocoloEsperado = nome.startsWith('DATABASE_URL')
    ? ['postgres:', 'postgresql:']
    : ['https:']
  if (
    !protocoloEsperado.includes(url.protocol.toLowerCase()) ||
    !url.hostname.toLowerCase().endsWith('.neon.tech')
  ) {
    throw new Error(`Host ou protocolo não autorizado em ${nome}; nenhum teste remoto foi iniciado.`)
  }

  const id = url.hostname.split('.')[0].replace(/-pooler$/i, '').toLowerCase()
  if (!id.startsWith('ep-')) {
    throw new Error(`Configuração não identifica um endpoint Neon em ${nome}.`)
  }
  return id
}

export function validarSemProducao(
  env,
  nomes = [
    'VITE_NEON_URL',
    'VITE_NEON_AUTH_URL',
    'VITE_NEON_DATA_API_URL',
    'DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
  ],
) {
  for (const nome of nomes) {
    const id = endpointId(env[nome], nome)
    if (id === ENDPOINT_PRODUCAO_ID || env.NEON_TEST_BRANCH_ID === BRANCH_PRODUCAO_ID) {
      throw new Error(`Execução bloqueada: ${nome} aponta para a branch Neon de produção.`)
    }
  }
}

export function exigirDestinoSintetico(env) {
  validarSemProducao(env)

  const dataApiUrl = env.VITE_NEON_DATA_API_URL || env.VITE_NEON_URL
  const authUrl = env.VITE_NEON_AUTH_URL
  if (Boolean(env.VITE_NEON_DATA_API_URL) !== Boolean(authUrl)) {
    throw new Error('Teste remoto bloqueado: URLs de Auth e Data API devem ser configuradas juntas.')
  }

  const urls = [
    ['VITE_NEON_DATA_API_URL', dataApiUrl],
    ...(authUrl ? [['VITE_NEON_AUTH_URL', authUrl]] : []),
    ['DATABASE_URL', env.DATABASE_URL],
    ['DATABASE_URL_UNPOOLED', env.DATABASE_URL_UNPOOLED],
  ].filter(([, valor]) => Boolean(String(valor ?? '').trim()))
  const ids = urls
    .map(([nome, valor]) => endpointId(valor, nome))
    .filter(Boolean)

  if (!dataApiUrl || !ids.length || !urls.some(([nome]) => nome.startsWith('DATABASE_URL'))) {
    throw new Error('Teste remoto bloqueado: configure VITE_NEON_URL e DATABASE_URL do ambiente sintético.')
  }
  if (ids.some((id) => id !== ids[0])) {
    throw new Error('Teste remoto bloqueado: Data API e PostgreSQL devem apontar ao mesmo endpoint.')
  }
  const databaseUrl = new URL(env.DATABASE_URL_UNPOOLED || env.DATABASE_URL)
  if (databaseUrl.searchParams.get('sslmode')?.toLowerCase() !== 'verify-full') {
    throw new Error('Teste remoto bloqueado: DATABASE_URL deve exigir sslmode=verify-full.')
  }
  if (
    env.NEON_TEST_PROJECT_ID !== PROJETO_NEON_HOMOLOGACAO_ID ||
    env.NEON_TEST_PROJECT_ID === PROJETO_NEON_PRODUCAO_ID
  ) {
    throw new Error('Teste remoto bloqueado: o project ID não é o projeto isolado de homologação.')
  }
  if (
    env.NEON_TEST_BRANCH_ID !== BRANCH_NEON_HOMOLOGACAO_ID ||
    env.NEON_TEST_BRANCH_ID === BRANCH_PRODUCAO_ID
  ) {
    throw new Error('Teste remoto bloqueado: o branch ID não é a branch isolada de homologação.')
  }
  if (
    String(env.NEON_TEST_ENDPOINT_ID ?? '').toLowerCase() !== ids[0] ||
    ids[0] !== ENDPOINT_NEON_HOMOLOGACAO_ID
  ) {
    throw new Error('Teste remoto bloqueado: endpoint ID e URLs não correspondem.')
  }
  if (String(env.NEON_TEST_DATASET ?? '').toLowerCase() !== 'synthetic') {
    throw new Error('Teste remoto bloqueado: confirme que o ambiente contém somente dados sintéticos.')
  }

  return ids[0]
}

export function exigirDestinoDesenvolvimento(env) {
  validarSemProducao(env)

  if (String(env.NEON_DEV_PROJECT_ID ?? '') !== PROJETO_NEON_DESENVOLVIMENTO_ID) {
    throw new Error('Desenvolvimento bloqueado: project ID não corresponde ao projeto Neon autorizado.')
  }
  if (String(env.NEON_DEV_BRANCH_ID ?? '') !== BRANCH_NEON_DESENVOLVIMENTO_ID) {
    throw new Error('Desenvolvimento bloqueado: branch ID não corresponde à branch Neon autorizada.')
  }
  if (String(env.NEON_DEV_ENDPOINT_ID ?? '').toLowerCase() !== ENDPOINT_NEON_DESENVOLVIMENTO_ID) {
    throw new Error('Desenvolvimento bloqueado: endpoint ID não corresponde ao endpoint Neon autorizado.')
  }
  if (String(env.VITE_NEON_URL ?? '').trim()) {
    throw new Error('Desenvolvimento bloqueado: remova a URL legada VITE_NEON_URL do ambiente.')
  }
  if (!String(env.VITE_NEON_DATA_API_URL ?? '').trim() || !String(env.VITE_NEON_AUTH_URL ?? '').trim()) {
    throw new Error('Desenvolvimento bloqueado: configure as URLs de Auth e Data API do Neon.')
  }
  if (!String(env.DATABASE_URL_UNPOOLED ?? '').trim()) {
    throw new Error('Desenvolvimento bloqueado: DATABASE_URL_UNPOOLED direta é necessária para migrations.')
  }

  const dataApi = new URL(env.VITE_NEON_DATA_API_URL)
  const auth = new URL(env.VITE_NEON_AUTH_URL)
  if (
    !dataApi.pathname.endsWith('/rest/v1') ||
    !dataApi.hostname.includes('.apirest.') ||
    !auth.pathname.endsWith('/auth') ||
    !auth.hostname.includes('.neonauth.')
  ) {
    throw new Error('Desenvolvimento bloqueado: URLs de Auth/Data API não têm os endpoints Neon esperados.')
  }

  const endpoints = [
    endpointId(env.VITE_NEON_DATA_API_URL, 'VITE_NEON_DATA_API_URL'),
    endpointId(env.VITE_NEON_AUTH_URL, 'VITE_NEON_AUTH_URL'),
    endpointId(env.DATABASE_URL, 'DATABASE_URL'),
    endpointId(env.DATABASE_URL_UNPOOLED, 'DATABASE_URL_UNPOOLED'),
  ]
  if (endpoints.some((id) => id !== ENDPOINT_NEON_DESENVOLVIMENTO_ID)) {
    throw new Error('Desenvolvimento bloqueado: as URLs não apontam à branch Neon autorizada.')
  }

  const directUrl = new URL(env.DATABASE_URL_UNPOOLED)
  if (directUrl.searchParams.get('sslmode')?.toLowerCase() !== 'verify-full') {
    throw new Error('Desenvolvimento bloqueado: DATABASE_URL_UNPOOLED deve exigir sslmode=verify-full.')
  }
  return ENDPOINT_NEON_DESENVOLVIMENTO_ID
}

export function validarModoVite(mode, env) {
  const urlsPublicas = ['VITE_NEON_URL', 'VITE_NEON_AUTH_URL', 'VITE_NEON_DATA_API_URL']
  const urlConfigurada = urlsPublicas.some((nome) =>
    Boolean(String(env[nome] ?? '').trim()),
  )
  const algumaConexaoConfigurada = [...urlsPublicas, 'DATABASE_URL', 'DATABASE_URL_UNPOOLED'].some((nome) =>
    Boolean(String(env[nome] ?? '').trim()),
  )

  if (mode === 'production') return

  if (mode === 'demo') {
    if (urlConfigurada) {
      throw new Error('Modo demo bloqueado: VITE_NEON_URL deve ficar vazio e demais URLs do Neon também.')
    }
    return
  }

  if (mode === 'development') {
    exigirDestinoDesenvolvimento(env)
    return
  }

  if (!algumaConexaoConfigurada) return
  exigirDestinoSintetico(env)
}
