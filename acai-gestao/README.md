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
| `VITE_CADASTRO_PUBLICO` | `false` esconde o link "Criar conta" da tela de login |
| `VITE_CADASTRO_POR_CONVITE` | Com a anterior em `false`, mantém a tela `#/cadastro` acessível por link direto — é assim que o convidado cria a própria conta |
| `DATABASE_URL` | **Segredo**, opcional — conexão Postgres direta para aplicar migrações e rodar `npm run verificar:*`; nunca vai para o navegador |
| `VITE_TESTE_EMAIL` / `VITE_TESTE_SENHA` | Opcional — só para `npm run testar:base` |

Sem `VITE_NEON_URL`, a interface usa os dados de demonstração. Com a URL
configurada, falhas de leitura não são substituídas por exemplos: a tela mostra
um aviso no indicador de dados até uma consulta daquele conjunto funcionar.

### Cadastro de usuários (por convite)

O app não cria contas pelo administrador — quem cria é a própria pessoa, na tela
`#/cadastro`. Por isso o cadastro público fica **aberto no serviço de Auth** e a
opção que o esconde é o par abaixo:

```ini
VITE_CADASTRO_PUBLICO=false   # some o link "Criar conta" do login
VITE_CADASTRO_POR_CONVITE=true # mantém a tela acessível pelo link do convite
```

O fluxo é: administrador → **Usuários → Convidar usuário** → copia o link exibido
e envia para a pessoa. Ao se cadastrar com aquele e-mail, `garantir_perfil()`
aplica o papel e as permissões do convite.

Isso **não** é barreira de segurança: quem descobrir o endereço ainda consegue
criar uma conta. O que protege os dados é o banco — conta sem convite nasce
inativa (`is_active = false`) e o RLS não devolve nada até um administrador
aprovar em **Usuários**. Para fechar de vez seria preciso criar as contas por um
backend (o Data API não tem permissão para isso), o que hoje não existe.

### Conexão direta com o Postgres (`DATABASE_URL`)

O app no navegador **não** usa essa variável: ele fala com o Data API pela
`VITE_NEON_URL` (pública) e o RLS decide o que cada conta vê. `DATABASE_URL`
serve só para os roteiros locais — aplicar migrações e rodar
`npm run verificar:*` — e é **segredo** (o `.env` já está no `.gitignore`).

1. No Console do Neon, selecione o projeto e a branch e clique em **Connect**.
2. Desmarque **Connection pooling** e copie a string que começa com
   `postgresql://`. Para migração use o host **direto** (sem `-pooler`): o
   `aplicar.mjs` roda DDL e transações por arquivo, que não combinam com o
   pooler em modo transação.
3. Cole no `acai-gestao/.env`:

   ```dotenv
   DATABASE_URL=postgresql://usuario:senha@ep-xxx.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

   Se a senha tiver `@`, `:`, `/`, `#` ou espaço, use a versão já codificada que
   o Console mostra (ou codifique com `encodeURIComponent`).
4. Confira a conexão sem gravar nada — o `verificar:vendas` abre uma transação,
   testa e termina em `ROLLBACK`:

   ```powershell
   npm run verificar:vendas
   ```

5. Aplique a migração pendente e atualize o cache do Data API:

   ```powershell
   node neon/aplicar.mjs 29
   npx neon data-api refresh-schema --database neondb
   ```

   Sem o CLI, use **Postgres database → Data API → Refresh schema cache** no
   Console. O `garantir_perfil_novo.sql` é passo manual: cole o conteúdo em
   **SQL Editor** (ou rode com `psql -f`), porque ele não é uma migração `NN_*`.

Nunca comite o `.env` nem cole a string em issue/chat. Se ela vazar, troque a
senha do papel no Console (**Roles → Reset password**); a `VITE_NEON_URL` pode
continuar a mesma.

### Branches do projeto no Neon

O projeto `Prime Açaí` (`nameless-tooth-87377816`, região `aws-sa-east-1`) usa
as branches abaixo. Trocar de branch é trocar o host na `DATABASE_URL`; a
`VITE_NEON_URL` continua apontando para `production`.

| Branch | Endpoint | Uso |
|---|---|---|
| `production` (padrão) | `ep-fragrant-snow-b6xa862f` | base real do app |
| `prime-acai-predeploy-20261028` | `ep-plain-lake-b66do9gp` | ensaio de migração antes de produção |
| `backup-antes-27-20261028` | sem endpoint | ponto de restauração anterior à migração 27 |
| `backup-riscos-20261028` | sem endpoint | cópia verificada anterior às migrações 29, 31 e 32 |
| `teste-migracao-32-20261028` | endpoint temporário | ensaio das migrações 29, 31 e 32; pode ser descartada |

Crie o branch de ensaio a partir de `production` (`npx neon branches create --name <nome>`),
aplique a migração nele, valide com `compare_database_schema` e só então repita em
produção. Branch de ensaio defasado dá falso positivo: em 28/10/2026 o anterior
estava quatro migrações atrás e foi recriado do zero. O backup
`backup-riscos-20261028` foi aberto e conferido (8.539 vendas, 12.803 itens e
9 clientes) antes da aplicação em produção.

### RLS sem política é intencional

Cinco tabelas têm RLS ligado e nenhuma política: `audit_logs`, `invites`,
`invite_permissions`, `user_permissions` e `estoque_operacoes_locais_v2`. Isso é
proposital — elas são lidas e escritas apenas por RPCs `security definer`
(`listar_auditoria`, `convidar_usuario`, `cancelar_convite`,
`definir_permissao_usuario`, `permissoes_do_usuario`, `pode`,
`registrar_movimentacao_local_v2`, entre outras). Sem política, o Data API nega
acesso direto e a única porta é a função que valida sessão e permissão. Não
adicione política de `select` nessas tabelas sem revisar essas RPCs.

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

**Aprovação de contas:** a configuração usa `aprovacaoManual: true`. Quem se
cadastra sem convite nasce inativo (`garantir_perfil_novo.sql`) e aguarda a
decisão de um administrador em **Usuários**; um convite válido já define papel e
ativação. O app encerra a sessão da conta inativa e explica o motivo em vez de
deixá-la navegando. Para abrir o cadastro com acesso imediato, é preciso mudar os
dois lados juntos (configuração e função do banco).

### Multi-organização

A migração `29_multi_organizacao.sql` coloca `organization_id` em `vendas`,
`itens_venda`, `clientes` e `lancamentos` e troca as políticas por permissão +
organização. Linhas antigas são vinculadas à organização mais antiga; linhas novas
recebem a organização da sessão por trigger. A venda (RPC `security definer`)
também recusa cliente/produto/recipiente de outra organização. A migração `29`
remove as políticas antigas `usuario_*` (que tinham `qual = true`) e não deixa
política permissiva anular o isolamento.

A migração `32_codigos_idempotencia_por_organizacao.sql` fecha as três chaves
globais restantes: `vendas.codigo`, `clientes.codigo` e
`vendas.chave_idempotencia` passam a ser únicos **dentro da organização**. O
contador interno (`private.organization_counters`) reserva códigos de venda e de
cliente de forma atômica, e a RPC `registrar_venda()` procura a chave de
idempotência apenas na organização da sessão. Assim, duas lojas podem ter o
pedido `#1` e o cliente `C-0001` sem uma enxergar a venda da outra.

As migrações 29, 30, 31 e 32 estão aplicadas em `production` desde 28/10/2026,
depois de a branch `backup-riscos-20261028` ser aberta e conferida. Para aplicar
em outro banco, valide a cadeia e use backup verificado:

```bash
node neon/aplicar.mjs 29
node neon/aplicar.mjs 31
node neon/aplicar.mjs 32
npx neon data-api refresh-schema
```

O diagnóstico somente leitura de RLS, privilégios e chaves compostas é
`neon/diagnostico_seguranca.sql`.


## Banco de dados

O banco é criado por **um arquivo só**: `neon/00_banco_neon.sql`
(tabelas, índices, funções, views, GRANTs, RLS e os dados de exemplo).
Depois dele, cada mudança veio numa migração numerada (`neon/01_…` até
`neon/32_…`; a `12` é dados de estudo e não entra na aplicação padrão, a `16`
é Compras, a `17` aplica permissões de clientes/financeiro, a `18` acrescenta
canais e pagamentos, a `19` habilita fotos persistentes de produtos, a `20` cria
o catálogo de categorias, a `21` categoriza os tipos de venda, as `22`–`25`
tratam locais, baixas por produto, operações do Estoque Buffet e reconciliação
por turno, a `26`/`28` reservam códigos sequenciais de produto/cliente, a `29`
aplica o isolamento por organização, a `30` indexa as chaves estrangeiras
simples, a `31` versiona a RPC de permissões por perfil e os dois índices de
chave estrangeira compostos que faltavam e a `32` torna códigos e idempotência
únicos por organização). A aplicação é por prefixo, **um arquivo por vez**:

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
verificada. A migração `27` foi aplicada ao projeto Prime Açaí em 28/10/2026, em
`production` e no branch de ensaio `prime-acai-predeploy-20261028`, a partir do
backup `backup-antes-27-20261028`. Ela continua **não** sendo aplicada
automaticamente por nenhum script de deploy: a aplicação é sempre manual e
escopada por banco.

Sem produto `buffet`/`insumo` o fechamento abre sem item nenhum. A classificação
não vem da migração `27` (ela não classifica nada de propósito): em 28/10/2026
foi aplicada como **passo manual**, `neon/classificar_produtos_buffet.sql`, com
reversão em `neon/classificar_produtos_buffet_reverter.sql`. Todo produto novo
de buffet ou insumo precisa ser classificado na tela de produtos, e o retorno só
é aceito pela constraint quando o tipo é `buffet` ou `insumo`.

A migração `30` criou os 25 índices que faltavam nas colunas de chave estrangeira
simples (`vendas.usuario_id`, `movimentacoes_estoque.usuario_id`,
`venda_detalhes.forma_pagamento_id`, etc.). Sem eles, apagar ou atualizar a linha
pai percorria a tabela filha inteira.

A migração `31` fecha as duas lacunas que sobraram na auditoria de 28/10/2026:

- versiona `public.definir_permissao_perfil(text, text, text, boolean)`, que já
  existia em produção mas não em nenhuma migração — um banco criado do zero pela
  cadeia `neon/*.sql` tinha a tela **Configurações → Permissões** quebrada. A
  função exige administrador, recusa alterar o perfil `admin`, valida perfil e
  permissão contra o catálogo e grava a mudança em `audit_logs`;
- cria os índices das duas FKs compostas restantes
  (`tipos_venda (organization_id, categoria)` e
  `movimentacoes_estoque (organization_id, produto_id)`).

Ela é idempotente e tem reversão em
`neon/reverter_31_permissoes_perfil_e_indices_compostos.sql`. Foi aplicada em
`production` em 28/10/2026 junto com a 29 e a 32, após backup verificado.

A migração `32` troca as unicidades globais de código de venda, código de cliente
e chave de idempotência por índices compostos com `organization_id`. A reserva
de códigos usa um contador no schema `private`, fora do Data API, e a RPC
`registrar_venda()` passou a filtrar cliente, produto, recipiente e chave de
idempotência pela organização da sessão. A reversão está em
`neon/reverter_32_codigos_idempotencia_por_organizacao.sql` e recusa rodar se
houver códigos/chaves repetidos entre organizações. Ela também remove as
políticas antigas `usuario_clientes`/`usuario_lancamentos` quando a produção
pulou a migração 17.

### Dados de demonstração em produção

A auditoria de 28/10/2026 encontrou **8.537 vendas de seed** na branch
`production`, datadas de 17/05/2026 a 19/10/2026, misturadas a apenas duas vendas
reais posteriores. Os totais das vendas de seed não fecham com a soma dos itens
de propósito; isso **não** é bug de cálculo do app. O impacto é de relatório:
outubro/2026 aparecia com cerca de R$ 58,5 mil de faturamento fictício.

Não apague nada por data sem revisar. Use, nesta ordem:

1. `neon/diagnostico_dados_demonstracao.sql` — **somente leitura**, mostra vendas
   por período, divergências de total, produtos/clientes antigos, integridade do
   estoque e tabelas com RLS sem política;
2. criar uma branch/backup do Neon e confirmar que ela abre;
3. `neon/limpar_dados_demonstracao.sql` — limpeza **guardada**, exige
   `acai.organization_id`, `acai.limpar_ate` e `acai.confirmar = 'SIM'`, roda em
   transação, recusa corte que não preserve nenhuma venda real, desliga os dois
   triggers de manutenção só dentro da transação, repõe o saldo dos cinco
   movimentos ligados a vendas de seed e confere o resultado antes do `COMMIT`.
   O script foi simulado na branch `teste-migracao-32-20261028` com rollback:
   apagaria 8.537 vendas e 12.801 itens, preservaria as duas vendas reais
   (`#9543`/`#9544`) e religaria os triggers.

O script de limpeza **não** é executado por `npm run validar:migracoes` nem por
deploy. Ele precisa de autorização explícita e de um corte conferido no
diagnóstico. **A limpeza ainda não foi executada em produção.**

## Testes

```bash
npm test                  # unitários (Vitest + jsdom), sem tocar no banco
npm run validar:migracoes # a cadeia de migrações num Postgres em memória
```

O pacote compartilhado tem a própria suíte (Node, sem dependências externas):

```bash
cd ../Login_projetos
npm test
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
