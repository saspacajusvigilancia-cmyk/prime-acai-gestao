// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const neonMock = vi.hoisted(() => ({
  configurado: true,
  client: { from: vi.fn() },
}))

vi.mock('login-projetos/neon', () => ({
  get neonConfigurado() {
    return neonMock.configurado
  },
  neon: neonMock.client,
}))

const { carregar, classificarErroNeon, EVENTOS_DADOS, gravar, neon, verificarConexaoNeon } =
  await import('../src/services/base.js')
const eventos = []
const capturarEvento = (evento) => eventos.push(evento)

window.addEventListener(EVENTOS_DADOS.carregamentoFalhou, capturarEvento)
window.addEventListener(EVENTOS_DADOS.carregamentoConcluido, capturarEvento)

afterEach(() => {
  eventos.length = 0
  neonMock.configurado = true
  neonMock.client.from.mockReset()
  vi.restoreAllMocks()
})

describe('carregar com Neon configurado', () => {
  it('propaga falhas sem devolver dados de demonstração', async () => {
    const erro = new Error('conexão indisponível')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      carregar({
        nome: 'produtos',
        consulta: async () => {
          throw erro
        },
        exemplo: [{ id: 'DEMO' }],
      }),
    ).rejects.toBe(erro)

    expect(eventos).toHaveLength(1)
    expect(eventos[0].type).toBe(EVENTOS_DADOS.carregamentoFalhou)
    expect(eventos[0].detail).toEqual({ nome: 'produtos', categoria: 'indisponivel' })
  })

  it('emite recuperação após uma consulta bem-sucedida', async () => {
    const dados = [{ id: 'real' }]
    const resultado = await carregar({
      nome: 'produtos',
      consulta: async () => dados,
      exemplo: [],
    })

    expect(resultado).toEqual({ dados, origem: 'neon' })
    expect(eventos).toHaveLength(1)
    expect(eventos[0].type).toBe(EVENTOS_DADOS.carregamentoConcluido)
  })

  it('desiste com mensagem clara quando a consulta não responde (timeout)', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const promessa = carregar({
        nome: 'resumo',
        // Nunca resolve: simula a requisição pendurada que deixava a tela em
        // "Carregando..." para sempre.
        consulta: () => new Promise(() => {}),
        exemplo: [],
      })

      const verificacao = expect(promessa).rejects.toThrow(/Tempo limite/)
      await vi.advanceTimersByTimeAsync(20_001)
      await verificacao

      expect(eventos.at(-1)?.type).toBe(EVENTOS_DADOS.carregamentoFalhou)
      expect(eventos.at(-1)?.detail).toEqual({ nome: 'resumo', categoria: 'indisponivel' })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('persistência e estado da conexão', () => {
  it('bloqueia escrita crítica sem Neon, sem chamar o escritor nem retornar sucesso de demonstração', async () => {
    neonMock.configurado = false
    const escrever = vi.fn()

    await expect(
      gravar({
        nome: 'estorno',
        registro: { id: 'demo' },
        escrever,
        exigirPersistencia: true,
      }),
    ).rejects.toThrow(/Neon não está configurado.*Nenhuma alteração foi salva/)

    expect(escrever).not.toHaveBeenCalled()
  })

  it('preserva o fallback de demonstração somente para escritas não críticas', async () => {
    neonMock.configurado = false
    const registro = { id: 'demo' }

    await expect(gravar({ nome: 'cadastro', registro, escrever: vi.fn() })).resolves.toEqual({
      dados: registro,
      origem: 'exemplo',
    })
  })

  it('confirma conectividade com uma leitura autenticada e trata erro de rede', async () => {
    const consulta = { limit: vi.fn().mockResolvedValue({ error: null }) }
    const tabela = { select: vi.fn(() => consulta) }
    neon.from.mockReturnValue(tabela)

    await expect(verificarConexaoNeon()).resolves.toEqual({ status: 'conectado' })
    expect(neon.from).toHaveBeenCalledWith('profiles')
    expect(tabela.select).toHaveBeenCalledWith('id')
    expect(consulta.limit).toHaveBeenCalledWith(1)

    consulta.limit.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(verificarConexaoNeon()).resolves.toEqual({ status: 'indisponivel' })
  })

  it.each([
    [{ status: 401 }, 'autenticacao'],
    [{ status: 403 }, 'permissao'],
    [{ status: 503 }, 'indisponivel'],
    [{ code: 'PGRST202' }, 'consulta'],
  ])('classifica %o como %s', (erro, categoria) => {
    expect(classificarErroNeon(erro)).toBe(categoria)
  })

  it('avisa que um timeout de escrita precisa ser conferido antes de repetir', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const resultado = gravar({
        nome: 'estorno',
        registro: {},
        escrever: () => new Promise(() => {}),
        exigirPersistencia: true,
      })
      const verificacao = expect(resultado).rejects.toThrow(/resultado não foi confirmado.*verifique o registro/)
      await vi.advanceTimersByTimeAsync(20_001)
      await verificacao
    } finally {
      vi.useRealTimers()
    }
  })
})
