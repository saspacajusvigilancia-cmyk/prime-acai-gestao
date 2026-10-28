-- ============================================================================
-- Reversão da migração 32 - códigos/idempotência voltam a ser globais
-- ============================================================================
-- Esta reversão só deve ser usada quando a migração 29 continuar aplicada.
-- Ela recusa rodar se houver códigos ou chaves repetidos entre organizações,
-- porque a constraint global antiga não aceitaria esses dados.
--
-- Nenhuma venda, item, cliente ou movimento é apagado.

do $$
declare
  v_duplicados integer;
begin
  select count(*) into v_duplicados
    from (
      select codigo
        from public.vendas
       group by codigo
      having count(*) > 1
    ) x;
  if v_duplicados > 0 then
    raise exception
      'Reversão 32 bloqueada: existem % códigos de venda repetidos entre organizações.',
      v_duplicados
      using errcode = 'P0001';
  end if;

  select count(*) into v_duplicados
    from (
      select codigo
        from public.clientes
       group by codigo
      having count(*) > 1
    ) x;
  if v_duplicados > 0 then
    raise exception
      'Reversão 32 bloqueada: existem % códigos de cliente repetidos entre organizações.',
      v_duplicados
      using errcode = 'P0001';
  end if;

  select count(*) into v_duplicados
    from (
      select chave_idempotencia
        from public.vendas
       where chave_idempotencia is not null
       group by chave_idempotencia
      having count(*) > 1
    ) x;
  if v_duplicados > 0 then
    raise exception
      'Reversão 32 bloqueada: existem % chaves de idempotência repetidas entre organizações.',
      v_duplicados
      using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------- unicidade global --
drop index if exists public.vendas_organizacao_codigo_idx;
drop index if exists public.clientes_organizacao_codigo_idx;
drop index if exists public.vendas_organizacao_chave_idempotencia_idx;

alter table public.vendas
  add constraint vendas_codigo_key unique (codigo);
alter table public.clientes
  add constraint clientes_codigo_key unique (codigo);
create unique index vendas_chave_idempotencia_idx
  on public.vendas (chave_idempotencia)
  where chave_idempotencia is not null;

-- ------------------------------------------------------- registrar_venda ----
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.registrar_venda(jsonb, text, uuid, text, text, text)'::regprocedure
  ) into v_def;

  v_def := replace(
    v_def,
    E'  if v_org is null then\n'
      || E'    raise exception ''Organização inválida para registrar a venda.'';\n'
      || E'  end if;\n\n',
    ''
  );

  v_def := replace(v_def, ' and v.organization_id = v_org', '');
  v_def := replace(v_def, ' and c.organization_id = v_org', '');
  v_def := replace(v_def, ' and p.organization_id = v_org', '');
  v_def := replace(v_def, ' and r.organization_id = v_org', '');
  v_def := replace(
    v_def,
    'Item de estoque não encontrado nesta filial (produto_id %).',
    'Item de estoque não encontrado (produto_id %).'
  );

  v_def := replace(
    v_def,
    'v_codigo := public.reservar_codigo_venda();',
    'v_codigo := ''#'' || nextval(''public.vendas_codigo_seq'')::text;'
  );

  v_def := replace(
    v_def,
    '(organization_id, codigo, cliente_id, status, pagamento, total, chave_idempotencia, usuario_id)',
    '(codigo, cliente_id, status, pagamento, total, chave_idempotencia, usuario_id)'
  );
  v_def := replace(
    v_def,
    '(v_org, v_codigo, p_cliente_id, p_status, p_pagamento, 0, v_chave, v_usuario)',
    '(v_codigo, p_cliente_id, p_status, p_pagamento, 0, v_chave, v_usuario)'
  );

  execute v_def;
end;
$$;

-- ------------------------------------------------------------- geradores -----
create or replace function public.proximo_codigo_venda()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_codigo text;
begin
  if not public.pode('vendas', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar vendas.'
      using errcode = '42501';
  end if;

  select '#' || (case when s.is_called then s.last_value + 1 else s.last_value end)::text
    into v_codigo
    from public.vendas_codigo_seq s;

  return v_codigo;
end;
$$;

comment on function public.proximo_codigo_venda() is
  'Código que a próxima venda vai receber. NÃO consome o número da sequência.';

revoke all on function public.proximo_codigo_venda() from public;
revoke all on function public.proximo_codigo_venda() from anonymous;
grant execute on function public.proximo_codigo_venda() to authenticated;

create or replace function public.proximo_codigo_cliente()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero bigint;
  v_codigo text;
begin
  if not public.pode('clientes', 'criar') then
    raise exception 'Sua conta não tem permissão para cadastrar clientes.'
      using errcode = '42501';
  end if;

  loop
    v_numero := nextval('public.clientes_codigo_seq'::regclass);
    v_codigo := 'C-' || lpad(
      v_numero::text,
      greatest(4, length(v_numero::text)),
      '0'
    );

    exit when not exists (
      select 1
        from public.clientes c
       where c.codigo = v_codigo
    );
  end loop;

  return v_codigo;
end;
$$;

comment on function public.proximo_codigo_cliente() is
  'Reserva atomicamente um código de cliente (C-0000); números não usados podem deixar lacunas.';

revoke all on function public.proximo_codigo_cliente() from public;
revoke all on function public.proximo_codigo_cliente() from anonymous;
grant execute on function public.proximo_codigo_cliente() to authenticated;

-- Devolve as sequências antigas ao maior código gravado para não repetir
-- números já usados. Isso não altera nenhum dado.
do $$
declare
  v_maior bigint;
begin
  select coalesce(max(substring(codigo from '^#([0-9]+)$')::bigint), 0)
    into v_maior
    from public.vendas;
  if v_maior > 0 then
    perform setval('public.vendas_codigo_seq', v_maior, true);
  end if;

  select coalesce(max(substring(codigo from '^C-?([0-9]+)$')::bigint), 0)
    into v_maior
    from public.clientes;
  if v_maior > 0 then
    perform setval('public.clientes_codigo_seq', v_maior, true);
  end if;
end;
$$;

-- ----------------------------------------------------- estruturas internas ---
drop trigger if exists vendas_sincronizar_contador on public.vendas;
drop function if exists public.sincronizar_contador_codigo_venda();
drop function if exists public.reservar_codigo_venda();
drop function if exists public.reservar_codigo_cliente();
drop table if exists private.organization_counters;

notify pgrst, 'reload schema';
