import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js'
import { config } from '../config.js'

/**
 * Cliente do Neon no navegador.
 *
 * Substitui o antigo `createBrowserClient` do Supabase. O `createClient` do
 * `@neondatabase/neon-js` junta duas coisas numa só:
 *
 * - **Managed Better Auth** (login, cadastro, sessão), através do
 *   `SupabaseAuthAdapter`, que expõe a MESMA API que o app já usava
 *   (`auth.signInWithPassword`, `auth.signUp`, `auth.getSession`,
 *   `auth.onAuthStateChange`…). Por isso as telas de autenticação quase não
 *   mudam.
 * - **Data API** (PostgREST), onde as consultas `.from(...).select()` continuam
 *   iguais às do Supabase.
 *
 * O SDK recebe separadamente as URLs públicas de Auth e Data API. Exemplo:
 *
 *   VITE_NEON_AUTH_URL=https://ep-xxx.neonauth.c-2.aws.neon.tech/neondb/auth
 *   VITE_NEON_DATA_API_URL=https://ep-xxx.apirest.c-2.aws.neon.tech/neondb/rest/v1
 *
 * `VITE_NEON_URL` ainda é aceito para ambientes antigos: o SDK deriva dele
 * ambas as URLs. Sem nenhuma URL, `neon` fica `null` e o host roda em demo.
 *
 * Segurança: a URL vai no bundle do navegador. Quem protege os dados é o RLS
 * (veja `sql/00_profiles.sql`) — exatamente como era com o Supabase.
 */

/**
 * Atenção ao detalhe: guardamos a variável **crua** e só limpamos o texto na
 * hora de criar o cliente. Se ela sumisse por `?.trim()` aqui em cima,
 * `neonConfigurado` deixaria de ser uma constante conhecida na hora do build e
 * o Rollup NÃO conseguiria remover o SDK quando o `.env` está vazio — o bundle
 * do modo demonstração dobraria de tamanho sem motivo.
 */
const url = import.meta.env.VITE_NEON_URL
const authUrl = import.meta.env.VITE_NEON_AUTH_URL
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL
const endpointsExplicitos = Boolean(authUrl || dataApiUrl)

if (endpointsExplicitos && (!authUrl || !dataApiUrl)) {
  throw new Error('Configure juntas VITE_NEON_AUTH_URL e VITE_NEON_DATA_API_URL.')
}

export const neonConfigurado = Boolean(endpointsExplicitos || url)

export const neon = endpointsExplicitos
  ? createClient({
      auth: {
        url: String(authUrl).trim(),
        adapter: SupabaseAuthAdapter(),
      },
      dataApi: {
        url: String(dataApiUrl).trim(),
      },
    })
  : neonConfigurado
    ? createClient(String(url).trim(), {
        auth: {
          adapter: SupabaseAuthAdapter(),
        },
      })
    : null

/** Retorna o cliente configurado pelo host ou o cliente Neon padrão. */
export function clienteAuth() {
  return config.provedor.cliente ?? neon
}

/** Informa se há um cliente disponível para operações de autenticação. */
export function authConfigurado() {
  return Boolean(clienteAuth())
}

if (!neonConfigurado) {
  console.info(
    '[neon] VITE_NEON_URL ausente no .env — o login está em modo demonstração.',
  )
}
