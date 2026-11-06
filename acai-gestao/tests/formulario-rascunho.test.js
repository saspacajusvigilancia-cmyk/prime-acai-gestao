// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { abrirFormulario, confirmarSaidaComRascunhos, fechar } from '../src/formulario.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function abrir(titulo = 'Cadastro', aoSalvar = vi.fn()) {
  abrirFormulario({
    titulo,
    campos: [{ nome: 'nome', label: 'Nome', tipo: 'texto' }],
    aoSalvar,
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  fechar()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('proteção reutilizável de rascunhos', () => {
  it('pede confirmação no fundo e mantém os dados ao continuar editando', async () => {
    abrir()
    const nome = document.querySelector('[name="nome"]')
    nome.value = 'Rascunho'
    nome.dispatchEvent(new Event('input', { bubbles: true }))

    document.querySelector('.modal__scrim').click()
    expect(document.querySelector('.modal')).not.toBeNull()
    expect(document.querySelectorAll('.modal')).toHaveLength(2)
    expect(document.querySelector('.modal button.btn--ghost[data-cancelar]').textContent)
      .toBe('Continuar editando')

    document.querySelector('.modal [data-cancelar]').click()
    await tick()

    expect(document.querySelectorAll('.modal')).toHaveLength(1)
    expect(document.querySelector('[name="nome"]').value).toBe('Rascunho')
  })

  it('protege X e Escape e descarta apenas após confirmação explícita', async () => {
    abrir()
    const nome = document.querySelector('[name="nome"]')
    nome.value = 'Manter até confirmar'
    nome.dispatchEvent(new Event('input', { bubbles: true }))

    document.querySelector('.modal__x').click()
    expect(document.querySelectorAll('.modal')).toHaveLength(2)
    document.querySelector('.modal [data-cancelar]').click()
    await tick()
    expect(document.querySelector('[name="nome"]').value).toBe('Manter até confirmar')

    nome.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await tick()
    expect(document.querySelectorAll('.modal')).toHaveLength(2)
    document.querySelector('.modal [data-confirmar]').click()
    await tick()
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('não substitui um formulário preenchido ao abrir outro', async () => {
    abrir('Primeiro')
    const nome = document.querySelector('[name="nome"]')
    nome.value = 'Preservado'
    nome.dispatchEvent(new Event('input', { bubbles: true }))

    abrir('Segundo')
    expect(document.querySelectorAll('.modal')).toHaveLength(2)
    document.querySelector('.modal [data-cancelar]').click()
    await tick()
    expect(document.querySelector('.modal__titulo').textContent).toBe('Primeiro')
    expect(document.querySelector('[name="nome"]').value).toBe('Preservado')

    abrir('Segundo')
    document.querySelector('.modal [data-confirmar]').click()
    await tick()
    expect(document.querySelector('.modal__titulo').textContent).toBe('Segundo')
  })

  it('impede navegação confirmada até a escolha e preserva o rascunho ao cancelar', async () => {
    abrir()
    const nome = document.querySelector('[name="nome"]')
    nome.value = 'Ainda não salvo'

    const saida = confirmarSaidaComRascunhos()
    await tick()
    expect(document.querySelectorAll('.modal')).toHaveLength(2)
    document.querySelector('.modal [data-cancelar]').click()
    await expect(saida).resolves.toBe(false)
    expect(document.querySelector('[name="nome"]').value).toBe('Ainda não salvo')

    const confirmada = confirmarSaidaComRascunhos()
    await tick()
    document.querySelector('.modal [data-confirmar]').click()
    await expect(confirmada).resolves.toBe(true)
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('mantém campos e impede envio duplicado enquanto o salvamento está em curso', async () => {
    let concluir
    const aoSalvar = vi.fn(() => new Promise((resolve) => { concluir = resolve }))
    abrir('Salvar', aoSalvar)
    const nome = document.querySelector('[name="nome"]')
    nome.value = 'Valor mantido'
    nome.dispatchEvent(new Event('input', { bubbles: true }))
    const form = document.querySelector('.modal__form')

    const enviar = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    enviar()
    enviar()
    expect(aoSalvar).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-salvar]').getAttribute('aria-busy')).toBe('true')

    concluir('Salvo')
    await tick()
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('mantém os campos preenchidos quando a validação impede o salvamento', async () => {
    const aoSalvar = vi.fn()
    abrirFormulario({
      titulo: 'Cadastro',
      campos: [
        { nome: 'nome', label: 'Nome', tipo: 'texto', obrigatorio: true },
        { nome: 'email', label: 'E-mail', tipo: 'texto', obrigatorio: true },
      ],
      aoSalvar,
    })
    const nome = document.querySelector('[name="nome"]')
    nome.value = 'Rascunho válido'
    nome.dispatchEvent(new Event('input', { bubbles: true }))

    document.querySelector('.modal__form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await tick()

    expect(aoSalvar).not.toHaveBeenCalled()
    expect(document.querySelector('[name="nome"]').value).toBe('Rascunho válido')
    expect(document.querySelector('[name="email"]').getAttribute('aria-invalid')).toBe('true')
    expect(document.querySelector('.modal')).not.toBeNull()
  })

  it('mantém o rascunho após erro de salvamento e permite tentar novamente', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const aoSalvar = vi.fn()
      .mockRejectedValueOnce(new Error('Falha controlada de validação'))
      .mockResolvedValueOnce('Salvo')
    abrir('Salvar', aoSalvar)
    const nome = document.querySelector('[name="nome"]')
    nome.value = 'Preservado após erro'
    nome.dispatchEvent(new Event('input', { bubbles: true }))
    const form = document.querySelector('.modal__form')
    const enviar = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    enviar()
    await tick()

    expect(erro).toHaveBeenCalledOnce()
    expect(document.querySelector('.modal')).not.toBeNull()
    expect(document.querySelector('[name="nome"]').value).toBe('Preservado após erro')
    expect(document.querySelector('.modal__erro').hidden).toBe(false)
    expect(document.querySelector('[data-salvar]').disabled).toBe(false)

    enviar()
    await tick()
    expect(aoSalvar).toHaveBeenCalledTimes(2)
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('registra beforeunload somente enquanto houver alterações pendentes', () => {
    abrir()
    const nome = document.querySelector('[name="nome"]')
    nome.value = 'Alterado'
    const evento = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(evento)
    expect(evento.defaultPrevented).toBe(true)

    fechar()
    const eventoLimpo = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(eventoLimpo)
    expect(eventoLimpo.defaultPrevented).toBe(false)
  })
})
