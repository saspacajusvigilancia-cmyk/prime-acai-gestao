import { acessoNegadoPage } from './pages/acesso-negado.js'
import { loginProjetosConfig } from './login-config.js'
import { naoEncontradoPage } from './pages/nao-encontrado.js'

/**
 * Registro de rotas do app.
 *
 * - `group` define em qual seção do menu lateral a rota aparece.
 * - `icon` é o nome do ícone do Lucide (atributo data-lucide).
 * - `hidden` esconde a rota do menu (usada pela rota curinga e pelas de login).
 * - `publica` marca as rotas que ficam FORA do app (login, cadastro,
 *   recuperação de senha) e são desenhadas sem menu lateral.
 * - `modulo` é a `module_key` usada pelo serviço de permissões
 *   (`src/services/permissoes.js`). O menu só mostra a rota se o usuário tiver a
 *   permissão `modulo.ver`, e o guarda do roteador barra o acesso direto.
 *
 * Quem não é `publica` exige sessão ativa: o `main.js` passa essa lista pelo
 * guarda do roteador, que redireciona para `#/login` quando não há ninguém
 * logado. É conforto, não segurança — o que impede o acesso aos dados é o RLS
 * em `neon/00_banco_neon.sql`.
 */
export const routes = [
  {
    path: '/',
    label: 'Dashboard',
    title: 'Dashboard',
    subtitle: 'Visão geral do negócio',
    icon: 'layout-dashboard',
    group: 'Visão geral',
    modulo: 'dashboard',
    loadPage: () => import('./pages/dashboard.js').then((modulo) => modulo.dashboardPage),
  },
  {
    path: '/vendas',
    label: 'Vendas',
    title: 'Vendas',
    subtitle: 'Pedidos do dia e histórico de vendas',
    icon: 'shopping-cart',
    group: 'Atendimento',
    modulo: 'vendas',
    loadPage: () => import('./pages/vendas.js').then((modulo) => modulo.vendasPage),
  },
  {
    path: '/clientes',
    label: 'Clientes',
    title: 'Clientes',
    subtitle: 'Cadastro e histórico de compras',
    icon: 'users',
    group: 'Atendimento',
    modulo: 'clientes',
    loadPage: () => import('./pages/clientes.js').then((modulo) => modulo.clientesPage),
  },
  {
    path: '/produtos',
    label: 'Produtos',
    title: 'Produtos',
    subtitle: 'Catálogo, preços e imagens dos produtos',
    icon: 'package',
    group: 'Produtos e estoque',
    modulo: 'estoque',
    loadPage: () => import('./pages/produtos.js').then((modulo) => modulo.produtosPage),
  },
  {
    path: '/estoque',
    label: 'Estoque',
    title: 'Estoque',
    subtitle: 'Produtos, insumos e ponto de reposição',
    icon: 'package',
    group: 'Produtos e estoque',
    modulo: 'estoque',
    loadPage: () => import('./pages/estoque.js').then((modulo) => modulo.estoquePage),
  },
  {
    path: '/buffet',
    label: 'Estoque Buffet',
    title: 'Estoque Buffet',
    subtitle: 'Fechamento, contagem e histórico do buffet',
    icon: 'cooking-pot',
    group: 'Produtos e estoque',
    modulo: 'estoque',
    loadPage: () => import('./pages/buffet.js').then((modulo) => modulo.buffetPage),
  },
  {
    path: '/compras',
    label: 'Compras',
    title: 'Compras',
    subtitle: 'Fornecedores, compras, recebimento e custo médio',
    hideTopbarTitle: true,
    icon: 'truck',
    group: 'Suprimentos',
    modulo: 'compras',
    loadPage: () => import('./pages/compras.js').then((modulo) => modulo.comprasPage),
  },
  {
    path: '/fornecedores',
    label: 'Fornecedores',
    title: 'Fornecedores',
    subtitle: 'Cadastro e contatos dos fornecedores',
    icon: 'truck',
    group: 'Suprimentos',
    modulo: 'compras',
    loadPage: () => import('./pages/compras.js').then((modulo) => modulo.fornecedoresPage),
  },
  {
    path: '/financeiro',
    label: 'Financeiro',
    title: 'Financeiro',
    subtitle: 'Entradas, saídas e resultado',
    icon: 'wallet',
    group: 'Financeiro',
    modulo: 'financeiro',
    loadPage: () => import('./pages/financeiro.js').then((modulo) => modulo.financeiroPage),
  },

  {
    path: '/configuracoes',
    label: 'Configurações',
    title: 'Configurações',
    subtitle: 'Dados da empresa, filiais, usuários e permissões',
    icon: 'settings',
    group: 'Administração',
    modulo: 'configuracoes',
    loadPage: () => import('./pages/configuracoes.js').then((modulo) => modulo.configuracoesPage),
  },


  /* ------------------------------------------------------- autenticação ---- */

  {
    path: loginProjetosConfig.rotas.login,
    label: 'Entrar',
    title: 'Entrar',
    subtitle: 'Acesso ao sistema',
    hidden: true,
    publica: true,
    loadPage: () => import('login-projetos/pages/login').then((modulo) => modulo.loginPage),
  },
  {
    path: loginProjetosConfig.rotas.cadastro,
    label: 'Criar conta',
    title: 'Criar conta',
    subtitle: 'Cadastro de usuário',
    hidden: true,
    publica: true,
    loadPage: () => import('login-projetos/pages/cadastro').then((modulo) => modulo.cadastroPage),
  },
  {
    path: loginProjetosConfig.rotas.recuperar,
    label: 'Recuperar senha',
    title: 'Recuperar senha',
    subtitle: 'Envio do link de redefinição',
    hidden: true,
    publica: true,
    loadPage: () => import('login-projetos/pages/recuperar-senha').then((modulo) => modulo.recuperarSenhaPage),
  },
  {
    path: loginProjetosConfig.rotas.redefinir,
    label: 'Nova senha',
    title: 'Criar nova senha',
    subtitle: 'Definição de nova senha',
    hidden: true,
    publica: true,
    // Esta rota precisa funcionar COM sessão: quem chega pelo link do e-mail
    // já está logado (é a sessão de recuperação). Sem esta exceção, o guarda
    // mandaria a pessoa para o dashboard antes de ela definir a senha nova.
    permiteLogado: true,
    loadPage: () => import('login-projetos/pages/redefinir-senha').then((modulo) => modulo.redefinirSenhaPage),
  },

  /* ----------------------------------------------------- acesso negado ---- */

  {
    // Destino de quem tenta abrir um módulo sem permissão. É `hidden` (não
    // aparece no menu) e `publica` (não exige login para ser mostrada — o
    // guarda decide sozinho quando mandar alguém para cá).
    path: '/acesso-negado',
    label: 'Acesso negado',
    title: 'Acesso negado',
    subtitle: 'Você não tem permissão para abrir este módulo',
    hidden: true,
    publica: true,
    // Sem isto, o guarda manda quem está logado para `/` e a página manda de
    // volta para `/acesso-negado`: laço infinito de redirecionamento.
    permiteLogado: true,
    page: acessoNegadoPage,
  },

  {
    path: '*',
    label: 'Não encontrado',
    title: 'Página não encontrada',
    subtitle: 'A rota acessada não existe',
    hidden: true,
    page: naoEncontradoPage,
  },
]
