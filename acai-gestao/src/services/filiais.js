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

export async function minhasFiliaisAutorizadas() {
  if (!neonConfigurado) {
    throw new Error('Conecte o sistema ao banco para consultar as filiais autorizadas.')
  }

  const { data, error } = await neon.rpc('minhas_filiais_autorizadas')
  if (error) {
    console.error('[filiais] Falha ao consultar filiais autorizadas.', {
      code: error.code ?? 'sem código',
      name: error.name ?? 'Error',
    })
    throw error
  }
  return data ?? []
}

export async function selecionarFilial(filialId) {
  if (!neonConfigurado) {
    throw new Error('Conecte o sistema ao banco para selecionar uma filial.')
  }
  if (!filialId) throw new Error('Selecione uma filial válida.')

  const { data, error } = await neon.rpc('selecionar_filial', {
    p_filial_id: filialId,
  })
  if (error) {
    console.error('[filiais] Falha ao selecionar filial.', {
      code: error.code ?? 'sem código',
      name: error.name ?? 'Error',
    })
    throw error
  }
  const filial = Array.isArray(data) ? data[0] : data
  if (!filial) throw new Error('O banco não confirmou a filial selecionada.')
  return filial
}

export async function listarAcessosFiliais() {
  if (!neonConfigurado) {
    throw new Error('Conecte o sistema ao banco para consultar acessos por filial.')
  }
  const { data, error } = await neon.rpc('listar_acessos_filiais')
  if (error) {
    console.error('[filiais] Falha ao consultar acessos por filial.', {
      code: error.code ?? 'sem código',
      name: error.name ?? 'Error',
    })
    throw error
  }
  return data ?? []
}

export async function gerenciarAcessoFilial(usuarioId, filialId, ativo) {
  if (!neonConfigurado) {
    throw new Error('Conecte o sistema ao banco para gerenciar acessos por filial.')
  }
  const { error } = await neon.rpc('gerenciar_acesso_filial', {
    p_usuario_id: usuarioId,
    p_filial_id: filialId,
    p_ativo: Boolean(ativo),
  })
  if (error) {
    console.error('[filiais] Falha ao alterar acesso por filial.', {
      code: error.code ?? 'sem código',
      name: error.name ?? 'Error',
    })
    throw error
  }
}

export { CAMPOS_FILIAL }
