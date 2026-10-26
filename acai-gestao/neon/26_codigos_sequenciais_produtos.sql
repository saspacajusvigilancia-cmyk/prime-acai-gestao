-- ============================================================================
-- 26 · Reserva concorrente de códigos sequenciais de produtos
-- ============================================================================
-- O código do produto continua globalmente único (`produtos_codigo_key`).
-- Cada formulário novo reserva um número atômico na sequência; números
-- reservados e não usados podem deixar lacunas, sem risco de colisão entre
-- usuários. A reversão remove somente a função e a sequência desta migração.

lock table public.produtos in exclusive mode;

do $$
declare
  v_maior bigint;
begin
  if to_regclass('public.produtos_codigo_seq') is null then
    create sequence public.produtos_codigo_seq;

    select coalesce(max(substring(codigo from '^P([0-9]{1,18})$')::bigint), 0)
      into v_maior
      from public.produtos;

    if v_maior > 0 then
      perform setval('public.produtos_codigo_seq', v_maior, true);
    end if;
  end if;
end
$$;

create or replace function public.proximo_codigo_produto()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero bigint;
  v_codigo text;
begin
  if not public.pode('estoque', 'criar') then
    raise exception 'Sua conta não tem permissão para cadastrar produtos.'
      using errcode = '42501';
  end if;

  loop
    v_numero := nextval('public.produtos_codigo_seq'::regclass);
    v_codigo := 'P' || lpad(
      v_numero::text,
      greatest(3, length(v_numero::text)),
      '0'
    );

    exit when not exists (
      select 1
        from public.produtos p
       where p.codigo = v_codigo
    );
  end loop;

  return v_codigo;
end
$$;

comment on function public.proximo_codigo_produto() is
  'Reserva atomicamente uma sugestão global de código de produto; números não usados podem deixar lacunas.';

revoke all on function public.proximo_codigo_produto() from public, anonymous;
grant execute on function public.proximo_codigo_produto() to authenticated;

-- O Neon Data API mantém seu próprio cache de funções e deve atualizá-lo após
-- a aplicação desta migração (npx neon data-api refresh-schema).
notify pgrst, 'reload schema';
