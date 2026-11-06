-- Execute manualmente no SQL Editor do Neon; nao faz parte das migrations.
-- A conta precisa ter sido criada e acessado o app para gerar o perfil.
begin;

do $$
declare
  alvo_email constant text := 'saspacajusvigilancia@gmail.com';
  alvo_id uuid;
  alvo_organizacao uuid;
  filial_matriz uuid;
  quantidade integer;
begin
  select count(*)
    into quantidade
    from neon_auth.user
   where lower(email) = lower(alvo_email);

  if quantidade <> 1 then
    raise exception 'Esperada uma conta Neon Auth para %, encontradas: %.',
      alvo_email, quantidade;
  end if;

  select id
    into alvo_id
    from neon_auth.user
   where lower(email) = lower(alvo_email);

  update public.profiles
     set role = 'admin',
         is_active = true,
         aprovado_em = coalesce(aprovado_em, now())
   where id = alvo_id;

  if not found then
    raise exception 'Perfil nao encontrado para %. Crie a conta e entre no app antes de executar este script.',
      alvo_email;
  end if;

  select organization_id
    into alvo_organizacao
    from public.profiles
   where id = alvo_id;

  select id
    into filial_matriz
    from public.filiais
   where organization_id = alvo_organizacao
     and codigo = 'MATRIZ'
     and ativo
   order by numero, id
   limit 1;

  if filial_matriz is null then
    raise exception 'Filial MATRIZ ativa nao encontrada para %.', alvo_email;
  end if;

  insert into public.acessos_filiais (
    organization_id, filial_id, usuario_id, ativo, concedido_por
  )
  values (alvo_organizacao, filial_matriz, alvo_id, true, alvo_id)
  on conflict (usuario_id, filial_id) do update
    set ativo = true,
        concedido_por = excluded.concedido_por,
        atualizado_em = now();

  update public.profiles
     set filial_id = filial_matriz,
         updated_at = now()
   where id = alvo_id;
end;
$$;

commit;
