-- ============================================================================
-- 30 · Índices nas chaves estrangeiras que ainda fazem varredura completa
-- ============================================================================
-- O PostgreSQL indexa automaticamente a coluna referenciada (lado pai), mas
-- não a coluna que carrega a FK (lado filho). Sem índice no filho, apagar ou
-- atualizar a linha pai percorre a tabela inteira para checar a restrição, e
-- joins por essa coluna caem no mesmo caminho. Esta migração só cria índices:
-- não altera dados, colunas, políticas nem funções.
--
-- São 25 colunas verificadas em 28/10/2026. `create index if not exists` deixa
-- a migração repetível, e a reversão remove apenas os índices desta lista.

create index if not exists compras_usuario_id_idx
  on public.compras (usuario_id);

create index if not exists devolucoes_buffet_produto_id_idx
  on public.devolucoes_buffet (produto_id);
create index if not exists devolucoes_buffet_usuario_id_idx
  on public.devolucoes_buffet (usuario_id);

create index if not exists estoque_operacoes_locais_v2_organization_id_idx
  on public.estoque_operacoes_locais_v2 (organization_id);

create index if not exists fechamentos_buffet_aberto_por_idx
  on public.fechamentos_buffet (aberto_por);
create index if not exists fechamentos_buffet_fechado_por_idx
  on public.fechamentos_buffet (fechado_por);
create index if not exists fechamentos_buffet_reaberto_por_idx
  on public.fechamentos_buffet (reaberto_por);

create index if not exists fechamentos_buffet_abertura_produto_id_idx
  on public.fechamentos_buffet_abertura (produto_id);

create index if not exists fechamentos_buffet_itens_organization_id_idx
  on public.fechamentos_buffet_itens (organization_id);
create index if not exists fechamentos_buffet_itens_produto_id_idx
  on public.fechamentos_buffet_itens (produto_id);

create index if not exists invite_permissions_permission_id_idx
  on public.invite_permissions (permission_id);

create index if not exists invites_accepted_user_id_idx
  on public.invites (accepted_user_id);

create index if not exists movimentacoes_estoque_usuario_id_idx
  on public.movimentacoes_estoque (usuario_id);

create index if not exists notifications_organization_id_idx
  on public.notifications (organization_id);

create index if not exists perdas_buffet_produto_id_idx
  on public.perdas_buffet (produto_id);
create index if not exists perdas_buffet_usuario_id_idx
  on public.perdas_buffet (usuario_id);

create index if not exists recipientes_historico_alterado_por_idx
  on public.recipientes_historico (alterado_por);

create index if not exists role_permissions_permission_id_idx
  on public.role_permissions (permission_id);

create index if not exists transferencias_estoque_produto_id_idx
  on public.transferencias_estoque (produto_id);
create index if not exists transferencias_estoque_usuario_id_idx
  on public.transferencias_estoque (usuario_id);

create index if not exists user_permissions_permission_id_idx
  on public.user_permissions (permission_id);

create index if not exists venda_detalhes_forma_pagamento_id_idx
  on public.venda_detalhes (forma_pagamento_id);
create index if not exists venda_detalhes_tipo_venda_id_idx
  on public.venda_detalhes (tipo_venda_id);

create index if not exists vendas_estornada_por_idx
  on public.vendas (estornada_por);
create index if not exists vendas_usuario_id_idx
  on public.vendas (usuario_id);

notify pgrst, 'reload schema';
