/**
 * Formulário modal reutilizado pelas telas.
 *
 * Os campos são declarados como dados, não como HTML:
 *
 *   abrirFormulario({
 *     titulo: 'Novo item',
 *     campos: [
 *       { nome: 'nome',  label: 'Nome',  tipo: 'texto',  obrigatorio: true, largo: true },
 *       { nome: 'custo', label: 'Custo', tipo: 'moeda' },
 *     ],
 *     aoSalvar: async (valores) => 'Item salvo.',   // a string vira um toast
 *   })
 *
 * `aoSalvar` pode lançar um erro: a mensagem aparece dentro da janela, que
 * continua aberta para o usuário corrigir e tentar de novo.
 */

import { itensHtml, iniciarItens } from './itens-venda.js'
import { renderIcons } from './icons.js'
import {
  ativarCamposMonetarios,
  centavosParaReais,
  paraCentavos,
  paraNumero,
  paraTextoNumero,
} from './numeros.js'
import { entradaMoeda, esc, toast } from './ui.js'

/* ----------------------------------------------------------- números ------ */

/**
 * `paraNumero` e `paraTextoNumero` passaram a morar em `numeros.js` na P3: o
 * módulo de peso também precisa deles e não podia importar daqui (arrastaria
 * DOM). Continuam reexportados porque várias telas já importavam deste arquivo.
 */
export { paraNumero, paraTextoNumero }

/* ------------------------------------------------------------ campos ----- */

function opcoesHtml(opcoes, selecionado) {
  return opcoes
    .map((o) => {
      const valor = typeof o === 'string' ? o : o.valor
      const rotulo = typeof o === 'string' ? o : o.rotulo
      const sel = String(valor) === String(selecionado ?? '') ? ' selected' : ''
      return `<option value="${esc(valor)}"${sel}>${esc(rotulo)}</option>`
    })
    .join('')
}

/**
 * Um campo do formulário. Exportado porque a tela de Configurações da Empresa
 * também monta campos fora de uma janela modal — assim as duas telas usam o
 * mesmo HTML e as mesmas classes, e não existem dois estilos de campo no app.
 */
export function campoHtml(campo, valor) {
  const id = `campo-${campo.nome}`
  const attrs = `id="${id}" name="${esc(campo.nome)}"`
  const req = campo.obrigatorio ? ' data-obrigatorio="1"' : ''
  let controle = ''

  if (campo.tipo === 'select') {
    // `vazio: false` tira o "Selecione..." — usado quando a lista já tem uma
    // opção marcada por padrão (as preferências, por exemplo).
    const vazio =
      campo.vazio === false ? '' : `<option value="">${esc(campo.vazio ?? 'Selecione...')}</option>`

    controle = `<select class="campo__input" ${attrs}${req}>
        ${vazio}
        ${opcoesHtml(campo.opcoes ?? [], valor)}
      </select>`
  } else if (campo.tipo === 'textarea') {
    controle = `<textarea class="campo__input" ${attrs}${req} rows="3"
        placeholder="${esc(campo.placeholder ?? '')}">${esc(valor ?? '')}</textarea>`
  } else if (campo.tipo === 'data') {
    controle = `<input class="campo__input" type="date" ${attrs}${req} value="${esc(valor ?? '')}" />`
  } else if (campo.tipo === 'numero') {
    controle = `<input class="campo__input" type="text" inputmode="decimal" ${attrs}${req}
        value="${esc(paraTextoNumero(valor))}" placeholder="${esc(campo.placeholder ?? '0')}" />`
  } else if (campo.tipo === 'moeda') {
    controle = entradaMoeda({
      id,
      name: campo.nome,
      value: valor,
      required: Boolean(campo.obrigatorio),
      placeholder: campo.placeholder ?? '0,00',
      prefixo: campo.prefixo ?? 'R$',
    })
  } else {
    const lista = campo.sugestoes ? ` list="lista-${id}"` : ''
    // `mascara` liga a formatação enquanto o usuário digita (CNPJ, CEP,
    // telefone). Quem aplica é a tela, escutando o `data-mascara`.
    const mascara = campo.mascara ? ` data-mascara="${esc(campo.mascara)}"` : ''
    const inputmode = campo.inputmode ? ` inputmode="${esc(campo.inputmode)}"` : ''
    const maxlength = campo.maxlength ? ` maxlength="${Number(campo.maxlength)}"` : ''
    // `somenteLeitura` serve para valores gerados pelo sistema (o código do
    // cliente, por exemplo): aparecem no formulário, mas não podem ser editados.
    const travado = campo.somenteLeitura ? ' readonly aria-readonly="true"' : ''
    const classe = `campo__input${campo.somenteLeitura ? ' campo__input--travado' : ''}`
    controle = `<input class="${classe}" type="text" ${attrs}${req}${lista}${mascara}${inputmode}${maxlength}${travado}
        value="${esc(valor ?? '')}" placeholder="${esc(campo.placeholder ?? '')}" autocomplete="off" />`
    if (campo.sugestoes) {
      controle += `<datalist id="lista-${id}">${campo.sugestoes
        .map((s) => `<option value="${esc(s)}"></option>`)
        .join('')}</datalist>`
    }
  }

  return `
    <div class="campo${campo.largo ? ' campo--largo' : ''}" data-campo="${esc(campo.nome)}">
      <label class="campo__label" for="${id}">
        ${esc(campo.label)}${campo.obrigatorio ? ' <span class="campo__req">*</span>' : ''}
      </label>
      ${
        campo.tipo !== 'moeda' && campo.prefixo
          ? `<div class="campo__grupo"><span class="campo__prefixo">${esc(campo.prefixo ?? 'R$')}</span>${controle}</div>`
          : controle
      }
      ${campo.ajuda ? `<p class="campo__ajuda">${esc(campo.ajuda)}</p>` : ''}
      <p class="campo__erro" data-erro hidden></p>
    </div>
  `
}

/* ------------------------------------------------------------ janela ----- */

let aberto = null
let limpar = null

/**
 * Traduz erros técnicos em mensagens que o usuário entende.
 *
 * O usuário final não tem o que fazer com "neon/00_banco_neon.sql", nome de
 * variável de ambiente ou stack trace. Quando a mensagem original já é útil
 * (validação de negócio lançada pelo serviço), ela é preservada; o resto vira
 * uma orientação curta e acionável.
 */
function mensagemDeErro(erro) {
  const texto = erro?.message ?? String(erro)
  const contexto = [erro?.code, erro?.constraint, texto, erro?.details, erro?.hint]
    .filter(Boolean)
    .join(' ')

  if (
    erro?.code === '23505' ||
    erro?.constraint?.endsWith('_codigo_key') ||
    /duplicate key|unique constraint/i.test(contexto)
  ) {
    return 'Já existe um registro com esse código.'
  }
  if (/violates foreign key/i.test(contexto)) return 'O registro relacionado não foi encontrado.'
  if (erro?.code === '42501' || /permission denied|row-level security/i.test(contexto))
    return 'Sua conta não tem permissão para esta operação.'
  if (/Failed to fetch|NetworkError|ERR_|ECONN|ETIMEDOUT/i.test(contexto))
    return 'Não foi possível conectar ao sistema. Verifique sua conexão e tente novamente.'
  if (/timeout|tempo limite/i.test(contexto))
    return 'A operação demorou mais que o esperado. Tente novamente.'
  return texto
}

export function abrirFormulario({
  titulo,
  descricao = '',
  campos,
  valores = {},
  textoBotao = 'Salvar',
  protegerDescarte = false,
  aoSalvar,
}) {
  fechar()

  const overlay = document.createElement('div')
  overlay.className = 'modal'
  overlay.innerHTML = `
    <div class="modal__scrim" ${protegerDescarte ? '' : 'data-fechar'}></div>
    <div class="modal__caixa" role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
      <header class="modal__head">
        <div>
          <h2 class="modal__titulo" id="modal-titulo">${esc(titulo)}</h2>
          ${descricao ? `<p class="modal__desc">${esc(descricao)}</p>` : ''}
        </div>
        <button class="modal__x" type="button" data-fechar aria-label="Fechar">
          <i data-lucide="x"></i>
        </button>
      </header>
      <form class="modal__form" novalidate>
        <div class="modal__campos">
          ${campos
            .map((c) =>
              c.tipo === 'itens' ? itensHtml(c, valores[c.nome]) : campoHtml(c, valores[c.nome]),
            )
            .join('')}
        </div>
        <p class="modal__erro" role="alert" tabindex="-1" hidden></p>
        <footer class="modal__acoes">
          <button class="btn btn--ghost" type="button" data-fechar>Cancelar</button>
          <button class="btn btn--primary" type="submit" data-salvar>${esc(textoBotao)}</button>
        </footer>
      </form>
    </div>
  `

  const focoAnterior = document.activeElement
  document.body.appendChild(overlay)
  aberto = overlay
  renderIcons(overlay)
  ativarCamposMonetarios(overlay)
  document.body.classList.add('sem-scroll')

  const form = overlay.querySelector('form')
  const botaoSalvar = overlay.querySelector('[data-salvar]')
  const erroGeral = overlay.querySelector('.modal__erro')
  const campoDeItens = campos.find((c) => c.tipo === 'itens')
  let salvando = false
  let confirmandoDescarte = false

  const camposAlterados = new Set()
  const valoresIniciais = new Map(
    [...form.elements]
      .filter((elemento) => elemento.name)
      .map((elemento) => [elemento.name, elemento.value]),
  )

  const acompanharAlteracoes = (evento) => {
    const elemento = evento.target
    if (!(elemento instanceof HTMLElement) || !elemento.name) return
    if (elemento.value === valoresIniciais.get(elemento.name)) camposAlterados.delete(elemento.name)
    else camposAlterados.add(elemento.name)
  }
  form.addEventListener('input', acompanharAlteracoes)
  form.addEventListener('change', acompanharAlteracoes)

  // Liga ajuda e mensagem de erro ao campo pelo aria-describedby: leitores de
  // tela anunciam a explicação junto do input, e não como texto solto.
  overlay.querySelectorAll('[data-campo]').forEach((grupo) => {
    const nome = grupo.dataset.campo
    const input = grupo.querySelector('.campo__input')
    if (!input) return
    const ids = []
    const ajuda = grupo.querySelector('.campo__ajuda')
    const erro = grupo.querySelector('[data-erro]')
    if (ajuda) {
      ajuda.id = `ajuda-${nome}`
      ids.push(ajuda.id)
    }
    if (erro) {
      erro.id = `erro-${nome}`
      ids.push(erro.id)
    }
    if (ids.length) input.setAttribute('aria-describedby', ids.join(' '))
  })

  /* -------------------------------------------------------- fechar ------ */

  function focaveis() {
    return [...overlay.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((el) => el.offsetParent !== null)
  }

  async function solicitarFechamento() {
    if (salvando || confirmandoDescarte) return
    if (protegerDescarte && camposAlterados.size) {
      confirmandoDescarte = true
      try {
        const descartar = await confirmar({
          titulo: 'Existem dados não salvos. Deseja realmente sair e descartar as alterações?',
          textoBotao: 'Descartar alterações',
        })
        if (!descartar) return
      } finally {
        confirmandoDescarte = false
      }
    }
    fechar()
  }

  function aoTeclar(evento) {
    if (evento.key === 'Escape') {
      if (!salvando && overlay.contains(document.activeElement)) {
        evento.preventDefault()
        evento.stopPropagation()
        void solicitarFechamento()
      }
      return
    }
    if (evento.key !== 'Tab') return

    // Prende o foco dentro da janela: Tab no último campo volta ao primeiro.
    const lista = focaveis()
    if (!lista.length) return
    const primeiro = lista[0]
    const ultimo = lista[lista.length - 1]
    if (evento.shiftKey && document.activeElement === primeiro) {
      evento.preventDefault()
      ultimo.focus()
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault()
      primeiro.focus()
    }
  }

  overlay.querySelectorAll('[data-fechar]').forEach((el) =>
    el.addEventListener('click', () => {
      void solicitarFechamento()
    }),
  )
  document.addEventListener('keydown', aoTeclar)
  limpar = () => {
    document.removeEventListener('keydown', aoTeclar)
    // Devolve o foco ao botão que abriu a janela (teclado continua de onde
    // parou, em vez de voltar para o início da página).
    if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected) focoAnterior.focus()
  }

  /* --------------------------------------------- itens: somar subtotais -- */

  // O campo `itens` (produto + quantidade ou peso) mora em `itens-venda.js`:
  // é onde vive a conta da venda por peso e onde os campos de peso aparecem.
  const widgetItens = campoDeItens ? iniciarItens({ overlay, campo: campoDeItens }) : null

  /* ---------------------------------------------------- validação ------- */

  function limparErros() {
    overlay.querySelectorAll('[data-erro]').forEach((el) => {
      el.hidden = true
      el.textContent = ''
    })
    overlay.querySelectorAll('.campo__input').forEach((el) => {
      el.classList.remove('is-erro')
      el.removeAttribute('aria-invalid')
    })
    erroGeral.hidden = true
  }

  function mostrarErro(nome, mensagem) {
    const alvo = overlay.querySelector(`[data-campo="${nome}"]`)
    if (!alvo) return

    const p = alvo.querySelector('[data-erro]')
    p.textContent = mensagem
    p.hidden = false
    alvo.querySelectorAll('.campo__input').forEach((el) => {
      el.classList.add('is-erro')
      el.setAttribute('aria-invalid', 'true')
    })
  }

  function coletar() {
    const saida = {}

    for (const campo of campos) {
      if (campo.tipo === 'itens') {
        // Quem lê as linhas é o widget (`itens-venda.js`): só as linhas
        // preenchidas e válidas — linha inválida é barrada antes pela validação.
        saida[campo.nome] = widgetItens ? widgetItens.coletar() : []
        continue
      }

      const el = overlay.querySelector(`[name="${campo.nome}"]`)
      const bruto = el.value.trim()
      if (campo.tipo === 'numero') {
        saida[campo.nome] = paraNumero(bruto)
      } else if (campo.tipo === 'moeda') {
        const centavos = bruto ? paraCentavos(bruto) : ''
        saida[campo.nome] = centavos === '' || !Number.isSafeInteger(centavos)
          ? centavos
          : centavosParaReais(centavos)
      } else {
        saida[campo.nome] = bruto
      }
    }

    return saida
  }

  function validar(valoresColetados) {
    const erros = []

    for (const campo of campos) {
      const v = valoresColetados[campo.nome]

      if (campo.tipo === 'itens') {
        const problema = widgetItens?.validar(v)
        if (problema) erros.push([campo.nome, problema])
        continue
      }

      if (campo.obrigatorio && (v === '' || v == null)) {
        erros.push([campo.nome, 'Campo obrigatório.'])
        continue
      }

      if ((campo.tipo === 'numero' || campo.tipo === 'moeda') && v !== '' && v != null) {
        if (!Number.isFinite(v)) {
          erros.push([
            campo.nome,
            campo.tipo === 'moeda' ? 'Informe um valor monetário válido.' : 'Informe um número válido.',
          ])
        }
        else if (v < (campo.min ?? 0))
          erros.push([campo.nome, `O menor valor aceito é ${campo.min ?? 0}.`])
      }
    }

    return erros
  }

  /* ------------------------------------------------------- enviar ------- */

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    if (salvando) return
    limparErros()

    const valoresColetados = coletar()
    const erros = validar(valoresColetados)

    if (erros.length) {
      erros.forEach(([nome, mensagem]) => mostrarErro(nome, mensagem))
      overlay.querySelector('.campo__input.is-erro')?.focus()
      return
    }

    salvando = true
    botaoSalvar.disabled = true
    botaoSalvar.setAttribute('aria-busy', 'true')
    overlay.querySelectorAll('[data-fechar]').forEach((el) => {
      el.disabled = true
    })
    const rotulo = botaoSalvar.textContent
    botaoSalvar.textContent = 'Salvando...'

    try {
      const mensagem = await aoSalvar(valoresColetados)
      fechar()
      toast(mensagem || 'Salvo com sucesso.')
    } catch (erro) {
      console.error('[formulario] Falha ao salvar:', erro)
      erroGeral.textContent = mensagemDeErro(erro)
      erroGeral.hidden = false
      erroGeral.focus?.()
      salvando = false
      botaoSalvar.disabled = false
      botaoSalvar.removeAttribute('aria-busy')
      botaoSalvar.textContent = rotulo
      overlay.querySelectorAll('[data-fechar]').forEach((el) => {
        el.disabled = false
      })
    }
  })

  // Foco no primeiro campo editável, para já poder digitar (campos somente
  // leitura não recebem o foco inicial).
  const primeiro = overlay.querySelector('.modal__campos .campo__input:not([readonly])')
  primeiro?.focus()
  if (primeiro && primeiro.tagName === 'INPUT' && primeiro.type === 'text') primeiro.select()
}

/** Fecha a janela aberta, se houver. */
export function fechar() {
  if (!aberto) return
  limpar?.()
  limpar = null
  aberto.remove()
  aberto = null
  document.body.classList.remove('sem-scroll')
}

/* ------------------------------------------------------- confirmação ----- */

/**
 * Janela de confirmação, com a mesma cara do formulário.
 *
 *   if (!(await confirmar({ titulo: 'Remover logomarca?', descricao: '...' }))) return
 *
 * Devolve `true` só quando o usuário confirma. Cancelar, Escape e clique fora
 * devolvem `false`.
 */
export function confirmar({ titulo, descricao = '', textoBotao = 'Confirmar' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'modal'
    overlay.innerHTML = `
      <div class="modal__scrim" data-cancelar></div>
      <div class="modal__caixa modal__caixa--estreita" role="alertdialog" aria-modal="true" aria-labelledby="confirmar-titulo">
        <header class="modal__head">
          <div>
            <h2 class="modal__titulo" id="confirmar-titulo">${esc(titulo)}</h2>
            ${descricao ? `<p class="modal__desc">${esc(descricao)}</p>` : ''}
          </div>
          <button class="modal__x" type="button" data-cancelar aria-label="Fechar">
            <i data-lucide="x"></i>
          </button>
        </header>
        <footer class="modal__acoes">
          <button class="btn btn--ghost" type="button" data-cancelar>Cancelar</button>
          <button class="btn btn--danger" type="button" data-confirmar>${esc(textoBotao)}</button>
        </footer>
      </div>
    `

    document.body.appendChild(overlay)
    renderIcons(overlay)
    document.body.classList.add('sem-scroll')

    function encerrar(resultado) {
      document.removeEventListener('keydown', aoTeclar)
      overlay.remove()
      // Se outra janela ainda estiver aberta, o scroll continua travado.
      if (!document.querySelector('.modal')) document.body.classList.remove('sem-scroll')
      resolve(resultado)
    }

    function aoTeclar(evento) {
      if (evento.key === 'Escape') encerrar(false)
    }

    overlay
      .querySelectorAll('[data-cancelar]')
      .forEach((el) => el.addEventListener('click', () => encerrar(false)))

    const botaoConfirmar = overlay.querySelector('[data-confirmar]')
    botaoConfirmar.addEventListener('click', () => encerrar(true))
    document.addEventListener('keydown', aoTeclar)

    // O foco vai para o botão de confirmar (o destrutivo), mas o usuário pode
    // sair com Escape — a ação não acontece por acidente.
    botaoConfirmar.focus()
  })
}
