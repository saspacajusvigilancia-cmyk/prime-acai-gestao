-- ============================================================================
-- 32 - Códigos de venda/cliente e idempotência por organização
-- ============================================================================
-- A migração 29 isolou os dados por organização, mas mantinha três chaves
-- globais:
--   * vendas.codigo;
--   * clientes.codigo;
--   * vendas.chave_idempotencia.
--
-- Duas lojas não podiam repetir o mesmo número de pedido/cliente. Além disso,
-- a RPC registrar_venda() procurava a chave de idempotência sem filtrar a
-- organização: uma chave repetida em outra loja poderia devolver a venda
-- errada.
--
-- Esta migração:
--   1. cria um contador interno por organização (schema private, fora do Data
--      API) para reservar códigos de venda e de cliente;
--   2. troca as unicidades globais por unicidade (organization_id, codigo);
--   3. troca a unicidade global da chave de idempotência por
--      (organization_id, chave_idempotencia);
--   4. ajusta registrar_venda() para validar cliente/produto/recipiente na
--      organização da sessão e procurar a chave de idempotência apenas nela.
--
-- Pré-requisito: migração 29 aplicada (organization_id nas quatro tabelas).
-- Reversão: reverter_32_codigos_idempotencia_por_organizacao.sql.
--
-- Nenhuma linha é apagada. A migração falha de forma explícita se houver
-- duplicidade dentro da mesma organização, em vez de escolher um registro.
-- ============================================================================

do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'vendas'
       and column_name = 'organization_id'
  ) then
    raise exception
      'Migração 32 exige a migração 29 aplicada: vendas.organization_id não existe.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'clientes'
       and column_name = 'organization_id'
  ) then
    raise exception
      'Migração 32 exige a migração 29 aplicada: clientes.organization_id não existe.'
      using errcode = 'P0001';
  end if;
end;
$$;

-- ------------------------------------------------- contador por organização ---
-- Fica no schema private para não ser exposto pelo Data API. As funções
-- security definer abaixo são as únicas portas de acesso.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anonymous;
revoke all on schema private from authenticated;

create table if not exists private.organization_counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recurso text not null check (recurso in ('venda', 'cliente')),
  valor bigint not null default 0 check (valor >= 0),
  primary key (organization_id, recurso)
);

revoke all on private.organization_counters from public;
revoke all on private.organization_counters from anonymous;
revoke all on private.organization_counters from authenticated;

-- Semeia os contadores com o maior código já usado em cada organização. O
-- greatest() evita voltar atrás se a migração for reaplicada depois de novas
-- vendas.
insert into private.organization_counters (organization_id, recurso, valor)
select
  o.id,
  'venda',
  coalesce(max(substring(v.codigo from '^#([0-9]+)$')::bigint), 0)
from public.organizations o
left join public.vendas v on v.organization_id = o.id
group by o.id
on conflict (organization_id, recurso) do update
  set valor = greatest(private.organization_counters.valor, excluded.valor);

insert into private.organization_counters (organization_id, recurso, valor)
select
  o.id,
  'cliente',
  coalesce(max(substring(c.codigo from '^C-?([0-9]+)$')::bigint), 0)
from public.organizations o
left join public.clientes c on c.organization_id = o.id
group by o.id
on conflict (organization_id, recurso) do update
  set valor = greatest(private.organization_counters.valor, excluded.valor);

-- --------------------------------------------------------- geradores ---------
create or replace function public.reservar_codigo_venda()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_num bigint;
begin
  if v_org is null then
    raise exception 'Organização inválida para reservar o código da venda.'
      using errcode = '42501';
  end if;

  insert into private.organization_counters as c (organization_id, recurso, valor)
  values (v_org, 'venda', 1)
  on conflict (organization_id, recurso) do update
    set valor = c.valor + 1
  returning c.valor into v_num;

  return '#' || v_num::text;
end;
$$;

create or replace function public.reservar_codigo_cliente()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_num bigint;
begin
  if v_org is null then
    raise exception 'Organização inválida para reservar o código do cliente.'
      using errcode = '42501';
  end if;

  insert into private.organization_counters as c (organization_id, recurso, valor)
  values (v_org, 'cliente', 1)
  on conflict (organization_id, recurso) do update
    set valor = c.valor + 1
  returning c.valor into v_num;

  return 'C-' || lpad(
    v_num::text,
    greatest(4, length(v_num::text)),
    '0'
  );
end;
$$;

revoke all on function public.reservar_codigo_venda() from public;
revoke all on function public.reservar_codigo_venda() from anonymous;
revoke all on function public.reservar_codigo_venda() from authenticated;
revoke all on function public.reservar_codigo_cliente() from public;
revoke all on function public.reservar_codigo_cliente() from anonymous;
revoke all on function public.reservar_codigo_cliente() from authenticated;

-- O próximo código exibido na tela NÃO consome o contador. A reserva real
-- acontece só quando a venda/cliente é gravado.
create or replace function public.proximo_codigo_venda()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_valor bigint;
begin
  if not public.pode('vendas', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar vendas.'
      using errcode = '42501';
  end if;

  if v_org is null then
    raise exception 'Organização inválida para consultar o próximo pedido.'
      using errcode = '42501';
  end if;

  select coalesce(c.valor, 0)
    into v_valor
    from (select 1) x
    left join private.organization_counters c
      on c.organization_id = v_org and c.recurso = 'venda';

  return '#' || (v_valor + 1)::text;
end;
$$;

create or replace function public.proximo_codigo_cliente()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.pode('clientes', 'criar') then
    raise exception 'Sua conta não tem permissão para cadastrar clientes.'
      using errcode = '42501';
  end if;

  return public.reservar_codigo_cliente();
end;
$$;

comment on function public.proximo_codigo_venda() is
  'Código que a próxima venda da organização vai receber. Não consome o contador.';
comment on function public.proximo_codigo_cliente() is
  'Reserva atomicamente um código de cliente (C-0000) para a organização da sessão.';

revoke all on function public.proximo_codigo_venda() from public;
revoke all on function public.proximo_codigo_venda() from anonymous;
grant execute on function public.proximo_codigo_venda() to authenticated;
revoke all on function public.proximo_codigo_cliente() from public;
revoke all on function public.proximo_codigo_cliente() from anonymous;
grant execute on function public.proximo_codigo_cliente() to authenticated;

-- --------------------------------------------------- unicidades por loja ----
-- Defesa em profundidade para bancos que pularam a 17: essas políticas
-- antigas têm qual = true e, sendo permissivas, anulariam as políticas por
-- organização da 29. A 29 já as remove; repetir aqui deixa a correção segura
-- mesmo em um banco onde a 29 foi aplicada antes deste ajuste.
drop policy if exists usuario_vendas on public.vendas;
drop policy if exists usuario_itens_venda on public.itens_venda;
drop policy if exists usuario_clientes on public.clientes;
drop policy if exists usuario_lancamentos on public.lancamentos;

-- As chaves globais antigas impedem a repetição entre lojas. O contador acima
-- passa a gerar números por organização; a constraint composta é a proteção
-- definitiva contra concorrência e códigos digitados manualmente.
alter table public.vendas
  drop constraint if exists vendas_codigo_key;
alter table public.clientes
  drop constraint if exists clientes_codigo_key;
drop index if exists public.vendas_chave_idempotencia_idx;

create unique index if not exists vendas_organizacao_codigo_idx
  on public.vendas (organization_id, codigo);

create unique index if not exists clientes_organizacao_codigo_idx
  on public.clientes (organization_id, codigo);

create unique index if not exists vendas_organizacao_chave_idempotencia_idx
  on public.vendas (organization_id, chave_idempotencia)
  where chave_idempotencia is not null;

-- ------------------------------------------- registrar_venda por organização --
-- A função é grande e já evoluiu na 24. Em vez de copiar o corpo inteiro (e
-- perder alguma correção futura), aplicamos substituições pontuais e falhamos
-- alto se alguma âncora esperada não existir.
do $$
declare
  v_def text;
  v_antigo text;
begin
  select pg_get_functiondef(
    'public.registrar_venda(jsonb, text, uuid, text, text, text)'::regprocedure
  ) into v_def;

  -- Reaplicar a migração não deve falhar nem duplicar filtros. A transação
  -- inteira é atômica; se o marcador já existe, a função já foi ajustada.
  if position('and v.organization_id = v_org' in v_def) = 0 then

  -- 1. A organização não pode ser nula.
  v_antigo := E'begin\n  if v_usuario is null then';
  if position(v_antigo in v_def) = 0 then
    raise exception 'Migração 32 não reconheceu o início de registrar_venda().';
  end if;
  v_def := replace(
    v_def,
    v_antigo,
    E'begin\n  if v_org is null then\n'
      || E'    raise exception ''Organização inválida para registrar a venda.'';\n'
      || E'  end if;\n\n  if v_usuario is null then'
  );

  -- 2. A chave de idempotência pertence à organização da sessão.
  v_antigo := 'where v.chave_idempotencia = v_chave;';
  if position(v_antigo in v_def) = 0 then
    raise exception 'Migração 32 não reconheceu a busca por chave de idempotência.';
  end if;
  v_def := replace(
    v_def,
    v_antigo,
    E'where v.chave_idempotencia = v_chave\n         and v.organization_id = v_org;'
  );

  -- 3. Cliente da venda precisa ser da mesma organização.
  v_antigo := 'and not exists (select 1 from public.clientes c where c.id = p_cliente_id) then';
  if position(v_antigo in v_def) = 0 then
    raise exception 'Migração 32 não reconheceu a validação do cliente.';
  end if;
  v_def := replace(
    v_def,
    v_antigo,
    'and not exists (select 1 from public.clientes c where c.id = p_cliente_id and c.organization_id = v_org) then'
  );

  -- 4. O código gerado vem do contador da organização.
  v_antigo := 'v_codigo := ''#'' || nextval(''public.vendas_codigo_seq'')::text;';
  if position(v_antigo in v_def) = 0 then
    raise exception 'Migração 32 não reconheceu a geração do código da venda.';
  end if;
  v_def := replace(v_def, v_antigo, 'v_codigo := public.reservar_codigo_venda();');

  -- 5. Duplicidade de código é verificada apenas dentro da organização.
  v_antigo := 'if exists (select 1 from public.vendas v where v.codigo = v_codigo) then';
  if position(v_antigo in v_def) = 0 then
    raise exception 'Migração 32 não reconheceu a checagem de código duplicado.';
  end if;
  v_def := replace(
    v_def,
    v_antigo,
    'if exists (select 1 from public.vendas v where v.codigo = v_codigo and v.organization_id = v_org) then'
  );

  -- 6. Grava a organização explicitamente (o trigger da 29 também preenche).
  v_antigo := '(codigo, cliente_id, status, pagamento, total, chave_idempotencia, usuario_id)';
  if position(v_antigo in v_def) = 0 then
    raise exception 'Migração 32 não reconheceu as colunas do INSERT de vendas.';
  end if;
  v_def := replace(
    v_def,
    v_antigo,
    '(organization_id, codigo, cliente_id, status, pagamento, total, chave_idempotencia, usuario_id)'
  );

  v_antigo := '(v_codigo, p_cliente_id, p_status, p_pagamento, 0, v_chave, v_usuario)';
  if position(v_antigo in v_def) = 0 then
    raise exception 'Migração 32 não reconheceu os valores do INSERT de vendas.';
  end if;
  v_def := replace(
    v_def,
    v_antigo,
    '(v_org, v_codigo, p_cliente_id, p_status, p_pagamento, 0, v_chave, v_usuario)'
  );

  -- 7. Produto e recipiente também precisam ser da mesma organização.
  v_antigo := 'where p.id = v_prod_id;';
  if position(v_antigo in v_def) = 0 then
    raise exception 'Migração 32 não reconheceu a busca do produto.';
  end if;
  v_def := replace(
    v_def,
    v_antigo,
    E'where p.id = v_prod_id\n         and p.organization_id = v_org;'
  );

  -- Mantém a mensagem de "filial" usada pelo restante do sistema e pelos
  -- testes que exercitam o isolamento de estoque.
  v_antigo := 'Item de estoque não encontrado (produto_id %).';
  if position(v_antigo in v_def) > 0 then
    v_def := replace(
      v_def,
      v_antigo,
      'Item de estoque não encontrado nesta filial (produto_id %).'
    );
  end if;

  v_antigo := 'and not exists (select 1 from public.recipientes r where r.id = v_recip) then';
  if position(v_antigo in v_def) = 0 then
    raise exception 'Migração 32 não reconheceu a validação do recipiente.';
  end if;
  v_def := replace(
    v_def,
    v_antigo,
    'and not exists (select 1 from public.recipientes r where r.id = v_recip and r.organization_id = v_org) then'
  );

  end if;

  execute v_def;
end;
$$;

-- Um código digitado manualmente acima do contador não pode ser ultrapassado
-- pelo próximo código gerado. O contador só sobe, nunca desce.
create or replace function public.sincronizar_contador_codigo_venda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_num bigint;
begin
  if new.codigo ~ '^#[0-9]+$' then
    v_num := substring(new.codigo from '^#([0-9]+)$')::bigint;
    insert into private.organization_counters as c (organization_id, recurso, valor)
    values (new.organization_id, 'venda', v_num)
    on conflict (organization_id, recurso) do update
      set valor = greatest(c.valor, excluded.valor);
  end if;
  return new;
end;
$$;

drop trigger if exists vendas_sincronizar_contador on public.vendas;
create trigger vendas_sincronizar_contador
  after insert on public.vendas
  for each row execute function public.sincronizar_contador_codigo_venda();

revoke all on function public.sincronizar_contador_codigo_venda() from public;
revoke all on function public.sincronizar_contador_codigo_venda() from anonymous;
revoke all on function public.sincronizar_contador_codigo_venda() from authenticated;

notify pgrst, 'reload schema';
