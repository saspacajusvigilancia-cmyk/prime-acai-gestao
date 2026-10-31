// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('login-projetos/neon', () => ({
  neonConfigurado: false,
  neon: {},
}))

vi.mock('../src/services/permissoes.js', () => ({
  pode: () => true,
}))

const { comprasPage } = await import('../src/pages/compras.js')
const comprasService = await import('../src/services/compras.js')

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const compraInicial = () => ({
  id: 'compra-recebimento-1',
  numero: 'CMP-100',
  dataCompra: '2026-10-30',
  dataRecebimento: null,
  fornecedorId: 'fornecedor-1',
  fornecedorNome: 'Fornecedor teste',
  tipoDocumento: 'sem_nota',
  numeroNota: '',
  observacoes: '',
  descontoValor: 0,
  freteValor: 0,
  status: 'aguardando_recebimento',
  usuarioId: 'admin',
  usuarioNome: 'Admin',
  criadoEm: '2026-10-30T12:00:00Z',
  atualizadoEm: '2026-10-30T12:00:00Z',
  itens: [{
    id: 'item-recebimento-1',
    compraId: 'compra-recebimento-1',
    produtoId: 'P001',
    nome: 'Açaí tradicional',
    unidadeCompra: 'CX',
    fatorConversao: 12,
    quantidadeSolicitada: 5,
    quantidadeRecebida: 0,
    custoUnitario: 10,
    descontoValor: 0,
    lote: '',
    validade: '',
    total: 50,
    pendente: 5,
  }],
  totalItens: 1,
  subtotal: 50,
  descontoItens: 0,
  total: 50,
  quantidadeRecebida: 0,
  temPendencia: true,
})

let root
let desmontar
let compraAtual
let listarComprasMock
let receberCompraMock

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  compraAtual = compraInicial()
  listarComprasMock = vi.spyOn(comprasService, 'listarCompras').mockImplementation(async ({ id } = {}) => ({
    dados: id ? [compraAtual] : [compraAtual],
    origem: 'neon',
  }))
  receberCompraMock = vi.spyOn(comprasService, 'receberCompra')
  document.body.innerHTML = '<div id="app"></div>'
  root = document.querySelector('#app')
  const pagina = comprasPage()
  root.innerHTML = pagina.html
  desmontar = pagina.mount(root)
  await tick()
})

afterEach(() => {
  desmontar?.()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  document.body.classList.remove('sem-scroll')
})

function abrirRecebimento() {
  root.querySelector('[data-compra-acao="receber"]').click()
  return document.querySelector('.modal')
}

function definirRecebimento({ quantidade = '2', lote = 'LOTE-77', validade = '2027-01-15', local = 'geral' } = {}) {
  const modal = document.querySelector('.modal')
  modal.querySelector('[data-receber-qtd="item-recebimento-1"]').value = quantidade
  modal.querySelector('[data-receber-lote="item-recebimento-1"]').value = lote
  modal.querySelector('[data-receber-validade="item-recebimento-1"]').value = validade
  modal.querySelector('[data-receber-local="item-recebimento-1"]').value = local
}

function confirmarRecebimento() {
  document.querySelector('.modal [data-modal-acao="confirmar"]').click()
}

describe('confirmação de recebimento de compras', () => {
  it('envia parcialidade, conversão, lote, validade e destino sem perder os campos', async () => {
    receberCompraMock.mockResolvedValue({
      dados: { status: 'recebimento_parcial' },
      origem: 'neon',
    })
    const modal = abrirRecebimento()
    definirRecebimento()

    confirmarRecebimento()
    await tick()

    expect(receberCompraMock).toHaveBeenCalledTimes(1)
    expect(receberCompraMock).toHaveBeenCalledWith(
      'compra-recebimento-1',
      [{
        itemId: 'item-recebimento-1',
        quantidade: 2,
        local: 'geral',
        lote: 'LOTE-77',
        validade: '2027-01-15',
      }],
      expect.any(String),
    )
    expect(modal.isConnected).toBe(false)
  })

  it('confirma recebimento total e atualiza os dados da compra', async () => {
    receberCompraMock.mockImplementation(async () => {
      compraAtual.status = 'recebido_confirmado'
      compraAtual.itens[0].quantidadeRecebida = 5
      compraAtual.itens[0].pendente = 0
      return { dados: { status: 'recebido_confirmado' }, origem: 'neon' }
    })
    const modal = abrirRecebimento()
    definirRecebimento({ quantidade: '5' })

    confirmarRecebimento()
    await tick()
    await tick()

    expect(receberCompraMock).toHaveBeenCalledTimes(1)
    expect(modal.isConnected).toBe(false)
    expect(listarComprasMock).toHaveBeenCalledTimes(2)
    expect(document.querySelector('#toasts').textContent).toContain('Recebimento confirmado')
  })

  it('mostra erro de validação no alerta sem esvaziar os campos nem chamar a RPC', () => {
    const modal = abrirRecebimento()
    definirRecebimento({ quantidade: '6' })

    confirmarRecebimento()

    expect(receberCompraMock).not.toHaveBeenCalled()
    expect(modal.querySelector('[data-alerta-titulo]').textContent).toBe('Revise a quantidade informada')
    expect(modal.querySelector('[data-alerta-mensagem]').textContent).toContain('não pode ultrapassar')
    expect(modal.querySelector('[data-receber-qtd="item-recebimento-1"]').value).toBe('6')
  })

  it('traduz função ausente sem expor erro técnico e bloqueia tentativas até atualizar integração', async () => {
    receberCompraMock.mockRejectedValue({
      code: 'PGRST202',
      message: 'Could not find the function public.confirmar_recebimento_compra_idempotente without parameters in the schema cache',
    })
    const modal = abrirRecebimento()
    definirRecebimento()

    confirmarRecebimento()
    await tick()

    expect(modal.querySelector('[data-alerta-titulo]').textContent)
      .toBe('Não foi possível confirmar o recebimento')
    expect(modal.querySelector('[data-alerta-mensagem]').textContent)
      .toContain('Nenhum item foi lançado por esta tentativa')
    expect(modal.textContent).not.toContain('PGRST202')
    expect(modal.textContent).not.toContain('confirmar_recebimento_compra_idempotente')
    expect(modal.querySelector('[data-modal-acao="confirmar"]').disabled).toBe(true)
    expect(modal.querySelector('[data-receber-lote="item-recebimento-1"]').value).toBe('LOTE-77')
    expect(receberCompraMock).toHaveBeenCalledTimes(1)
  })

  it('impede cliques repetidos simultâneos no botão de confirmação', async () => {
    let resolver
    receberCompraMock.mockImplementation(() => new Promise((resolve) => { resolver = resolve }))
    abrirRecebimento()
    definirRecebimento()

    confirmarRecebimento()
    confirmarRecebimento()
    expect(receberCompraMock).toHaveBeenCalledTimes(1)

    resolver({ dados: { status: 'recebimento_parcial' }, origem: 'neon' })
    await tick()
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('verifica a compra antes de permitir retry e reutiliza a chave idempotente', async () => {
    receberCompraMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ dados: { status: 'recebimento_parcial' }, origem: 'neon' })
    const modal = abrirRecebimento()
    definirRecebimento()

    confirmarRecebimento()
    await tick()
    expect(modal.querySelector('[data-alerta-mensagem]').textContent)
      .toContain('Atualize a situação da compra')
    expect(modal.querySelector('[data-modal-acao="confirmar"]').disabled).toBe(true)
    expect(modal.querySelector('[data-receber-qtd="item-recebimento-1"]').disabled).toBe(true)

    modal.querySelector('[data-verificar-situacao]').click()
    await tick()
    await tick()
    expect(listarComprasMock).toHaveBeenCalledWith({ id: 'compra-recebimento-1' })
    expect(modal.querySelector('[data-alerta-titulo]').textContent).toBe('Situação atualizada')
    expect(modal.querySelector('[data-tentar-novamente]').hidden).toBe(false)

    modal.querySelector('[data-tentar-novamente]').click()
    await tick()
    expect(receberCompraMock).toHaveBeenCalledTimes(2)
    expect(receberCompraMock.mock.calls[0][2]).toBe(receberCompraMock.mock.calls[1][2])
    expect(modal.isConnected).toBe(false)
  })

  it('fecha e atualiza a tela se a consulta confirmar alteração durante a tentativa incerta', async () => {
    receberCompraMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const modal = abrirRecebimento()
    definirRecebimento()
    confirmarRecebimento()
    await tick()

    compraAtual.status = 'recebimento_parcial'
    compraAtual.itens[0].quantidadeRecebida = 2
    compraAtual.itens[0].pendente = 3
    modal.querySelector('[data-verificar-situacao]').click()
    await tick()
    await tick()

    expect(modal.isConnected).toBe(false)
    expect(receberCompraMock).toHaveBeenCalledTimes(1)
    expect(document.querySelector('#toasts').textContent.toLowerCase()).toContain('situação da compra mudou')
  })
})
