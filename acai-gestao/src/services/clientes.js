import { clientes as exemplo } from '../data.js'
import { carregar, gravar, hoje, neon, neonConfigurado } from './base.js'

const CAMPOS = 'id, codigo, nome, telefone, email, desde, tier, pedidos, total, ultima_compra'

/** Converte a linha de vw_clientes_resumo para o formato que a tela usa. */
const paraApp = (linha) => ({
  uuid: linha.id,
  id: linha.codigo,
  nome: linha.nome,
  telefone: linha.telefone ?? '—',
  email: linha.email ?? '—',
  desde: linha.desde,
  pedidos: Number(linha.pedidos ?? 0),
  total: Number(linha.total ?? 0),
  ultimaCompra: linha.ultima_compra ?? linha.desde,
  tier: linha.tier,
})

export function listarClientes() {
  return carregar({
    nome: 'clientes',
    exemplo,
    consulta: async (neon) => {
      // A view já entrega pedidos, total gasto e última compra calculados.
      const { data, error } = await neon
        .from('vw_clientes_resumo')
        .select(CAMPOS)
        .order('total', { ascending: false })

      if (error) throw error
      return data.map(paraApp)
    },
  })
}

/** Sugere o próximo código livre a partir dos já cadastrados (C-0912, C-1531...). */
export function proximoCodigoCliente(lista) {
  const maior = lista.reduce((acc, c) => {
    const n = Number(String(c.id).replace(/\D/g, ''))
    return Number.isFinite(n) && n > acc ? n : acc
  }, 0)

  return `C-${String(maior + 1).padStart(4, '0')}`
}

/**
 * Reserva no banco o próximo código do cliente.
 *
 * A sequência é global e atômica (migração 28): dois formulários abertos ao
 * mesmo tempo recebem números diferentes. No modo demonstração o cálculo é
 * feito pela lista local, que é a única fonte de dados disponível.
 */
export async function sugerirCodigoCliente(lista) {
  if (!neonConfigurado) return proximoCodigoCliente(lista)

  try {
    const { data, error } = await neon.rpc('proximo_codigo_cliente')
    if (error) throw error
    if (typeof data === 'string' && /^C-\d+$/.test(data)) return data

    throw new Error('resposta inesperada ao reservar código')
  } catch (erro) {
    console.error('[clientes] Não foi possível reservar um código.', {
      code: erro?.code,
    })

    if (/failed to fetch|networkerror|network request failed|fetch failed|ECONN|ETIMEDOUT/i.test(
      `${erro?.code ?? ''} ${erro?.message ?? ''}`,
    )) {
      throw new Error('Não foi possível conectar ao sistema para gerar o código. Verifique sua conexão e tente novamente.')
    }

    throw new Error('Não foi possível gerar um código de cliente. Atualize o sistema e tente novamente.')
  }
}

/** Grava um cliente novo. O código vem reservado por `sugerirCodigoCliente()`. */
export function criarCliente(valores) {
  const codigo = String(valores.codigo ?? '').trim().toUpperCase()
  if (!codigo) throw new Error('O código do cliente não foi gerado. Feche e abra o cadastro novamente.')

  const registro = {
    codigo,
    nome: valores.nome.trim(),
    telefone: valores.telefone.trim() || null,
    email: valores.email.trim() || null,
    desde: valores.desde || hoje(),
    tier: valores.tier,
    observacoes: valores.observacoes.trim() || null,
  }

  return gravar({
    nome: 'cliente',
    registro: {
      uuid: null,
      id: registro.codigo,
      nome: registro.nome,
      telefone: registro.telefone ?? '—',
      email: registro.email ?? '—',
      desde: registro.desde,
      pedidos: 0,
      total: 0,
      ultimaCompra: registro.desde,
      tier: registro.tier,
    },
    escrever: async (neon) => {
      const { data, error } = await neon
        .from('clientes')
        .insert(registro)
        .select('id, codigo, nome, telefone, email, desde, tier')
        .single()

      if (error) throw error

      // Cliente recém-criado ainda não tem compras: o resumo começa zerado.
      return paraApp({ ...data, pedidos: 0, total: 0, ultima_compra: data.desde })
    },
  })
}
