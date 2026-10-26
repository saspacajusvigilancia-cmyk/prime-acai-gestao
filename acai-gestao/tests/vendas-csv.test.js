import { describe, it, expect } from 'vitest'
import { gerarCsvVendas } from '../src/services/vendas.js'

/**
 * Contrato do arquivo exportado em Vendas.
 *
 * O CSV é aberto no Excel brasileiro: precisa de BOM, ponto e vírgula e
 * dinheiro com vírgula decimal. Também precisa dizer "Estornada" para uma venda
 * cancelada por estorno — na tabela ela não aparece como "Cancelada".
 */

const venda = (extra = {}) => ({
  id: '#4821',
  cliente: 'Maria Souza',
  itens: 3,
  hora: '14:32',
  tipoVenda: 'Balcão',
  plataforma: null,
  pedidoExterno: null,
  pagamento: 'Pix',
  taxaEntrega: 0,
  total: 64.5,
  comissaoEstimada: 0,
  valorLiquidoEstimado: 64.5,
  status: 'Concluída',
  estornadaEm: null,
  ...extra,
})

describe('gerarCsvVendas', () => {
  it('gera CSV com BOM, cabeçalho em português e ponto e vírgula', () => {
    const csv = gerarCsvVendas([venda()])
    const [cabecalho, linha] = csv.split('\r\n')

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(cabecalho).toContain('"Pedido";"Cliente"')
    expect(cabecalho).toContain('"Total (R$)"')
    expect(linha).toBe(
      '"#4821";"Maria Souza";"3";"14:32";"Balcão";"";"";"Pix";"0,00";"64,50";"0,00";"64,50";"Concluída"',
    )
  })

  it('escapa aspas e separa valores monetários com vírgula decimal', () => {
    const csv = gerarCsvVendas([
      venda({ cliente: 'Maria "Mari" Souza', total: 1250.9, taxaEntrega: 7.5 }),
    ])

    expect(csv).toContain('"Maria ""Mari"" Souza"')
    expect(csv).toContain('"7,50"')
    expect(csv).toContain('"1.250,90"')
  })

  it('marca venda estornada como "Estornada" e deixa campos opcionais vazios', () => {
    const csv = gerarCsvVendas([
      venda({ status: 'Cancelada', estornadaEm: '2026-10-20T15:00:00Z' }),
    ])

    expect(csv).toContain('"Estornada"')
    expect(csv).not.toContain('"Cancelada"')
    expect(csv.split('\r\n')[1]).toContain('"";"";"Pix"')
  })

  it('exporta só o cabeçalho quando não há vendas', () => {
    const csv = gerarCsvVendas()

    expect(csv.split('\r\n')).toHaveLength(1)
    expect(csv).toContain('"Pedido"')
  })
})
