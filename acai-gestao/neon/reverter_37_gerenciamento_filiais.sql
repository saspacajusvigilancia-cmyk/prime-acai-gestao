-- Reversao conservadora da migracao 37.
-- Recusa apagar contatos que tenham sido preenchidos depois da migracao.
do $$
begin
  if exists (
    select 1
      from public.filiais
     where nome_fantasia is not null
        or telefone is not null
        or whatsapp is not null
        or email is not null
        or responsavel is not null
  ) then
    raise exception
      'Reversao 37 interrompida: existem dados cadastrais de filiais que precisam ser preservados.';
  end if;
end
$$;

drop function if exists public.gerenciar_filial(text, uuid, jsonb);
drop trigger if exists organizations_empresa_filial_inicial on public.organizations;
drop function if exists public.criar_empresa_filial_inicial();
drop index if exists public.idx_filiais_uma_matriz_por_empresa;
drop index if exists public.idx_filiais_empresa_numero;
alter table public.filiais
  drop constraint if exists filiais_numero_positivo,
  drop column if exists numero,
  drop column if exists nome_fantasia,
  drop column if exists telefone,
  drop column if exists whatsapp,
  drop column if exists email,
  drop column if exists responsavel;
