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
| `VITE_APP_URL` | Opcional; origem pública para os links de recuperação de senha |
| `VITE_CADASTRO_PUBLICO` | `false` esconde o "Criar conta" — só um administrador cria contas |
| `DATABASE_URL` | Opcional — conexão direta para os roteiros `npm run verificar:*` |
| `VITE_TESTE_EMAIL` / `VITE_TESTE_SENHA` | Opcional — só para `npm run testar:base` |

Sem `VITE_NEON_URL`, a interface usa os dados de demonstração. Com a URL
configurada, falhas de leitura não são substituídas por exemplos: a tela mostra
um aviso no indicador de dados até uma consulta daquele conjunto funcionar.

### Prévia com dados fictícios das novas telas

Para gerar uma prévia isolada com registros de teste em produtos, categorias,
tipos de venda, formas de pagamento e movimentações entre estoque geral e loja,
faça o build sem Neon e ative explicitamente `VITE_DADOS_TESTE`:

```powershell
if (-not (Test-Path .env.demo)) { Copy-Item demo.env.example .env.demo }
$env:VITE_DADOS_TESTE = 'true'
npx vite build --mode demo
npx wrangler pages deploy dist --project-name=prime-acai-gestao --branch=dados-teste
Remove-Item Env:VITE_DADOS_TESTE -ErrorAction SilentlyContinue
```

Confirme que `.env.demo` tem `VITE_NEON_URL=` vazio antes do build. O modo é
ignorado se houver cliente Neon configurado. Os registros são somente em
memória, identificados com `TESTE` e nunca são enviados ao banco. Não publique
esse build como produção.

## Autenticação

As telas, o serviço de autenticação e o estado da sessão são compartilhados
pelo pacote local [`Login_projetos`](../Login_projetos/README.md), configurado
em [`src/login-config.js`](./src/login-config.js). O app usa **Neon Auth +
Neon Data API**; não usa Supabase Auth. O pacote não foi publicado: a aplicação
consome a dependência local `file:../Login_projetos`.

O módulo fornece login, cadastro, recuperação/redefinição de senha, observação
da sessão e um guarda de rotas de conveniência. A autorização real continua no
Postgres: RLS e funções do banco validam acesso e permissões; o frontend apenas
esconde telas e redireciona. Consulte
[`Login_projetos/docs/INTEGRACAO.md`](../Login_projetos/docs/INTEGRACAO.md)
para instalar em outro app, configurar identidade/rotas/funcionalidades e
implementar um adaptador de provedor. Não use chaves administrativas no
frontend.

## Banco de dados

O banco é criado por **um arquivo só**: `neon/00_banco_neon.sql`
(tabelas, índices, funções, views, GRANTs, RLS e os dados de exemplo).
Depois dele, cada mudança veio numa migração numerada (`neon/01_…` até
`neon/27_…`; a `12` é dados de estudo e não entra na aplicação padrão, a `16`
é Compras, a `17` aplica permissões de clientes/financeiro, a `18` acrescenta
canais e pagamentos, a `19` habilita fotos persistentes de produtos e a `20`
cria o catálogo de categorias. As migrações `22`–`25` tratam locais, baixas por
produto, operações do Estoque Buffet e reconciliação por turno), aplicada por
prefixo, **um arquivo por vez**:

```bash
node neon/aplicar.mjs 11     # só a que começa com "11"
```

Só aplique os dados de estudo da `12` com seleção explícita e após conferir o
banco-alvo: `node neon/aplicar.mjs 12`. O aplicador também aceita reversões
explicitamente selecionadas, por exemplo `node neon/aplicar.mjs reverter_04`.

Toda migração que mexe em estrutura tem o `reverter_…` correspondente (o nome
não casa com o filtro do `aplicar.mjs` de propósito). O passo a passo — incluindo
a ordem de duas fases da venda — está em `neon/README.md`.

### Estoque Buffet e locais

O ledger existente é a fonte única dos saldos. O recebimento de compras permite
definir o destino por item; transferências e contagens são confirmadas por RPC
com validação de filial e permissão. A tela **Estoque Buffet** oferece
abastecimento do Estoque Normal/Geral, perdas auditáveis, retorno apenas para
produtos explicitamente autorizados, histórico filtrável e fechamento por
turno com snapshot e reconciliação de consumo/divergência. Fechamentos,
movimentos e auditoria não são apagados. O custo histórico não é estimado,
pois o sistema ainda não mantém snapshot de custo por fechamento.

Preparação e Produção permanecem inativos até configuração explícita. Antes de
aplicar a migração `27`, valide a cadeia com `npm run validar:migracoes`,
confirme a organização de destino e tenha um backup cuja restauração foi
verificada. A migração `27` não foi aplicada automaticamente a uma base real.

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

## Valores monetários

Os campos de dinheiro usam uma única entrada monetária compartilhada: digite
`69,90` para R$ 69,90 ou `1.250,90` para R$ 1.250,90. O ponto é separador de
milhares; um ponto isolado seguido de uma ou duas casas também é aceito para
teclados numéricos. `6990` representa R$ 6.990,00, não R$ 69,90. O símbolo
`R$` é visual e não precisa ser digitado. Durante a digitação, o agrupamento
de milhares é atualizado sem alterar a convenção decimal ou deslocar o cursor;
ao sair do campo, a exibição é normalizada para duas casas decimais.

Os cálculos de vendas, troco, taxas e compras usam centavos inteiros, com
arredondamento comercial (meio centavo para longe de zero). Pesos e quantidades
mantêm sua precisão e são arredondados somente ao converter o total para
centavos. O Postgres já usa `NUMERIC/DECIMAL` exato nos valores monetários, por
isso esta padronização não exige migração nem altera dados existentes. O custo
unitário das compras permanece `NUMERIC(14,4)` para preservar o cálculo de custo
médio; sua exibição monetária continua com duas casas.

Atualmente cada venda registra uma única forma de pagamento. A opção “Misto”
não armazena parcelas por forma, portanto pagamentos divididos não podem ser
reconciliados individualmente. Também não existe um módulo de fechamento de
caixa financeiro; não se deve interpretar os lançamentos atuais como uma
reconciliação de caixa ou de pagamentos divididos.

## Produtos, fotos e categorias

O catálogo de Produtos fica antes de Vendas no grupo Operação; categorias são
administradas em Configurações > Vendas > Categorias. A migração
`20_categorias_produtos.sql` cria categorias isoladas por organização, importa
os nomes já usados no catálogo e mantém o campo textual dos produtos para não
quebrar estoque, compras ou PDV. Categorias inativas continuam válidas nos
produtos existentes, mas não são oferecidas em novos cadastros.

Fotos são armazenadas como binário no Postgres (até 512 KiB por arquivo) pela
migração `19_imagens_produtos.sql`; o PDV carrega a foto apenas quando um item
é selecionado. Para habilitar as duas funções em um banco já existente, aplique
as migrações 19 e 20 depois de conferir o destino:

```bash
node neon/aplicar.mjs 19
node neon/aplicar.mjs 20
```

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

O script faz `npm run build` e publica explicitamente na branch `main`, que
atualiza o ambiente de produção. Para publicar apenas um preview de outra branch,
use `wrangler pages deploy dist --project-name=prime-acai-gestao --branch=NOME-DA-BRANCH`.

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
Para preparar a conta administrativa inicial `saspacajusvigilancia@gmail.com`,
crie a conta no app, entre uma vez e execute
[`neon/promover-administrador-inicial.sql`](./neon/promover-administrador-inicial.sql)
no SQL Editor do Neon. O script não é executado automaticamente.
