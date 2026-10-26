-- ============================================================================
-- 28 — Código sequencial automático de clientes
-- ============================================================================
-- O código deixa de ser digitado no cadastro: o formulário reserva um número
-- atômico na sequência e o banco também preenche o código quando a inserção
-- chega sem ele. Depois de criado, o código não muda — o trigger
-- `clientes_codigo_imutavel` recusa qualquer alteração.
--
-- Números reservados e não usados podem deixar lacunas, como em produtos (26),
-- sem risco de colisão entre cadastros simultâneos.
--
-- Reverter: neon/reverter_28_codigos_sequenciais_clientes.sql

lock table public.clientes in exclusive mode;

do $$
declare
  v_maior bigint;
begin
  if to_regclass('public.clientes_codigo_seq') is null then
    create sequence public.clientes_codigo_seq;

    select coalesce(max(substring(codigo from '^C-?([0-9]{1,18})$')::bigint), 0)
      into v_maior
      from public.clientes;

    if v_maior > 0 then
      perform setval('public.clientes_codigo_seq', v_maior, true);
    end if;
  end if;
end
$$;

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
end
$$;

comment on function public.proximo_codigo_cliente() is
  'Reserva atomicamente um código de cliente (C-0000); números não usados podem deixar lacunas.';

revoke all on function public.proximo_codigo_cliente() from public, anonymous;
grant execute on function public.proximo_codigo_cliente() to authenticated;

revoke all on sequence public.clientes_codigo_seq from public, anonymous, authenticated;

-- Inserções sem código (integrações, importações e o próprio formulário caso a
-- reserva não chegue) recebem o próximo número; o valor informado é normalizado.
create or replace function public.preencher_codigo_cliente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.codigo is null or btrim(new.codigo) = '' then
    new.codigo := public.proximo_codigo_cliente();
  else
    new.codigo := upper(btrim(new.codigo));
  end if;
  return new;
end
$$;

drop trigger if exists clientes_codigo_automatico on public.clientes;
create trigger clientes_codigo_automatico
before insert on public.clientes
for each row execute function public.preencher_codigo_cliente();

-- O código é a identidade estável do cliente: depois de criado, não muda.
create or replace function public.impedir_alteracao_codigo_cliente()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.codigo is distinct from old.codigo then
    raise exception 'O código do cliente é gerado automaticamente e não pode ser alterado.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists clientes_codigo_imutavel on public.clientes;
create trigger clientes_codigo_imutavel
before update of codigo on public.clientes
for each row execute function public.impedir_alteracao_codigo_cliente();

-- O Neon Data API mantém seu próprio cache de funções e deve atualizá-lo após
-- a aplicação desta migração (npx neon data-api refresh-schema).
notify pgrst, 'reload schema';
