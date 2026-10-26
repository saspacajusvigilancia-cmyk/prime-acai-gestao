-- Reversão conservadora da migração 25.
-- Não remove nem altera movimentos: interrompe se as novas operações foram usadas.
do $$
begin
  if exists (select 1 from public.estoque_operacoes_locais_v2) then
    raise exception
      'Há movimentações criadas pelas operações locais da migração 25. Preserve o histórico e migre esses saldos antes de reverter.';
  end if;
  if exists (select 1 from public.fechamentos_buffet) then
    raise exception
      'Há fechamentos ou ciclos abertos do Buffet. Preserve a trilha de auditoria antes de reverter.';
  end if;
  if exists (
    select 1 from public.transferencias_estoque
     where origem in ('buffet', 'preparacao', 'producao')
        or destino in ('buffet', 'preparacao', 'producao')
  ) then
    raise exception
      'Há transferências envolvendo Buffet ou locais futuros. Preserve os registros e migre-os antes de reverter.';
  end if;
  if exists (
    select 1 from public.movimentacoes_estoque
     where origem = 'fornecedor' and destino in ('estoque_geral', 'buffet')
  ) then
    raise exception
      'Há recebimentos direcionados fora do Estoque Normal. Preserve o histórico antes de reverter.';
  end if;
  if exists (
    select 1 from public.produtos
     where local_estoque_origem in ('preparacao', 'producao')
  ) then
    raise exception
      'Há produtos configurados para locais futuros. Reconfigure-os antes de reverter.';
  end if;
  if exists (
    select 1 from public.estoque_locais
     where (codigo = 'buffet' and (nome <> 'Estoque Buffet' or not ativo))
        or (codigo in ('preparacao', 'producao') and
            (nome <> case codigo when 'preparacao' then 'Preparação' else 'Produção' end
             or ativo))
  ) then
    raise exception
      'Há locais renomeados ou ativados pela equipe. Preserve a configuração e reverta-a manualmente antes de remover a migração.';
  end if;
end
$$;

do $$
declare
  v_def text;
  v_antigo text;
begin
  select pg_get_functiondef(
    'public.confirmar_recebimento_compra(uuid, jsonb)'::regprocedure
  ) into v_def;

  if position('public.saldo_estoque_local_v2(v_item.produto_id' in v_def) > 0 then
    v_def := regexp_replace(v_def, '^[[:space:]]*v_local[[:space:]]+text;[[:space:]]*$', '', 'm');
    v_def := regexp_replace(
      v_def,
      'v_local := coalesce.*?public\.saldo_estoque_local_v2\(v_item\.produto_id, ''buffet''\);',
      'v_saldo    := public.saldo_estoque(v_item.produto_id);',
      's'
    );
    v_antigo := 'case v_local when ''loja'' then ''estoque'' when ''geral'' then ''estoque_geral'' else ''buffet'' end';
    v_def := replace(v_def, v_antigo, '''estoque''');
    if position('public.saldo_estoque_local_v2(v_item.produto_id' in v_def) > 0
       or position('v_local' in v_def) > 0 then
      raise exception 'Não foi possível restaurar com segurança a RPC de recebimento de compras.';
    end if;
    execute v_def;
  end if;
end
$$;

drop function if exists public.listar_fechamentos_buffet();
drop function if exists public.listar_itens_fechamento_buffet(uuid);
drop function if exists public.reabrir_fechamento_buffet(uuid, text);
drop function if exists public.fechar_fechamento_buffet(uuid, jsonb);
drop function if exists public.abrir_fechamento_buffet();
drop table if exists public.fechamentos_buffet_itens;
drop table if exists public.fechamentos_buffet;

drop function if exists public.listar_saldos_estoque_por_local();
drop function if exists public.registrar_movimentacao_local_v2(uuid, numeric, text, text, text);
drop function if exists public.transferir_estoque_local_v2(uuid, numeric, text, text, text, text);
drop function if exists public.ajustar_saldo_estoque_local(uuid, numeric, text, text, text);
drop function if exists public.saldo_estoque_local_v2(uuid, text);

drop table if exists public.estoque_operacoes_locais_v2;

delete from public.estoque_locais
 where codigo in ('buffet', 'preparacao', 'producao');

alter table public.estoque_locais
  drop constraint if exists estoque_locais_codigo_check;
alter table public.estoque_locais
  add constraint estoque_locais_codigo_check check (codigo in ('geral', 'loja'));

alter table public.transferencias_estoque
  drop constraint if exists transferencias_estoque_origem_check,
  drop constraint if exists transferencias_estoque_destino_check;
alter table public.transferencias_estoque
  add constraint transferencias_estoque_origem_check check (origem in ('geral', 'loja')),
  add constraint transferencias_estoque_destino_check check (destino in ('geral', 'loja'));

alter table public.movimentacoes_estoque
  drop constraint if exists movimentacoes_estoque_origem_check,
  drop constraint if exists movimentacoes_estoque_destino_check;
alter table public.movimentacoes_estoque
  add constraint movimentacoes_estoque_origem_check
  check (origem in ('abertura', 'contagem', 'fornecedor', 'estoque',
                    'estoque_geral', 'buffet', 'sobra', 'perda', 'cliente')),
  add constraint movimentacoes_estoque_destino_check
  check (destino in ('abertura', 'contagem', 'fornecedor', 'estoque',
                     'estoque_geral', 'buffet', 'sobra', 'perda', 'cliente'));

alter table public.produtos
  drop constraint if exists produtos_local_estoque_origem_valido;
alter table public.produtos
  add constraint produtos_local_estoque_origem_valido
  check (local_estoque_origem in ('estoque', 'estoque_geral', 'buffet'));

create or replace function public.seed_locais_estoque_nova_organizacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.estoque_locais (organization_id, codigo, nome) values
    (new.id, 'geral', 'Estoque geral'),
    (new.id, 'loja', 'Estoque da loja')
  on conflict (organization_id, codigo) do nothing;
  return new;
end;
$$;
