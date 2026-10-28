-- Reverte somente os índices criados pela migração 30.
-- Nenhum dado, coluna, política ou função é tocado: sem os índices o banco
-- apenas volta a fazer varredura completa nas colunas de chave estrangeira.

drop index if exists public.compras_usuario_id_idx;
drop index if exists public.devolucoes_buffet_produto_id_idx;
drop index if exists public.devolucoes_buffet_usuario_id_idx;
drop index if exists public.estoque_operacoes_locais_v2_organization_id_idx;
drop index if exists public.fechamentos_buffet_aberto_por_idx;
drop index if exists public.fechamentos_buffet_fechado_por_idx;
drop index if exists public.fechamentos_buffet_reaberto_por_idx;
drop index if exists public.fechamentos_buffet_abertura_produto_id_idx;
drop index if exists public.fechamentos_buffet_itens_organization_id_idx;
drop index if exists public.fechamentos_buffet_itens_produto_id_idx;
drop index if exists public.invite_permissions_permission_id_idx;
drop index if exists public.invites_accepted_user_id_idx;
drop index if exists public.movimentacoes_estoque_usuario_id_idx;
drop index if exists public.notifications_organization_id_idx;
drop index if exists public.perdas_buffet_produto_id_idx;
drop index if exists public.perdas_buffet_usuario_id_idx;
drop index if exists public.recipientes_historico_alterado_por_idx;
drop index if exists public.role_permissions_permission_id_idx;
drop index if exists public.transferencias_estoque_produto_id_idx;
drop index if exists public.transferencias_estoque_usuario_id_idx;
drop index if exists public.user_permissions_permission_id_idx;
drop index if exists public.venda_detalhes_forma_pagamento_id_idx;
drop index if exists public.venda_detalhes_tipo_venda_id_idx;
drop index if exists public.vendas_estornada_por_idx;
drop index if exists public.vendas_usuario_id_idx;

notify pgrst, 'reload schema';
