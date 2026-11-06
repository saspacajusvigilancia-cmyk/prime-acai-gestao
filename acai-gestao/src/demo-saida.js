export function mostrarSaidaDemonstracao(raiz, aoVoltar) {
  raiz.innerHTML = `
    <main class="demo-saida">
      <section class="demo-saida__painel" aria-labelledby="demo-saida-titulo">
        <span class="demo-saida__marca" aria-hidden="true">Prime Açaí</span>
        <h1 id="demo-saida-titulo">Você saiu do sistema local</h1>
        <p>A demonstração foi encerrada. Os dados de exemplo não são gravados no banco.</p>
        <button class="btn btn--primary" id="demo-voltar" type="button">Voltar ao sistema</button>
      </section>
    </main>
  `

  raiz.querySelector('#demo-voltar').addEventListener('click', aoVoltar)
}
