/**
 * Integração de verdade: o registro de rotas do app aponta para as telas do
 * pacote `Login_projetos`, e as telas montam no DOM com a marca da Prime Açaí.
 *
 * Aqui não testamos o pacote isolado (ele tem os próprios testes em
 * `Login_projetos/tests`). O que este arquivo cobre é a EMENDA que o refactor
 * criou: `src/routes.js` -> `login-projetos/pages/*` -> `mount(root)`.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

import { configurarLogin } from 'login-projetos'
import { loginProjetosConfig } from '../src/login-config.js'
import { createRouter } from '../src/router.js'
import { routes } from '../src/routes.js'
import { renderShell } from '../src/layout/shell.js'
import { mostrarSaidaDemonstracao } from '../src/demo-saida.js'

beforeAll(() => {
  // É exatamente o que o `main.js` faz no boot do app.
  configurarLogin(loginProjetosConfig)
})

const rota = (caminho) => routes.find((r) => r.path === caminho)

/** Monta a página da rota num #app limpo, como o roteador faz. */
async function montar(caminho) {
  const registro = rota(caminho)
  const construirPagina = registro.loadPage ? await registro.loadPage() : registro.page
  const pagina = construirPagina()
  document.body.innerHTML = '<div id="app"></div>'
  const root = document.querySelector('#app')
  root.innerHTML = pagina.html
  pagina.mount(root)
  return root
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('o app registra as telas do pacote', () => {
  it('organiza a navegação por tarefa e inclui a Administração na rota existente', () => {
    const html = renderShell(routes)
    const caminhos = [...html.matchAll(/data-route="([^"]+)"/g)].map(([, caminho]) => caminho)
    const rotulos = caminhos.map((caminho) => rota(caminho).label)

    expect(rotulos).toEqual([
      'Dashboard',
      'Vendas',
      'Clientes',
      'Produtos',
      'Estoque',
      'Estoque Buffet',
      'Compras',
      'Fornecedores',
      'Financeiro',
      'Configurações',
    ])
    expect(html).toContain('id="btn-sair"')
    expect(routes.find((r) => r.path === '/clientes').group).toBe('Atendimento')
    expect(routes.find((r) => r.path === '/fornecedores').group).toBe('Suprimentos')
    expect(routes.find((r) => r.path === '/produtos').group).toBe('Produtos e estoque')
    expect(routes.find((r) => r.path === '/configuracoes')).toMatchObject({
      group: 'Administração',
      modulo: 'configuracoes',
    })
    expect(html).toContain('Administração')
  })

  it('as quatro telas de autenticação estão registradas como públicas', () => {
    for (const caminho of ['/login', '/cadastro', '/recuperar-senha', '/redefinir-senha']) {
      const r = rota(caminho)
      expect(r, `rota ${caminho} ausente em src/routes.js`).toBeTruthy()
      expect(r.publica, `${caminho} deveria ser publica`).toBe(true)
      expect(typeof (r.loadPage ?? r.page), `${caminho} deveria ter um carregador`).toBe('function')
    }
  })

  it('a redefinição de senha continua permitida COM sessão (link do e-mail)', () => {
    // Sem esta exceção o guarda expulsaria quem chega logado pelo link.
    expect(rota('/redefinir-senha').permiteLogado).toBe(true)
  })

  it('reconhece a rota de redefinição quando o link contém o token na query', () => {
    const router = createRouter({ routes, raiz: document.body, shells: {} })

    expect(router.match('/redefinir-senha?token=token-de-teste')).toBe(rota('/redefinir-senha'))
  })
})

describe('sair do modo de demonstração', () => {
  it('mostra uma tela de saída e permite voltar ao sistema', () => {
    const root = document.createElement('div')
    const voltar = vi.fn()

    mostrarSaidaDemonstracao(root, voltar)

    expect(root.textContent).toContain('Você saiu do sistema local')
    expect(root.textContent).toContain('não são gravados no banco')
    root.querySelector('#demo-voltar').click()
    expect(voltar).toHaveBeenCalledOnce()
  })
})

describe('tela de login montada pelo app', () => {
  it('renderiza o formulário com a marca e as rotas do app', async () => {
    const root = await montar('/login')

    expect(root.querySelector('.auth')).toBeTruthy()
    expect(root.textContent).toContain('Prime Açaí')
    expect(root.textContent).toContain('Use o e-mail cadastrado na Prime Açaí.')

    expect(root.querySelector('#auth-email')).toBeTruthy()
    expect(root.querySelector('#auth-senha')).toBeTruthy()
    expect(root.querySelector('#btn-login')).toBeTruthy()

    expect(root.querySelector('a[href="#/recuperar-senha"]')).toBeTruthy()
    // Cadastro por convite: sem link público, mas a rota continua ativa.
    expect(root.querySelector('a[href="#/cadastro"]')).toBeFalsy()
    expect(root.textContent).toContain('O cadastro é por convite')
  })

  it('o botão de olho alterna o type da senha sem apagar o valor digitado', async () => {
    const root = await montar('/login')
    const senha = root.querySelector('#auth-senha')

    senha.value = 'minha-senha'
    expect(senha.type).toBe('password')

    root.querySelector('[data-olho="senha"]').click()
    expect(senha.type).toBe('text')
    expect(senha.value).toBe('minha-senha')

    root.querySelector('[data-olho="senha"]').click()
    expect(senha.type).toBe('password')
    expect(senha.value).toBe('minha-senha')
  })

  it('e-mail inválido mostra o erro do campo e não chama o backend', async () => {
    const root = await montar('/login')
    const form = root.querySelector('#form-login')

    form.elements.email.value = 'nao-e-email'
    form.elements.senha.value = 'seja-o-que-for'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    const erro = root.querySelector('#erro-email')
    expect(erro.hidden).toBe(false)
    expect(erro.textContent).toMatch(/inválido/i)

    // O botão segue livre (não ficou em "Carregando…"), ou seja, nada foi enviado.
    expect(root.querySelector('#btn-login').disabled).toBe(false)
  })
})
