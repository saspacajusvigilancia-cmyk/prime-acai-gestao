# Prime Açaí · Gestão

App web (SPA) para gestão da loja: dashboard, produtos, clientes, vendas,
lançamentos, financeiro, estoque e configurações da empresa.

O backend é o **Neon**: Postgres + **Neon Data API** (REST) + **Neon Auth**
(login/cadastro), e a **logomarca** fica guardada no próprio Postgres (não há
Storage no Neon).

## Requisitos

- Node.js instalado (neste computador: `C:\Program Files\nodejs`)

## Rodar localmente

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173` (ou na próxima porta livre).

## Configuração (`.env`)

Copie `.env.example` para `.env` e preencha:

| Variável | Para que serve |
|---|---|
| `VITE_NEON_URL` | URL HTTPS do Neon (host + database). Sem ela, o app roda em modo demonstração (dados de exemplo) |
| `VITE_CADASTRO_PUBLICO` | `false` esconde o "Criar conta" — só um administrador cria contas |
| `DATABASE_URL` | Opcional — conexão direta para os roteiros `npm run verificar:*` |
| `VITE_TESTE_EMAIL` / `VITE_TESTE_SENHA` | Opcional — só para `npm run testar:base` |

Sem `VITE_NEON_URL`, a interface usa os dados de demonstração. Com a URL
configurada, falhas de leitura não são substituídas por exemplos: a tela mostra
um aviso no indicador de dados até uma consulta daquele conjunto funcionar.

## Banco de dados

O banco é criado por **um arquivo só**: `neon/00_banco_neon.sql`
(tabelas, índices, funções, views, GRANTs, RLS e os dados de exemplo).
Depois dele, cada mudança veio numa migração numerada (`neon/01_…` até
`neon/18_…`; a `12` é dados de estudo, a `16` é Compras e Entradas, a `17`
aplica permissões de clientes/financeiro e a `18` acrescenta canais e pagamentos),
aplicada por prefixo, **um arquivo por vez**:

```bash
node neon/aplicar.mjs 11     # só a que começa com "11"
```

Toda migração que mexe em estrutura tem o `reverter_…` correspondente (o nome
não casa com o filtro do `aplicar.mjs` de propósito). O passo a passo — incluindo
a ordem de duas fases da venda — está em `neon/README.md`.

## Testes

```bash
npm test                  # unitários (Vitest + jsdom), sem tocar no banco
npm run validar:migracoes # a cadeia de migrações num Postgres em memória
```

## Testar a base real

```bash
npm run testar:base        # leitura e escrita pela API, como o navegador faz
npm run verificar:estoque  # livro-razão do estoque (só leitura)
npm run verificar:compras  # compra total/parcial, custo médio e duplicidade (tudo desfeito no fim)
npm run verificar:vendas   # venda transacional + estorno (tudo desfeito no fim)
```

Os `verificar:*` falam direto com o Postgres (precisam do `DATABASE_URL`) e **não
deixam rastro**: o que escrevem termina em `ROLLBACK`.

## Tipos de venda e pagamentos

Em Configurações > Vendas, os cadastros podem ser pesquisados, editados e
ativados/inativados. Os valores padrão são criados por organização na migração
`18_canais_pagamentos_vendas.sql`. Registros usados permanecem ligados ao
histórico e não são excluídos. Dados de delivery e aplicativo são informativos:
não existe confirmação automática de pagamento nem integração externa.

## Build de produção

```bash
npm run build
```

Gera a pasta `dist/`. Como o roteador é por `#` (hash), a `dist/` funciona em
**qualquer** hospedagem estática, **sem configuração de servidor**.

## Publicar (deploy)

**Já está publicado no Cloudflare Pages:** <https://prime-acai-gestao.pages.dev>
(projeto `prime-acai-gestao`). Para republicar após mudar o código:

```bash
$env:CLOUDFLARE_API_TOKEN = '<seu token>'      # permissão "Cloudflare Pages: Editar"
$env:CLOUDFLARE_ACCOUNT_ID = 'cfed5f08224d3a6d0f9d547c81b67a5d'
npm run deploy:cloudflare
```

O script faz `npm run build` e `wrangler pages deploy dist`.

> O arquivo `public/_redirects` garante o fallback de SPA no Cloudflare Pages.
> O guia completo está em `MIGRAR-CLOUDFLARE.md`.

### Deploy automático pelo GitHub Actions

O workflow `Validate` executa testes, valida as migrações e o build em cada
push para `main`. Depois da validação, também pode publicar no Cloudflare Pages.
Para habilitar esse deploy automático, configure no repositório GitHub:

- **Actions secret** `CLOUDFLARE_API_TOKEN`, com permissão de editar Pages na
  conta Cloudflare.
- **Actions variable** `CLOUDFLARE_ACCOUNT_ID`, com o identificador da conta.
- **Actions variable** `VITE_NEON_URL`, com a URL pública HTTPS do Neon usada
  pelo frontend.

Sem o secret, a validação continua normalmente e o passo de deploy é ignorado
com um aviso; nenhum token é armazenado no código. Até esse secret ser criado,
publique manualmente com `npm run deploy:cloudflare`.

### Autorizar o domínio no Neon Auth

O login só funciona se a origem estiver autorizada (senão o Neon Auth rejeita a
requisição). O domínio vai **com o esquema** `https://`:

```bash
npx neon@latest neon-auth domain add https://SEU-DOMINIO \
  --project-id nameless-tooth-87377816 --branch production
```

Domínios já autorizados: `https://prime-acai-gestao.pages.dev`.

Por fim, abra o site publicado e teste o login com a sua conta de administrador.
