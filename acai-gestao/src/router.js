/**
 * Roteador mínimo baseado em hash (#/vendas, #/estoque...).
 *
 * Escolhemos hash em vez de History API de propósito: funciona em qualquer
 * hospedagem estática (Cloudflare Pages, GitHub Pages, Vercel) sem precisar de
 * configuração de rewrite no servidor.
 *
 * Cada rota aponta para uma página no formato:
 *   { html: string, mount?(root) -> cleanup? }
 *
 * O roteador conhece dois invólucros ("shells"):
 *
 *   app  — menu lateral + barra superior, o sistema em si;
 *   auth — tela cheia de login/cadastro, sem menu.
 *
 * O invólucro é escolhido por rota (`publica: true` → `auth`), e só é
 * reconstruído quando muda. Trocar de página dentro do mesmo invólucro mexe
 * apenas no miolo.
 *
 * `guarda(rota, path)` pode devolver outro caminho para onde ir — é assim que
 * quem não está logado vai parar no login. Ele é síncrono de propósito: quem
 * sabe se há sessão é o `main.js`, que carrega isso antes de criar o roteador.
 */
export function createRouter({ routes, raiz, shells, guarda, onRender, beforeNavigate }) {
  const fallback = routes.find((rota) => rota.path === '*')
  let desmontar = null
  let shellAtual = null
  let caminhoRenderizado = null
  let sequenciaNavegacao = 0
  let sequenciaRender = 0

  function currentPath() {
    const bruto = window.location.hash.replace(/^#/, '')
    if (!bruto) return '/'
    return bruto.startsWith('/') ? bruto : `/${bruto}`
  }

  function match(path) {
    const caminho = String(path).split('?')[0]
    return routes.find((rota) => rota.path === caminho) ?? fallback
  }

  function navigate(path) {
    if (currentPath() === path) {
      void renderComProtecao({ forcar: true })
      return
    }
    window.location.hash = path
  }

  function render() {
    const renderAtual = ++sequenciaRender
    const path = currentPath()
    const rota = match(path)

    // O guarda pode mandar para outro caminho antes de qualquer desenho.
    if (typeof guarda === 'function') {
      const destino = guarda(rota, path)
      if (destino && destino !== path) {
        navigate(destino)
        return
      }
    }

    const tipo = rota.publica ? 'auth' : 'app'

    function mostrarFalhaCarga(erro) {
      if (renderAtual !== sequenciaRender || currentPath() !== path) return
      console.error(`[router] Falha ao carregar a rota ${path}:`, erro)

      if (typeof desmontar === 'function') desmontar()
      desmontar = null
      if (shellAtual !== tipo) {
        if (typeof shells[shellAtual]?.aoDesmontar === 'function') shells[shellAtual].aoDesmontar(raiz)
        raiz.innerHTML = shells[tipo].html()
        shellAtual = tipo
        if (typeof shells[tipo].aoMontar === 'function') shells[tipo].aoMontar(raiz)
      }

      const outlet = raiz.querySelector(shells[tipo].outlet)
      outlet.innerHTML = '<p class="alert alert--danger" role="alert">Não foi possível abrir esta tela. Tente novamente.</p>'
      if (typeof onRender === 'function') onRender({ rota, path, outlet, shell: tipo })
      caminhoRenderizado = path
    }

    function desenhar(pagina) {
      if (renderAtual !== sequenciaRender || currentPath() !== path) return

      // Libera listeners e gráficos da página anterior antes de trocar o HTML.
      if (typeof desmontar === 'function') desmontar()
      desmontar = null

      if (shellAtual !== tipo) {
        if (typeof shells[shellAtual]?.aoDesmontar === 'function') shells[shellAtual].aoDesmontar(raiz)

        raiz.innerHTML = shells[tipo].html()
        shellAtual = tipo
        if (typeof shells[tipo].aoMontar === 'function') shells[tipo].aoMontar(raiz)
      }

      const outlet = raiz.querySelector(shells[tipo].outlet)
      outlet.innerHTML = pagina.html

      if (typeof pagina.mount === 'function') {
        desmontar = pagina.mount(outlet) ?? null
      }

      if (typeof onRender === 'function') onRender({ rota, path, outlet, shell: tipo })
      caminhoRenderizado = path
    }

    if (typeof rota.loadPage === 'function') {
      void rota.loadPage().then(
        (construirPagina) => {
          if (typeof construirPagina !== 'function') {
            mostrarFalhaCarga(new TypeError(`A rota ${path} não retornou uma página válida.`))
            return
          }
          desenhar(construirPagina({ path, rota }))
        },
        mostrarFalhaCarga,
      )
      return
    }

    // Libera listeners e gráficos da página anterior antes de trocar o HTML.
    desenhar(rota.page({ path, rota }))
  }

  async function renderComProtecao({ forcar = false, apenasAutorizar = false } = {}) {
    const destino = currentPath()
    const origem = caminhoRenderizado
    if (origem && beforeNavigate && (forcar || destino !== origem)) {
      const sequencia = ++sequenciaNavegacao
      const permitido = await beforeNavigate({ origem, destino })
      if (sequencia !== sequenciaNavegacao || currentPath() !== destino) return false
      if (!permitido) {
        if (destino !== origem) {
          window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${window.location.search}#${origem}`,
          )
        }
        return false
      }
    }
    if (apenasAutorizar) return true
    if (currentPath() === destino) render()
    return currentPath() === destino
  }

  const aoMudarHash = () => {
    void renderComProtecao()
  }
  window.addEventListener('hashchange', aoMudarHash)

  /**
   * Reconstrói o invólucro (menu lateral) na próxima renderização.
   *
   * O menu é montado uma vez e só muda junto com o invólucro. Quando as
   * permissões mudam (um admin concedeu/negou acesso), é preciso refazê-lo —
   * senão a pessoa continua vendo itens que já não pode abrir.
   */
  async function reconstruirMenu() {
    if (!await renderComProtecao({ forcar: true, apenasAutorizar: true })) return
    // Desmonta o invólucro antes de esquecê-lo: `render` só chama
    // `aoDesmontar` quando o tipo muda, e aqui o shell é o mesmo. Sem isso,
    // listeners de `document`/`window` e o intervalo do badge se acumulam a
    // cada evento `permissoes-mudaram`.
    if (typeof shells[shellAtual]?.aoDesmontar === 'function') {
      shells[shellAtual].aoDesmontar(raiz)
    }
    shellAtual = null
    render()
  }

  function destruir() {
    window.removeEventListener('hashchange', aoMudarHash)
    if (typeof desmontar === 'function') desmontar()
    if (typeof shells[shellAtual]?.aoDesmontar === 'function') shells[shellAtual].aoDesmontar(raiz)
  }

  return { render, navigate, currentPath, match, reconstruirMenu, destruir }
}
