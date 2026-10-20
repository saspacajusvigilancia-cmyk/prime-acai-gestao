# Login_projetos

Módulo de **login, cadastro, recuperação e redefinição de senha** para SPAs em
JavaScript puro (Vite), sobre **Neon Auth** (Managed Better Auth) + **Data API**.

Foi extraído do projeto **Prime Açaí – Gestão** e generalizado para ser
reaproveitado em outros projetos: nada de marca, rota ou texto está fixo — tudo
vem de `configurarLogin({...})`.

> **Segurança em primeiro lugar.** Senha nenhuma passa pelo código: quem guarda
> o hash é o serviço de autenticação. E quem autoriza de verdade é o **RLS no
> banco** — as telas só mostram e escondem.

---

## O que vem pronto

| Peça | Arquivo |
| --- | --- |
| Tela de login | `src/pages/login.js` |
| Tela de cadastro | `src/pages/cadastro.js` |
| "Esqueci minha senha" | `src/pages/recuperar-senha.js` |
| Nova senha (pelo link do e-mail) | `src/pages/redefinir-senha.js` |
| Serviço de autenticação (sessão, entrar, sair, perfil) | `src/services/auth.js` |
| Regras puras (senha, e-mail, mensagens) | `src/validacao.js` |
| Cliente Neon | `src/lib/neon.js` |
| Estado de sessão | `src/sessao.js` |
| Configuração central | `src/config.js` |
| CSS das telas | `src/styles/auth.css` |
| Schema do banco (perfis + RLS) | `sql/00_profiles.sql` |
| Criação do perfil ao entrar | `sql/01_garantir_perfil.sql` |
| Passo a passo de integração | `docs/INTEGRACAO.md` |
| Exemplo de host completo | `exemplos/main.exemplo.js` |
| Testes (sem dependências) | `tests/` |

---

## Começar rápido

```bash
npm install                 # dependências do próprio módulo (só para testar)
npm test                    # 29 testes
```

Para usar num projeto novo, siga **[`docs/INTEGRACAO.md`](docs/INTEGRACAO.md)**.
O resumo:

```js
import 'login-projetos/estilo.css'
import { configurarLogin, telasAuth, sessaoAtual, estadoSessao } from 'login-projetos'

configurarLogin({ marca: { nome: 'Minha Empresa' } })

const rotas = { ...telasAuth(), '/': minhaHome }
```

E no `.env` do projeto:

```ini
VITE_NEON_URL=https://ep-xxxxx.c-2.us-east-2.aws.neon.tech/neondb
VITE_CADASTRO_PUBLICO=true
```

---

## Configuração (`configurarLogin`)

Tudo opcional; o que não for passado fica no padrão de `src/config.js`.

```js
configurarLogin({
  marca: {
    nome, assinatura, icone, chamada, descricao, pontos
  },
  rotas: { login, cadastro, recuperar, redefinir, depoisDoLogin },
  cadastroPublico,       // liga/desliga a tela de cadastro
  senhaMinima,           // tamanho mínimo de senha
  papeis,                // { admin, manager, cashier } → rótulos
  aprovacaoManual,       // cadastro depende de aprovação?
  rpcPerfil,             // função que cria o perfil (padrão: garantir_perfil)
  tabelaPerfis,          // tabela de perfis (padrão: profiles)
  textos,                // textos das telas, com {marca} e {papel}
})
```

A mesclagem é em profundidade e no **mesmo objeto** — trocar `marca.nome` mantém
todo o resto no padrão.

---

## API principal

```js
// sessão
sessaoAtual()            // { usuario, perfil } | null
observarAuth(cb)         // avisa quando a sessão muda
sair()
estadoSessao, logado(), avisarSessao()

// ações
entrar({ email, senha })
criarConta({ nome, email, senha })
enviarLinkDeRecuperacao(email)
definirNovaSenha(senha, token)
tokenDeRecuperacao()
carregarPerfil(id), garantirPerfil(), atualizarNome(nome)

// regras e mensagens (puras)
checarSenha, senhaForte, emailValido, mensagemDeErro, rotuloPapel

// telas e utilidades
telasAuth(), ehRotaAuth(rota)
telaDeEspera(), carregarFonteAuth(), renderIcons(root), esc(valor)
```

---

## Requisitos

- Node 20+ (para os testes, usa o `node:test` embutido).
- No app: `@neondatabase/neon-js` e `lucide` (peerDependencies).
- No Neon: Data API habilitado **com "Use Neon Auth"**, e o domínio do app
  autorizado em **Auth → Domains**.

---

## Testes

```bash
npm test
```

- `tests/config.test.mjs` — configuração e interpolação de textos.
- `tests/validacao.test.mjs` — senha, e-mail, rótulos e tradução de erros.
- `tests/sessao.test.mjs` — estado de sessão e escape de HTML.
- `tests/layout.test.mjs` — monta o HTML das telas e confere a marca
  configurada (precisa do `lucide`; é pulado sem ele).

---

## Notas

- Os nomes de rota, marca e textos vêm todos da configuração: o módulo não
  contém nenhuma referência ao projeto de origem.
- O CSS é autocontido (`.auth` + variáveis `--a-*`): não depende do tema do app.
- O fluxo de **aprovação de contas** e o painel de administração **não** fazem
  parte deste módulo — ele cuida só da autenticação. `sql/01_garantir_perfil.sql`
  mostra como criar contas pendentes.
