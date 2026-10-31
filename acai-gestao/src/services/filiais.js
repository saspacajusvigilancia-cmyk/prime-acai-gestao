import { carregar, neon, neonConfigurado } from './base.js'

const CAMPOS_FILIAL =
  'id, organization_id, empresa_id, codigo, numero, nome, nome_fantasia, tipo, cnpj, telefone, whatsapp, email, endereco, responsavel, ativo, criado_em, atualizado_em'

export function listarFiliais() {
  return carregar({
    nome: 'filiais',
    exemplo: [],
    consulta: async (cliente) => {
      const { data, error } = await cliente
        .from('filiais')
        .select(CAMPOS_FILIAL)
        .order('numero', { ascending: true })

      if (error) throw error
      return data ?? []
    },
  })
}

export async function gerenciarFilial(operacao, filialId = null, dados = {}) {
  if (!neonConfigurado) {
    throw new Error('Conecte o sistema ao banco para cadastrar ou alterar filiais.')
  }

  const { data, error } = await neon.rpc('gerenciar_filial', {
    p_operacao: operacao,
    p_filial_id: filialId,
    p_dados: dados,
  })

  if (error) {
    console.error('[filiais] Falha ao gerenciar filial.', {
      code: error.code ?? 'sem código',
      name: error.name ?? 'Error',
      operacao,
    })
    throw error
  }

  const filial = Array.isArray(data) ? data[0] : data
  if (!filial) {
    throw new Error('O banco não retornou a filial atualizada.')
  }
  return filial
}

export { CAMPOS_FILIAL }
