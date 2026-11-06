// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRouter } from '../src/router.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('navegação com formulário alterado', () => {
  let router

  afterEach(() => {
    router?.destruir()
    router = null
    window.history.replaceState(null, '', '/')
    document.body.innerHTML = ''
  })

  it('mantém a tela atual e restaura a URL quando o descarte é cancelado', async () => {
    window.history.replaceState(null, '', '/#/a')
    const raiz = document.createElement('main')
    document.body.append(raiz)
    const guarda = vi.fn().mockResolvedValue(false)
    router = createRouter({
      routes: [
        { path: '/a', publica: true, page: () => ({ html: '<p>Tela A</p>' }) },
        { path: '/b', publica: true, page: () => ({ html: '<p>Tela B</p>' }) },
      ],
      raiz,
      shells: { auth: { html: () => '<div id="conteudo"></div>', outlet: '#conteudo' } },
      beforeNavigate: guarda,
    })

    router.render()
    window.location.hash = '/b'
    await tick()

    expect(guarda).toHaveBeenCalledWith({ origem: '/a', destino: '/b' })
    expect(router.currentPath()).toBe('/a')
    expect(raiz.textContent).toContain('Tela A')
    expect(raiz.textContent).not.toContain('Tela B')
  })

  it('renderiza a nova tela após confirmação', async () => {
    window.history.replaceState(null, '', '/#/a')
    const raiz = document.createElement('main')
    document.body.append(raiz)
    router = createRouter({
      routes: [
        { path: '/a', publica: true, page: () => ({ html: '<p>Tela A</p>' }) },
        { path: '/b', publica: true, page: () => ({ html: '<p>Tela B</p>' }) },
      ],
      raiz,
      shells: { auth: { html: () => '<div id="conteudo"></div>', outlet: '#conteudo' } },
      beforeNavigate: vi.fn().mockResolvedValue(true),
    })

    router.render()
    window.location.hash = '/b'
    await tick()

    expect(router.currentPath()).toBe('/b')
    expect(raiz.textContent).toContain('Tela B')
  })

  it('carrega páginas sob demanda e ignora uma página que terminou após navegação', async () => {
    window.history.replaceState(null, '', '/#/a')
    const raiz = document.createElement('main')
    document.body.append(raiz)
    let concluirCarregamento
    router = createRouter({
      routes: [
        { path: '/a', publica: true, page: () => ({ html: '<p>Tela A</p>' }) },
        {
          path: '/b',
          publica: true,
          loadPage: () => new Promise((resolve) => { concluirCarregamento = resolve }),
        },
      ],
      raiz,
      shells: { auth: { html: () => '<div id="conteudo"></div>', outlet: '#conteudo' } },
    })

    router.render()
    window.location.hash = '/b'
    await tick()
    expect(raiz.textContent).toContain('Tela A')

    window.location.hash = '/a'
    await tick()
    concluirCarregamento(() => ({ html: '<p>Tela B</p>' }))
    await tick()

    expect(router.currentPath()).toBe('/a')
    expect(raiz.textContent).toContain('Tela A')
    expect(raiz.textContent).not.toContain('Tela B')
  })
})
