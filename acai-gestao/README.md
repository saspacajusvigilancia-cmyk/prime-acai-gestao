# Prime Açaí · Gestão

App web (SPA) para gestão da loja: dashboard, produtos, clientes, vendas,
lançamentos, financeiro, estoque, configurações da empresa e cadastro de filiais.

O backend usa Postgres com Data API e autenticação do provedor; a **logomarca**
fica guardada no próprio Postgres (não há Storage no banco).

## Requisitos

- Node.js instalado (neste computador: `C:\Program Files\nodejs`)

## Rodar localmente

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173` (ou na próxima porta livre).

O modo padrão (`npm run dev`) conecta à branch Neon de desenvolvimento
autorizada; sem essa configuração o comando falha antes de iniciar, em vez de
abrir dados de demonstração ou apontar para produção. Para abrir a demonstração
local explicitamente, use `npm run dev:demo`; seus dados ficam somente em
memória e operações críticas não são apresentadas como persistidas.

## Configuração (`.env`)

O ambiente local conectado usa `.env.development.local`, ignorado pelo Git.
Obtenha as variáveis Neon somente da branch de desenvolvimento aprovada:

```powershell
neon env pull --project-id solitary-bonus-43107617 --branch br-autumn-dream-b65h5n3g --file .env.development.local --service postgres --service auth --service data-api
```

Nesse arquivo, mapeie `NEON_AUTH_BASE_URL` para `VITE_NEON_AUTH_URL` e
`NEON_DATA_API_URL` para `VITE_NEON_DATA_API_URL`, deixe `VITE_NEON_URL` vazio e
inclua os identificadores `NEON_DEV_PROJECT_ID`, `NEON_DEV_BRANCH_ID` e
`NEON_DEV_ENDPOINT_ID` do ambiente autorizado. Para este workspace, o arquivo
já foi configurado localmente; não copie variáveis da produção.

| Variável | Para que serve |
|---|---|
| `VITE_NEON_AUTH_URL` | URL pública HTTPS do Neon Auth |
| `VITE_NEON_DATA_API_URL` | URL pública HTTPS da Data API |
| `VITE_NEON_URL` | Compatibilidade legada em ambientes de teste; deve ficar vazia no modo local conectado |
| `VITE_APP_URL` | Opcional; origem pública para os links de recuperação de senha |
| `VITE_CADASTRO_PUBLICO` | `false` esconde o link "Criar conta" da tela de login |
| `VITE_CADASTRO_POR_CONVITE` | Com a anterior em `false`, mantém a tela `#/cadastro` acessível por link direto |
| `DATABASE_URL` | Conexão PostgreSQL pooled; **segredo**, nunca vai para o navegador |
| `DATABASE_URL_UNPOOLED` | Conexão PostgreSQL direta com `sslmode=verify-full`, usada nas migrações |
| `VITE_TESTE_EMAIL` / `VITE_TESTE_SENHA` | Opcional — identidade de teste exclusiva para `npm run testar:base` |
| `NEON_DEV_PROJECT_ID` | Identificador público do projeto local autorizado |
| `NEON_DEV_BRANCH_ID` / `NEON_DEV_ENDPOINT_ID` | Identificadores públicos da branch e endpoint locais autorizados |
| `NEON_TEST_DATASET` | Deve ser `synthetic` apenas em homologação sintética |

O Vite publica somente as URLs públicas de Auth e Data API e a lista explícita
de configurações de `vite.config.js`. `VITE_TESTE_EMAIL` e `VITE_TESTE_SENHA`
são exclusivos dos scripts Node; nunca os inclua na allowlist do navegador.

`npm run db:migrate` aplica, por transação, somente migrations ainda não
registradas na branch local, mantendo histórico e checksum. Exclui a migration
de estudo 12 e não carrega dados fictícios da migration 00. `npm run db:check`
verifica histórico, checksum, RLS e isolamento por filial. Use `npm run dev:demo`
para abrir explicitamente a demonstração local em memória.

Para homologação remota, configure `.env.test` com uma branch sintética aprovada
e use `npm run dev:teste`. O Vite e os scripts remotos bloqueiam produção e
exigem IDs explícitos. `npm test` também recusa quando as URLs efetivas apontam
à produção; para rodar somente testes locais, mantenha as URLs Neon e
`DATABASE_URL` vazias em `.env.test.local` (gitignored).

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
`VITE_NEON_DATA_API_URL` (pública) e o RLS decide o que cada conta vê.
`DATABASE_URL` e `DATABASE_URL_UNPOOLED` servem só para os roteiros locais;
ambas são **segredos** e estão em arquivos ignorados pelo Git.

1. No console do banco, selecione o projeto e a branch e clique em **Connect**.
2. Desmarque **Connection pooling** e copie a string que começa com
   `postgresql://`. Para migração use o host **direto** (sem `-pooler`): o
   `aplicar.mjs` roda DDL e transações por arquivo, que não combinam com o
   pooler em modo transação.
3. Use a URL direta, sem `-pooler`, com validação completa do certificado TLS
   (`sslmode=verify-full`) em `DATABASE_URL_UNPOOLED`:

   ```dotenv
   DATABASE_URL=postgresql://usuario:senha@ep-xxx.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

   Se a senha tiver `@`, `:`, `/`, `#` ou espaço, use a versão já codificada que
   o Console mostra (ou codifique com `encodeURIComponent`).
4. No ambiente local de desenvolvimento, valide e aplique com os comandos
   versionados:

   ```powershell
   npm run db:check
   npm run db:migrate
   npm run db:check
   ```

5. Após aplicar migrations ou mudar o schema, atualize o cache do Data API
   explicitamente para a mesma branch:

   ```powershell
   neon data-api refresh-schema --project-id solitary-bonus-43107617 --branch br-autumn-dream-b65h5n3g --database neondb
   ```

   Sem o CLI, use **Postgres database → Data API → Refresh schema cache** no
   Console. O `garantir_perfil_novo.sql` é aplicado e registrado pelo comando
   `npm run db:migrate`.

Nunca comite o `.env` nem cole a string em issue/chat. Se ela vazar, troque a
senha do papel no Console (**Roles → Reset password**); a `VITE_NEON_URL` pode
continuar a mesma.

### Branches do projeto

O projeto `Prime Açaí` (`nameless-tooth-87377816`, região `aws-sa-east-1`) tem
as branches abaixo registradas historicamente:

| Branch | Endpoint | Uso |
|---|---|---|
| `production` (padrão) | `ep-fragrant-snow-b6xa862f` | base real do app |
| `prime-acai-predeploy-20261028` | `ep-plain-lake-b66do9gp` | ensaio histórico; não usar sem nova validação |
| `backup-antes-27-20261028` | sem endpoint | ponto de restauração anterior à migração 27 |
| `backup-riscos-20261028` | sem endpoint | cópia verificada anterior às migrações 29, 31 e 32 |

Uma consulta de metadados em 02/11/2026 identificou `production` como branch
padrão; os ramos `deploy-validation-20261031` e
`prime-acai-predeploy-20261028` têm `production` como pai. Não foi feita conexão
ao banco. Como uma branch derivada pode conter dados reais da origem, nenhum
desses ramos foi considerado sintético ou autorizado para homologação.
Não crie uma branch de teste a partir de produção sem sanitização e aprovação.
O backup
`backup-riscos-20261028` foi aberto e conferido (8.539 vendas, 12.803 itens e
9 clientes) antes da aplicação em produção. A branch temporária
`teste-migracao-32-20261028` foi usada no ensaio e excluída depois da limpeza.

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
faça o build sem banco configurado e ative explicitamente `VITE_DADOS_TESTE`:

```powershell
if (-not (Test-Path .env.demo)) { Copy-Item demo.env.example .env.demo }
$env:VITE_DADOS_TESTE = 'true'
npx vite build --mode demo
npx wrangler pages deploy dist --project-name=prime-acai-gestao --branch=dados-teste
Remove-Item Env:VITE_DADOS_TESTE -ErrorAction SilentlyContinue
```

Confirme que `.env.demo` tem `VITE_NEON_URL=` vazio antes do build. O modo é
ignorado se houver cliente do banco configurado. Os registros são somente em
memória, identificados com `TESTE` e nunca são enviados ao banco. Não publique
esse build como produção.

## Autenticação

As telas, o serviço de autenticação e o estado da sessão são compartilhados
pelo pacote local [`Login_projetos`](../Login_projetos/README.md), configurado
em [`src/login-config.js`](./src/login-config.js). O app usa a autenticação e a
API do banco; não usa Supabase Auth. O pacote não foi publicado: a aplicação
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

As migrações `33` (ERP empresas/filiais/financeiro), `34` (demonstração
protegida) e `35` (correção do `JOIN` da view de títulos) **estão aplicadas em
produção** desde 29/10/2026. A `34` só instala `demo_carregar()`, que é usada
em branches descartáveis e recusa a loja (base com vendas/compras), então fica
inerte em produção.

A migração `35` corrige o `JOIN` da view `vw_titulos_financeiros` (INNER →
LEFT em `filiais`). Antes, um usuário com `financeiro.consultar` mas sem
`configuracoes.ver/editar` via a lista "Contas a receber e a pagar" vazia: o
RLS de `filiais` filtrava a linha e o INNER JOIN descartava o título inteiro.
Para aplicar a `35` em outro banco validado:

```bash
npm run validar:migracoes
node neon/aplicar.mjs 35
npx neon data-api refresh-schema
```

A demonstração nunca roda no deploy. Ela exige uma branch descartável, sem
vendas nem compras, e recusa o host de produção:

```bash
$env:DEMO_DATABASE_URL="postgresql://...@ep-branch-descartavel.../neondb?sslmode=require"
$env:DEMO_CONFIRMAR="SIM"
npm run carregar:demonstracao
```

Para reiniciar a branch descartável antes da carga, use
`npm run zerar:operacional` com `RESET_CONFIRMAR=SIM`, `RESET_BACKUP_OK=SIM`,
`RESET_BRANCH_DESCARTAVEL=SIM` e `RESET_HOST` igual ao host da URL. O detalhe
das travas e da lista de tabelas está em `neon/README.md`.

O diagnóstico somente leitura de RLS, privilégios e chaves compostas é
`neon/diagnostico_seguranca.sql`.


## Banco de dados

O banco é criado por **um arquivo só**: `neon/00_banco_neon.sql`
(tabelas, índices, funções, views, GRANTs, RLS e os dados de exemplo).
Depois dele, cada mudança veio numa migração numerada (`neon/01_…` até
`neon/38_…`; a `12` é dados de estudo e não entra na aplicação padrão, a `16`
é Compras, a `17` aplica permissões de clientes/financeiro, a `18` acrescenta
canais e pagamentos, a `19` habilita fotos persistentes de produtos, a `20` cria
o catálogo de categorias, a `21` categoriza os tipos de venda, as `22`–`25`
tratam locais, baixas por produto, operações do Estoque Buffet e reconciliação
por turno, a `26`/`28` reservam códigos sequenciais de produto/cliente, a `29`
aplica o isolamento por organização, a `30` indexa as chaves estrangeiras
simples, a `31` versiona a RPC de permissões por perfil e os dois índices de
chave estrangeira compostos que faltavam, a `32` torna códigos e idempotência
únicos por organização, a `33` acrescenta empresas/filiais/depósitos e o
financeiro integrado (títulos, baixas, caixa), a `34` instala a carga de
demonstração protegida, a `36` reforça a idempotência do estoque e a `37` habilita
o gerenciamento protegido do cadastro de filiais e a `38` adiciona contexto,
acessos explícitos e isolamento operacional por filial. A migration 43 controla
o fluxo de status das vendas e valida metadados por canal. As migrations 38 e 43
estão somente no código local; não foram aplicadas no Neon nem aprovadas para
produção.

Na auditoria somente leitura de 31/10/2026, a produção tinha uma organização,
uma empresa e uma matriz. As vendas, compras e registros financeiros auditados
estavam vinculados a essa filial, mas 29 movimentos de estoque ainda estavam
sem `filial_id`: dois têm vínculo com venda cuja filial pode ser comprovada; os
outros 27 não têm vínculo documental. Os quatro perfis existentes também
estavam sem filial ativa. As 25 políticas RLS encontradas nas tabelas
operacionais auditadas filtravam por organização, não por filial. Portanto,
cadastro de filiais está disponível, mas troca operacional, permissão por
filial e isolamento de ponta a ponta ainda não estão implementados. Não crie
uma segunda filial operacional nem atribua os movimentos ambíguos à matriz
antes de resolver essas pendências. O diagnóstico reproduzível está em
`neon/diagnostico_seguranca.sql`; ele não altera dados.

A aplicação de migrations é por prefixo, **um arquivo por vez**:

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

O ledger existente é a fonte única dos saldos. Compras e entradas são recebidas no **Estoque Principal** (Loja ou Geral);
abastecer o Buffet exige transferência rastreável, que reduz um local e aumenta
o outro sem criar saldo. A tela **Estoque Buffet** oferece perdas auditáveis,
retorno apenas para produtos explicitamente autorizados, histórico filtrável e
fechamento por turno com snapshot e reconciliação de consumo/divergência. O
saldo consolidado soma Principal + Buffet uma única vez. Fechamentos,
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
reais posteriores. Os totais das vendas de seed não fechavam com a soma dos itens
de propósito; isso **não** era bug de cálculo do app. O impacto era de relatório:
outubro/2026 aparecia com cerca de R$ 58,5 mil de faturamento fictício.

A limpeza foi autorizada e executada em 28/10/2026, depois de o backup
`backup-riscos-20261028` ser aberto e conferido. O corte foi
`2026-10-20 00:00:00-03` e a produção terminou com **2 vendas, 2 itens, 9
clientes, 0 lançamentos e 29 movimentos de estoque**; as vendas mantidas são
`#9543` (R$ 6,99) e `#9544` (R$ 20,97). O saldo em cache dos produtos foi
recalculado e ficou igual ao livro-razão (0 divergências). Os 9 clientes foram
preservados de propósito; são cadastros de seed e não entram no faturamento.

Para repetir em outro banco, não apague nada por data sem revisar:

1. `neon/diagnostico_dados_demonstracao.sql` — **somente leitura**, mostra vendas
   por período, divergências de total, produtos/clientes antigos, integridade do
   estoque e tabelas com RLS sem política;
2. criar uma branch/backup do banco e confirmar que ela abre;
3. `neon/limpar_dados_demonstracao.sql` — limpeza **guardada**, exige
   `acai.organization_id`, `acai.limpar_ate` e `acai.confirmar = 'SIM'`, roda em
   transação, recusa corte que não preserve nenhuma venda real, desliga os dois
   triggers de manutenção só dentro da transação, repõe o saldo dos movimentos
   ligados a vendas de seed e confere o resultado antes do `COMMIT`;
4. `neon/limpar_financeiro_demonstracao.sql` — limpeza **guardada** dos
   lançamentos financeiros, exige a organização, o corte, a quantidade esperada
   (`acai.lancamentos_esperados`) e `acai.confirmar = 'SIM'`; confere a
   quantidade antes e depois do `DELETE` e não toca em vendas, clientes, produtos
   nem estoque.

Os scripts de limpeza **não** são executados por `npm run validar:migracoes` nem
por deploy. Eles precisam de autorização explícita e de um corte conferido no
diagnóstico.

## Testes

```bash
npm test                  # unitários (Vitest + jsdom), sem tocar no banco
npm run validar           # alias da cadeia de migrações no PGlite em memória
npm run validar:migracoes # comando completo de validação estrutural e reversões
npm run testar:demonstracao # carga DEMO, travas, idempotência e consistência em PGlite
```

O trabalho multifilial atual está documentado em
[`docs/MULTIFILIAL.md`](../docs/MULTIFILIAL.md), e a execução da Fase 2 em
[`docs/RELATORIO_IMPLEMENTACAO_FASE_2.md`](../docs/RELATORIO_IMPLEMENTACAO_FASE_2.md).
A validação PGlite testa a matriz de escopo, o status inicial da migration 43 e
as reversões em instância limpa, mas isso não substitui homologação no Neon. Não
aplique migrations nem suas reversões em produção sem ambiente autorizado,
backup recuperável, revisão das RPCs e aprovação dos vínculos históricos. Transferência
entre filiais ainda não foi implementada; não publique esta versão como SaaS
multifilial completo.

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
- **Actions variable** `VITE_NEON_URL`, com a URL pública HTTPS do banco usada
  pelo frontend.

Sem o secret, a validação continua normalmente e o passo de deploy é ignorado
com um aviso; nenhum token é armazenado no código. Até esse secret ser criado,
publique manualmente com `npm run deploy:cloudflare`.

### Autorizar o domínio no provedor de autenticação

O login só funciona se a origem estiver autorizada (senão o provedor de
autenticação rejeita a requisição). O domínio vai **com o esquema** `https://`:

```bash
npx neon@latest neon-auth domain add https://SEU-DOMINIO \
  --project-id nameless-tooth-87377816 --branch production
```

Domínios já autorizados: `https://prime-acai-gestao.pages.dev`.

Por fim, abra o site publicado e teste o login com a sua conta de administrador.
Para preparar a conta administrativa inicial `saspacajusvigilancia@gmail.com`,
crie a conta no app, entre uma vez e execute
[`neon/promover-administrador-inicial.sql`](./neon/promover-administrador-inicial.sql)
no SQL Editor do banco. O script não é executado automaticamente.
