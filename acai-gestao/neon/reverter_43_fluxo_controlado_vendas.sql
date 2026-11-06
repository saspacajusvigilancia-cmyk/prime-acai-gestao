-- Reverte as RPCs e triggers do fluxo de vendas sem apagar registros de auditoria.

drop function if exists public.historico_status_venda(uuid);
drop function if exists public.cancelar_venda_pendente(uuid, text);
drop function if exists public.atualizar_status_venda(uuid, text);
drop trigger if exists auditar_status_venda on public.vendas;
drop function if exists public.auditar_status_venda();
drop trigger if exists validar_detalhes_canal_venda on public.venda_detalhes;
drop function if exists public.validar_detalhes_canal_venda();
drop trigger if exists vendas_status_inicial on public.vendas;
drop function if exists public.validar_status_inicial_venda();

alter table public.vendas
  alter column status set default 'Concluída';

notify pgrst, 'reload schema';
