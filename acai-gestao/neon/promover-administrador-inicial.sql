-- Execute manualmente no SQL Editor do Neon; nao faz parte das migrations.
-- A conta precisa ter sido criada e acessado o app para gerar o perfil.
begin;

do $$
declare
  alvo_email constant text := 'saspacajusvigilancia@gmail.com';
  alvo_id uuid;
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
         is_active = true
   where id = alvo_id;

  if not found then
    raise exception 'Perfil nao encontrado para %. Crie a conta e entre no app antes de executar este script.',
      alvo_email;
  end if;
end;
$$;

commit;
