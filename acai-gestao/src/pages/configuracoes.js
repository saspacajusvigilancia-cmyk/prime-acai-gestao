/**
 * Configuração da Empresa.
 *
 * Chega-se aqui pela engrenagem do rodapé do menu lateral (o `main.js` liga o
 * clique ao roteador). A página tem a mesma cara do resto do sistema: cartões,
 * campos e botões já usados nos formulários modais.
 *
 * Três coisas que valem explicação:
 *
 * 1. A gravação é BLOQUEADA quando a leitura falha. Se o formulário abrisse
 *    vazio por causa de um erro de rede e o usuário salvasse, ele apagaria a
 *    configuração que existe no banco sem perceber.
 * 2. A imagem só é gravada ao clicar em "Salvar alterações" — assim "Cancelar"
 *    descarta de verdade a escolha.
 * 3. Sem o Neon configurado a tela funciona, mas diz em voz alta que nada
 *    foi gravado, em vez de fingir que salvou.
 */

import { campoHtml, confirmar } from '../formulario.js'
import { renderIcons } from '../icons.js'
import { estadoSessao } from 'login-projetos/sessao'
import { emailValido } from 'login-projetos/auth'
import { neonConfigurado } from '../services/base.js'
import {
  FUSOS,
  PREFERENCIAS_PADRAO,
  UFS,
  apenasDigitos,
  carregarEmpresa,
  carregarLogo,
  cepValido,
  cnpjValido,
  mascaraCep,
  mascaraCnpj,
  mascaraTelefone,
  mensagemDoErro,
  removerLogo,
  salvarEmpresa,
  salvarLogo,
  telefoneValido,
  urlDaLogo,
  validarLogo,
} from '../services/empresa.js'
import { esc, toast } from '../ui.js'
import { permissoesPage } from './permissoes.js'
import { usuariosPage } from './usuarios.js'
import { configVendasPage } from './config-vendas.js'

/* ==========================================================================
   Declaração dos grupos
   ========================================================================== */

const GRUPOS = [
  {
    id: 'identificacao',
    icone: 'building-2',
    titulo: 'Identificação da empresa',
    descricao: 'Como a empresa aparece no sistema e nos documentos.',
    campos: [
      {
        nome: 'nome_fantasia',
        label: 'Nome fantasia',
        obrigatorio: true,
        largo: true,
        placeholder: 'Prime Açaí',
      },
      {
        nome: 'razao_social',
        label: 'Razão social',
        obrigatorio: true,
        largo: true,
        placeholder: 'Prime Açaí Comércio de Alimentos LTDA',
      },
      {
        nome: 'cnpj',
        label: 'CNPJ',
        obrigatorio: true,
        mascara: 'cnpj',
        placeholder: '00.000.000/0000-00',
      },
      { nome: 'inscricao_estadual', label: 'Inscrição estadual', ajuda: 'Opcional' },
      { nome: 'inscricao_municipal', label: 'Inscrição municipal', ajuda: 'Opcional' },
    ],
  },
  {
    id: 'contato',
    icone: 'phone',
    titulo: 'Contato',
    descricao: 'Canais que aparecem no cupom e no atendimento ao cliente.',
    campos: [
      {
        nome: 'telefone',
        label: 'Telefone',
        obrigatorio: true,
        mascara: 'telefone',
        placeholder: '(85) 3333-4444',
      },
      {
        nome: 'whatsapp',
        label: 'WhatsApp',
        mascara: 'telefone',
        ajuda: 'Opcional',
        placeholder: '(85) 99999-8888',
      },
      {
        nome: 'email',
        label: 'E-mail',
        obrigatorio: true,
        placeholder: 'contato@primeacai.com.br',
      },
      {
        nome: 'site',
        label: 'Site ou rede social',
        ajuda: 'Opcional',
        placeholder: 'https://instagram.com/primeacai',
      },
    ],
  },
  {
    id: 'endereco',
    icone: 'map-pin',
    titulo: 'Endereço',
    descricao: 'Endereço da loja, usado em documentos e entregas.',
    campos: [
      {
        nome: 'cep',
        label: 'CEP',
        obrigatorio: true,
        mascara: 'cep',
        placeholder: '00000-000',
      },
      { nome: 'uf', label: 'Estado (UF)', tipo: 'select', opcoes: UFS, obrigatorio: true },
      { nome: 'municipio', label: 'Município', obrigatorio: true, placeholder: 'Fortaleza' },
      { nome: 'bairro', label: 'Bairro', obrigatorio: true },
      { nome: 'logradouro', label: 'Rua ou avenida', obrigatorio: true, largo: true },
      { nome: 'numero', label: 'Número', obrigatorio: true, placeholder: '123' },
      { nome: 'complemento', label: 'Complemento', ajuda: 'Opcional', placeholder: 'Loja 2' },
      {
        nome: 'referencia',
        label: 'Ponto de referência',
        ajuda: 'Opcional',
        largo: true,
        placeholder: 'Ao lado da praça',
      },
    ],
  },
]

const PREFERENCIAS = {
  id: 'preferencias',
  icone: 'clock',
  titulo: 'Preferências',
  descricao: 'Valores que o sistema aplica em todas as telas.',
  campos: [
    {
      nome: 'moeda',
      label: 'Moeda padrão',
      tipo: 'select',
      vazio: false,
      opcoes: [{ valor: 'BRL', rotulo: 'Real brasileiro (BRL)' }],
      ajuda: 'O sistema formata valores em reais em todas as telas.',
    },
    {
      nome: 'fuso',
      label: 'Fuso horário padrão',
      tipo: 'select',
      vazio: false,
      opcoes: FUSOS,
    },
    {
      nome: 'formato_data',
      label: 'Formato de data',
      tipo: 'select',
      vazio: false,
      opcoes: [{ valor: 'DD/MM/AAAA', rotulo: 'DD/MM/AAAA' }],
      ajuda: 'O sistema usa este formato em todas as telas.',
    },
  ],
}

/** Máscaras aplicadas enquanto o usuário digita. */
const MASCARAS = {
  cnpj: mascaraCnpj,
  cep: mascaraCep,
  telefone: mascaraTelefone,
}

/* ==========================================================================
   HTML
   ========================================================================== */

function grupoHtml(grupo) {
  return `
    <section class="card config__bloco" aria-labelledby="titulo-${grupo.id}">
      <header class="config__bloco-head">
        <span class="config__bloco-icon"><i data-lucide="${grupo.icone}"></i></span>
        <div>
          <h2 class="card__title" id="titulo-${grupo.id}">${esc(grupo.titulo)}</h2>
          <p class="card__desc">${esc(grupo.descricao)}</p>
        </div>
      </header>
      <div class="config__campos">
        ${grupo.campos.map((campo) => campoHtml(campo, '')).join('')}
      </div>
    </section>
  `
}

const LOGOMARCA_HTML = `
  <section class="card config__bloco" aria-labelledby="titulo-logomarca">
    <header class="config__bloco-head">
      <span class="config__bloco-icon"><i data-lucide="image"></i></span>
      <div>
        <h2 class="card__title" id="titulo-logomarca">Logomarca</h2>
        <p class="card__desc">PNG, JPG, JPEG ou WEBP, até 2 MB.</p>
      </div>
    </header>

    <div class="logo">
      <div class="logo__previa" id="logo-previa"></div>

      <div class="logo__lado">
        <p class="logo__nome" id="logo-nome">Nenhum arquivo selecionado.</p>
        <p class="logo__dica" id="logo-dica">A imagem é enviada ao salvar as alterações.</p>

        <div class="logo__acoes">
          <button class="btn btn--ghost" type="button" id="btn-escolher">
            <i data-lucide="upload"></i><span>Selecionar arquivo</span>
          </button>
          <button class="btn btn--danger" type="button" id="btn-remover" hidden>
            <i data-lucide="trash-2"></i><span>Remover logomarca</span>
          </button>
        </div>

        <input type="file" id="logo-arquivo" accept="image/png,image/jpeg,image/webp" hidden />
        <p class="logo__erro" id="logo-erro" role="alert" hidden></p>
      </div>
    </div>
  </section>
`

export function configuracoesPage() {
  return {
    html: `
      <div class="config">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <div id="btn-empresa" data-painel="empresa" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);flex:1;min-width:160px">
            <i data-lucide="building-2"></i>
            <strong>Configuração da Empresa</strong>
            <span style="margin-left:auto">&#9656;</span>
          </div>
          <div id="btn-usuarios" data-painel="usuarios" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);flex:1;min-width:160px">
            <i data-lucide="users"></i>
            <strong>Usuários</strong>
            <span style="margin-left:auto">&#9656;</span>
          </div>
          <div id="btn-permissoes" data-painel="permissoes" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);flex:1;min-width:160px">
            <i data-lucide="shield"></i>
            <strong>Permissões</strong>
            <span style="margin-left:auto">&#9656;</span>
          </div>
          <div id="btn-vendas" data-painel="vendas" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);flex:1;min-width:160px">
            <i data-lucide="shopping-bag"></i>
            <strong>Vendas</strong>
            <span style="margin-left:auto">&#9656;</span>
          </div>
        </div>

        <div id="painel-empresa" hidden>
        <form class="config__painel" id="form-empresa" novalidate>
          <div id="config-avisos"></div>

          ${GRUPOS.map(grupoHtml).join('')}
          ${LOGOMARCA_HTML}
          ${grupoHtml(PREFERENCIAS)}

          <p class="config__erro" id="config-erro" role="alert" hidden></p>

          <div class="config__acoes" id="config-acoes">
            <p class="config__acoes-texto" id="config-estado"></p>
            <div class="config__botoes">
              <button class="btn btn--ghost" type="button" id="btn-cancelar">
                <i data-lucide="rotate-ccw"></i><span>Cancelar</span>
              </button>
              <button class="btn btn--primary" type="submit" id="btn-salvar">
                <i data-lucide="save"></i><span>Salvar alterações</span>
              </button>
            </div>
          </div>
        </form>
        </div>
        <div id="painel-usuarios" hidden></div>
        <div id="painel-permissoes" hidden></div>
        <div id="painel-vendas" hidden></div>
      </div>
    `,

    mount(root) {
      const form = root.querySelector('#form-empresa')
      const avisos = root.querySelector('#config-avisos')
      const erroGeral = root.querySelector('#config-erro')
      const acoes = root.querySelector('#config-acoes')
      const estado = root.querySelector('#config-estado')
      const botaoSalvar = root.querySelector('#btn-salvar')
      const botaoCancelar = root.querySelector('#btn-cancelar')

      // Painéis (lazy: monta Usuarios/Permissoes na primeira abertura).
      const painelUsuarios = root.querySelector('#painel-usuarios')
      const painelPermissoes = root.querySelector('#painel-permissoes')
      const painelVendas = root.querySelector('#painel-vendas')
      const painelEmpresa = root.querySelector('#painel-empresa')
      let pgUsuarios = null, pgPermissoes = null, pgVendas = null
      let limparUsuarios = () => {}, limparPermissoes = () => {}, limparVendas = () => {}
      let montadoUsuarios = false, montadoPermissoes = false, montadoVendas = false

      function montarUsuarios() {
        if (montadoUsuarios || !painelUsuarios) return
        montadoUsuarios = true
        pgUsuarios = usuariosPage()
        painelUsuarios.innerHTML = pgUsuarios.html
        renderIcons(painelUsuarios)
        limparUsuarios = pgUsuarios.mount(painelUsuarios) || (() => {})
      }
      function montarPermissoes() {
        if (montadoPermissoes || !painelPermissoes) return
        montadoPermissoes = true
        pgPermissoes = permissoesPage()
        painelPermissoes.innerHTML = pgPermissoes.html
        renderIcons(painelPermissoes)
        limparPermissoes = pgPermissoes.mount(painelPermissoes) || (() => {})
      }
      function montarVendas() {
        if (montadoVendas || !painelVendas) return
        montadoVendas = true
        pgVendas = configVendasPage()
        painelVendas.innerHTML = pgVendas.html
        renderIcons(painelVendas)
        limparVendas = pgVendas.mount(painelVendas) || (() => {})
      }

      // Alterna entre os 3 paineis: so um visivel por vez.
      // Ao reabrir, recarrega os dados (senao o painel fica com dados velhos).
      function abrirUsuarios() {
        const jaMontado = montadoUsuarios
        montarUsuarios()
        if (jaMontado) painelUsuarios?.recarregarUsuarios?.()
      }
      function abrirPermissoes() {
        const jaMontado = montadoPermissoes
        montarPermissoes()
        if (jaMontado) painelPermissoes?.recarregarPermissoes?.()
      }
      function abrirVendas() {
        montarVendas()
      }
      function mostrarPainel(nome) {
        if (nome === 'usuarios') abrirUsuarios()
        if (nome === 'permissoes') abrirPermissoes()
        if (nome === 'vendas') abrirVendas()
        if (painelEmpresa) painelEmpresa.hidden = (nome !== 'empresa')
        if (painelUsuarios) painelUsuarios.hidden = (nome !== 'usuarios')
        if (painelPermissoes) painelPermissoes.hidden = (nome !== 'permissoes')
        if (painelVendas) painelVendas.hidden = (nome !== 'vendas')
      }
      ;['empresa', 'usuarios', 'permissoes', 'vendas'].forEach((nome) => {
        const btn = root.querySelector(`#btn-${nome}`)
        if (btn) btn.addEventListener('click', () => mostrarPainel(nome))
      })
      // Todos fechados inicialmente.
      mostrarPainel(null)

      // Veio de uma notificacao? Abre Usuarios ja no registro indicado.
      const alvoNotif = window.__notifAlvo
      if (alvoNotif) {
        window.__notifAlvo = null
        mostrarPainel('usuarios')
        Promise.resolve()
          .then(() => painelUsuarios?.abrirNotificacaoUsuario?.(alvoNotif))
          .catch(() => {})
      }

      const arquivoInput = root.querySelector('#logo-arquivo')
      const btnEscolher = root.querySelector('#btn-escolher')
      const btnRemover = root.querySelector('#btn-remover')
      const previa = root.querySelector('#logo-previa')
      const nomeArquivo = root.querySelector('#logo-nome')
      const dicaLogo = root.querySelector('#logo-dica')
      const erroLogo = root.querySelector('#logo-erro')

      /** Último estado confirmado pelo banco. É o que "Cancelar" restaura. */
      let salvos = null
      /** Logomarca gravada no banco: `{ mime, conteudo }` ou `null`. */
      let logoAtual = null
      /** Arquivo escolhido e ainda não enviado. */
      let pendente = null
      /** Object URL da pré-visualização — precisa ser revogada. */
      let urlPrevia = null
      let falhouLeitura = false
      let salvando = false
      let vivo = true

      const papel = estadoSessao.perfil?.papel
      // Sem o Neon o app roda em demonstração, sem sessão: aí a tela fica
      // editável e o aviso de que nada é gravado aparece no topo.
      const podeEditar = !neonConfigurado || papel === 'admin' || papel === 'manager'

      /* ---------------------------------------------------- avisos ------ */

      function alerta(tom, titulo, texto) {
        const icone =
          tom === 'perigo' ? 'alert-circle' : tom === 'info' ? 'info' : 'alert-triangle'

        return `
          <div class="alert alert--${tom}">
            <i data-lucide="${icone}"></i>
            <div>
              <strong>${esc(titulo)}</strong>
              <p>${esc(texto)}</p>
            </div>
          </div>
        `
      }

      function pintarAvisos() {
        const blocos = []

        if (!neonConfigurado) {
          blocos.push(
            alerta(
              'info',
              'Modo demonstração',
              'O Neon não está configurado, então nada será gravado. Preencha o .env para salvar de verdade.',
            ),
          )
        } else if (falhouLeitura) {
          blocos.push(
            alerta(
              'perigo',
              'Não foi possível ler a configuração',
              'Os campos estão vazios e a gravação está bloqueada para não sobrescrever o que já existe no banco. Recarregue a página para tentar de novo.',
            ),
          )
        } else if (!podeEditar) {
          blocos.push(
            alerta(
              'info',
              'Somente leitura',
              'Você pode consultar os dados da empresa, mas só administradores e gerentes podem alterar. Fale com um administrador.',
            ),
          )
        }

        avisos.innerHTML = blocos.join('')
        renderIcons(avisos)
      }

      /* --------------------------------------------------- permissão ---- */

      function aplicarPermissao() {
        if (podeEditar) return

        form.querySelectorAll('.campo__input').forEach((el) => {
          el.disabled = true
        })

        arquivoInput.disabled = true
        btnEscolher.hidden = true
        btnRemover.hidden = true
        acoes.hidden = true
      }

      /* ------------------------------------------------------ campos ---- */

      function preencher(dados) {
        const valores = { ...PREFERENCIAS_PADRAO, ...(dados ?? {}) }

        form.querySelectorAll('[name]').forEach((el) => {
          el.value = valores[el.name] ?? ''
        })

        arquivoInput.value = ''
      }

      function coletar() {
        const valores = {}
        form.querySelectorAll('[name]').forEach((el) => {
          valores[el.name] = el.value.trim()
        })
        return valores
      }

      function limparErros() {
        form.querySelectorAll('[data-erro]').forEach((el) => {
          el.hidden = true
          el.textContent = ''
        })
        form.querySelectorAll('.campo__input').forEach((el) => el.classList.remove('is-erro'))
        erroGeral.hidden = true
      }

      function mostrarErro(nome, mensagem) {
        const alvo = form.querySelector(`[data-campo="${nome}"]`)
        if (!alvo) return

        const p = alvo.querySelector('[data-erro]')
        p.textContent = mensagem
        p.hidden = false
        alvo.querySelectorAll('.campo__input').forEach((el) => el.classList.add('is-erro'))
      }

      function validar(valores) {
        const erros = []

        if (!valores.nome_fantasia) erros.push(['nome_fantasia', 'Informe o nome fantasia.'])
        if (!valores.razao_social) erros.push(['razao_social', 'Informe a razão social.'])

        if (!valores.cnpj) erros.push(['cnpj', 'Informe o CNPJ.'])
        else if (!cnpjValido(valores.cnpj)) {
          erros.push(['cnpj', 'CNPJ inválido — confira os 14 dígitos.'])
        }

        if (!valores.telefone) erros.push(['telefone', 'Informe o telefone.'])
        else if (!telefoneValido(valores.telefone)) {
          erros.push(['telefone', 'Telefone inválido — use DDD + número.'])
        }

        if (valores.whatsapp && !telefoneValido(valores.whatsapp)) {
          erros.push(['whatsapp', 'WhatsApp inválido — use DDD + número.'])
        }

        if (!valores.email) erros.push(['email', 'Informe o e-mail.'])
        else if (!emailValido(valores.email)) erros.push(['email', 'E-mail inválido.'])

        if (!valores.cep) erros.push(['cep', 'Informe o CEP.'])
        else if (!cepValido(valores.cep)) erros.push(['cep', 'CEP inválido — são 8 dígitos.'])

        if (!valores.uf) erros.push(['uf', 'Selecione o estado.'])
        if (!valores.municipio) erros.push(['municipio', 'Informe o município.'])
        if (!valores.bairro) erros.push(['bairro', 'Informe o bairro.'])
        if (!valores.logradouro) erros.push(['logradouro', 'Informe a rua ou avenida.'])
        if (!valores.numero) erros.push(['numero', 'Informe o número.'])

        return erros
      }

      /* ------------------------------------------------------ máscara --- */

      /**
       * Formata o campo e devolve o cursor para o mesmo ponto (contando
       * dígitos), para não atrapalhar quem edita no meio do número.
       */
      function aplicarMascara(el) {
        const formatar = MASCARAS[el.dataset.mascara]
        if (!formatar) return

        const antes = el.value
        const posicao = el.selectionStart ?? antes.length
        const digitosAntes = apenasDigitos(antes.slice(0, posicao)).length

        const depois = formatar(antes)
        if (depois === antes) return

        el.value = depois

        if (digitosAntes === 0) {
          el.setSelectionRange(0, 0)
          return
        }

        let vistos = 0
        let novaPosicao = depois.length

        for (let i = 0; i < depois.length; i += 1) {
          if (/\d/.test(depois[i])) vistos += 1
          if (vistos === digitosAntes) {
            novaPosicao = i + 1
            break
          }
        }

        el.setSelectionRange(novaPosicao, novaPosicao)
      }

      /* ---------------------------------------------------- logomarca --- */

      function limparPrevia() {
        if (urlPrevia) {
          URL.revokeObjectURL(urlPrevia)
          urlPrevia = null
        }
      }

      function mostrarVazio(icone = 'file-image', texto = 'Sem logomarca') {
        previa.innerHTML = `
          <div class="logo__vazio">
            <i data-lucide="${icone}"></i>
            <span>${esc(texto)}</span>
          </div>
        `
        renderIcons(previa)
      }

      function mostrarImagem(url, alt) {
        previa.innerHTML = `<img class="logo__img" src="${esc(url)}" alt="${esc(alt)}" />`
      }

      async function pintarLogo() {
        if (!vivo) return

        erroLogo.hidden = true
        btnRemover.hidden = !logoAtual

        if (pendente) {
          mostrarImagem(urlPrevia, `Pré-visualização de ${pendente.arquivo.name}`)
          nomeArquivo.textContent = pendente.arquivo.name
          dicaLogo.textContent = 'A imagem será gravada quando você salvar as alterações.'
          btnEscolher.querySelector('span').textContent = 'Substituir imagem'
          return
        }

        btnEscolher.querySelector('span').textContent = logoAtual
          ? 'Substituir imagem'
          : 'Selecionar arquivo'

        if (!logoAtual) {
          limparPrevia()
          mostrarVazio()
          nomeArquivo.textContent = 'Nenhum arquivo selecionado.'
          dicaLogo.textContent = 'A imagem é gravada ao salvar as alterações.'
          return
        }

        nomeArquivo.textContent = `Logomarca atual (${logoAtual.mime.replace('image/', '').toUpperCase()})`
        dicaLogo.textContent = 'Logomarca atual da empresa.'

        const url = urlDaLogo(logoAtual)
        if (url) mostrarImagem(url, 'Logomarca da empresa')
        else mostrarVazio('alert-circle', 'Imagem indisponível')
      }

      /* --------------------------------------------------- carregando --- */

      function definirSalvando(ativo) {
        salvando = ativo
        botaoSalvar.disabled = ativo || falhouLeitura || !podeEditar
        botaoCancelar.disabled = ativo
        botaoSalvar.querySelector('span').textContent = ativo ? 'Salvando...' : 'Salvar alterações'
        if (ativo) erroGeral.hidden = true
      }

      /* ------------------------------------------------------- eventos -- */

      form.addEventListener('input', (evento) => {
        if (evento.target.dataset?.mascara) aplicarMascara(evento.target)
      })

      btnEscolher.addEventListener('click', () => arquivoInput.click())

      arquivoInput.addEventListener('change', async () => {
        const arquivo = arquivoInput.files?.[0]
        if (!arquivo) return

        erroLogo.hidden = true
        const resultado = await validarLogo(arquivo)

        if (!resultado.ok) {
          // Zera o input para que escolher o MESMO arquivo de novo dispare o
          // evento `change` outra vez.
          arquivoInput.value = ''
          erroLogo.textContent = resultado.mensagem
          erroLogo.hidden = false
          return
        }

        limparPrevia()
        urlPrevia = URL.createObjectURL(arquivo)
        pendente = { arquivo, tipo: resultado.tipo, extensao: resultado.extensao }
        await pintarLogo()
      })

      btnRemover.addEventListener('click', async () => {
        const confirmado = await confirmar({
          titulo: 'Remover a logomarca?',
          descricao:
            'A imagem sai do banco e a empresa volta a ficar sem logomarca. Os outros dados não mudam.',
          textoBotao: 'Remover logomarca',
        })

        if (!confirmado) return

        btnRemover.disabled = true
        erroLogo.hidden = true

        // Descartar a escolha pendente faz parte de "remover".
        limparPrevia()
        const tinhaPendente = Boolean(pendente)
        pendente = null
        arquivoInput.value = ''

        try {
          if (!logoAtual) {
            await pintarLogo()
            toast(tinhaPendente ? 'Seleção descartada.' : 'Não havia logomarca gravada.')
            return
          }

          if (!neonConfigurado) {
            await pintarLogo()
            toast('Modo demonstração: nada foi gravado.')
            return
          }

          await removerLogo()
          logoAtual = null

          await pintarLogo()
          window.dispatchEvent(new CustomEvent('logo-mudou'))
          window.dispatchEvent(new CustomEvent('empresa-mudou'))
          toast('Logomarca removida.')
        } catch (erro) {
          console.error('[empresa] Falha ao remover a logomarca:', erro)
          erroLogo.textContent = mensagemDoErro(erro)
          erroLogo.hidden = false
        } finally {
          btnRemover.disabled = false
        }
      })

      botaoCancelar.addEventListener('click', async () => {
        if (salvando) return

        limparErros()
        limparPrevia()
        pendente = null
        arquivoInput.value = ''
        erroLogo.hidden = true
        preencher(salvos)
        await pintarLogo()
        toast('Alterações descartadas.')
      })

      form.addEventListener('submit', async (evento) => {
        evento.preventDefault()
        if (salvando || !podeEditar) return

        limparErros()

        const valores = coletar()
        const erros = validar(valores)

        if (erros.length) {
          erros.forEach(([nome, mensagem]) => mostrarErro(nome, mensagem))
          form.querySelector('.campo__input.is-erro')?.focus()
          return
        }

        if (!neonConfigurado) {
          toast('Modo demonstração: nada foi gravado — o Neon não está configurado.')
          return
        }

        definirSalvando(true)

        try {
          // A logomarca vive numa tabela própria: grava antes da configuração.
          if (pendente) {
            logoAtual = await salvarLogo(pendente.arquivo, pendente.tipo)
          }

          const { dados: salvo, origem } = await salvarEmpresa(valores)

          if (origem !== 'neon') {
            toast('Nada foi gravado: o Neon não está configurado.')
            return
          }

          salvos = salvo
          falhouLeitura = false

          limparPrevia()
          pendente = null
          arquivoInput.value = ''
          preencher(salvo)
          await pintarLogo()
          window.dispatchEvent(new CustomEvent('logo-mudou'))
          window.dispatchEvent(new CustomEvent('empresa-mudou'))
          pintarAvisos()
          toast('Configuração da empresa salva.')
        } catch (erro) {
          console.error('[empresa] Falha ao salvar a configuração:', erro)
          erroGeral.textContent = mensagemDoErro(erro)
          erroGeral.hidden = false
          erroGeral.scrollIntoView({ block: 'nearest' })
        } finally {
          definirSalvando(false)
        }
      })

      /* --------------------------------------------------------- boot --- */

      estado.textContent = podeEditar
        ? 'Os campos marcados com * são obrigatórios.'
        : 'Somente leitura.'

      pintarAvisos()
      aplicarPermissao()
      mostrarVazio()

      async function iniciar() {
        // Modo demonstração: não há o que ler, e não há onde gravar.
        if (!neonConfigurado) {
          preencher(null)
          await pintarLogo()
          definirSalvando(false)
          return
        }

        botaoSalvar.disabled = true

        const { dados, origem } = await carregarEmpresa()
        if (!vivo) return

        if (origem === 'neon') {
          salvos = dados
          preencher(dados)
        } else {
          falhouLeitura = true
          preencher(null)
        }

        // A logomarca vem de uma tabela à parte; falhar aqui não impede editar
        // o resto da configuração.
        const { dados: logo, origem: origemLogo } = await carregarLogo()
        if (!vivo) return
        if (origemLogo === 'neon') logoAtual = logo

        await pintarLogo()
        pintarAvisos()
        definirSalvando(false)
      }

      iniciar()

      return () => {
        vivo = false
        limparPrevia()
        limparUsuarios()
        limparPermissoes()
        limparVendas()
      }
    },
  }
}
