-- ============================================================================
-- 37 - Gerenciamento seguro de filiais
-- ============================================================================
-- Extensao aditiva da estrutura criada na migracao 33. A filial continua
-- pertencendo a organization_id (tenant) e a empresa existente.
-- Escritas sao feitas somente pela RPC autorizada; nao ha exclusao fisica.

alter table public.filiais
  add column if not exists numero bigint,
  add column if not exists nome_fantasia text,
  add column if not exists telefone text,
  add column if not exists whatsapp text,
  add column if not exists email text,
  add column if not exists responsavel text;

with numeradas as (
  select id,
         row_number() over (
           partition by empresa_id
           order by (tipo = 'matriz') desc, criado_em, id
         ) as numero
    from public.filiais
)
update public.filiais f
   set numero = n.numero
  from numeradas n
 where f.id = n.id
   and f.numero is null;

alter table public.filiais
  alter column numero set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'filiais_numero_positivo'
       and conrelid = 'public.filiais'::regclass
  ) then
    alter table public.filiais
      add constraint filiais_numero_positivo check (numero > 0);
  end if;
end
$$;

create unique index if not exists idx_filiais_empresa_numero
  on public.filiais (empresa_id, numero);

create unique index if not exists idx_filiais_uma_matriz_por_empresa
  on public.filiais (empresa_id)
  where tipo = 'matriz';

create or replace function public.criar_empresa_filial_inicial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  insert into public.empresas (organization_id, codigo, nome, razao_social)
  values (new.id, 'MATRIZ', new.nome, new.nome)
  on conflict (organization_id, codigo) do nothing
  returning id into v_empresa;

  if v_empresa is null then
    select e.id
      into v_empresa
      from public.empresas e
     where e.organization_id = new.id
       and e.codigo = 'MATRIZ';
  end if;

  insert into public.filiais (
    organization_id, empresa_id, codigo, numero, nome, nome_fantasia, tipo
  )
  values (new.id, v_empresa, 'MATRIZ', 1, new.nome, new.nome, 'matriz')
  on conflict (organization_id, codigo) do nothing;

  return new;
end;
$$;

drop trigger if exists organizations_empresa_filial_inicial on public.organizations;
create trigger organizations_empresa_filial_inicial
  after insert on public.organizations
  for each row execute function public.criar_empresa_filial_inicial();

create or replace function public.gerenciar_filial(
  p_operacao text,
  p_filial_id uuid default null,
  p_dados jsonb default '{}'::jsonb
)
returns public.filiais
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_empresa uuid;
  v_filial public.filiais;
  v_numero bigint;
  v_codigo text;
  v_nome text;
  v_documento text;
begin
  if v_org is null or auth.uid() is null then
    raise exception 'Sessao ou organizacao indisponivel.'
      using errcode = '42501';
  end if;

  if not public.pode('configuracoes', 'editar') then
    raise exception 'Sem permissao para gerenciar filiais.'
      using errcode = '42501';
  end if;

  v_documento := regexp_replace(coalesce(p_dados ->> 'cnpj', ''), '[^0-9]', '', 'g');
  if char_length(coalesce(p_dados ->> 'nome_fantasia', '')) > 120
     or char_length(coalesce(p_dados ->> 'telefone', '')) > 30
     or char_length(coalesce(p_dados ->> 'whatsapp', '')) > 30
     or char_length(coalesce(p_dados ->> 'email', '')) > 254
     or char_length(coalesce(p_dados ->> 'endereco', '')) > 500
     or char_length(coalesce(p_dados ->> 'responsavel', '')) > 120 then
    raise exception 'Um dos dados cadastrais excede o limite permitido.'
      using errcode = '22023';
  end if;

  if v_documento <> '' and char_length(v_documento) not in (11, 14) then
    raise exception 'Informe um CNPJ ou CPF com 11 ou 14 digitos.'
      using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_dados ->> 'email', '')), '') is not null
     and p_dados ->> 'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Informe um endereco de e-mail valido.'
      using errcode = '22023';
  end if;

  if p_operacao = 'criar' then
    v_nome := btrim(coalesce(p_dados ->> 'nome', ''));
    if v_nome = '' or char_length(v_nome) > 120 then
      raise exception 'Informe um nome de filial com ate 120 caracteres.'
        using errcode = '22023';
    end if;

    -- Bloqueia a linha da empresa, serializando a geracao do proximo numero
    -- para chamadas concorrentes sem limite artificial de quantidade.
    select e.id
      into v_empresa
      from public.empresas e
     where e.organization_id = v_org
       and e.ativo
     order by (e.codigo = 'MATRIZ') desc, e.criado_em, e.id
     limit 1
     for update;

    if v_empresa is null then
      raise exception 'Nenhuma empresa ativa foi encontrada para esta organizacao.'
        using errcode = 'P0002';
    end if;

    select coalesce(max(f.numero), 0) + 1
      into v_numero
      from public.filiais f
     where f.empresa_id = v_empresa;

    v_codigo := 'LOJA ' || lpad(v_numero::text, 2, '0');
    while exists (
      select 1
        from public.filiais f
       where f.organization_id = v_org
         and lower(f.codigo) = lower(v_codigo)
    ) loop
      v_numero := v_numero + 1;
      v_codigo := 'LOJA ' || lpad(v_numero::text, 2, '0');
    end loop;

    insert into public.filiais (
      organization_id, empresa_id, codigo, numero, nome, nome_fantasia, tipo,
      cnpj, telefone, whatsapp, email, endereco, responsavel
    )
    values (
      v_org, v_empresa, v_codigo, v_numero, v_nome,
      nullif(btrim(coalesce(p_dados ->> 'nome_fantasia', '')), ''),
      case when not exists (
        select 1 from public.filiais f
         where f.empresa_id = v_empresa and f.tipo = 'matriz'
      ) then 'matriz' else 'filial' end,
      nullif(btrim(coalesce(p_dados ->> 'cnpj', '')), ''),
      nullif(btrim(coalesce(p_dados ->> 'telefone', '')), ''),
      nullif(btrim(coalesce(p_dados ->> 'whatsapp', '')), ''),
      nullif(btrim(coalesce(p_dados ->> 'email', '')), ''),
      nullif(btrim(coalesce(p_dados ->> 'endereco', '')), ''),
      nullif(btrim(coalesce(p_dados ->> 'responsavel', '')), '')
    )
    returning * into v_filial;

    return v_filial;
  end if;

  if p_filial_id is null then
    raise exception 'Informe a filial que deseja alterar.'
      using errcode = '22023';
  end if;

  select f.*
    into v_filial
    from public.filiais f
   where f.id = p_filial_id
     and f.organization_id = v_org
   for update;

  if not found then
    raise exception 'Filial nao encontrada nesta organizacao.'
      using errcode = 'P0002';
  end if;

  perform 1
    from public.empresas e
   where e.id = v_filial.empresa_id
     and e.organization_id = v_org
   for update;

  if not found then
    raise exception 'Empresa da filial nao encontrada nesta organizacao.'
      using errcode = 'P0002';
  end if;

  if p_operacao = 'editar' then
    v_nome := btrim(coalesce(p_dados ->> 'nome', ''));
    if v_nome = '' or char_length(v_nome) > 120 then
      raise exception 'Informe um nome de filial com ate 120 caracteres.'
        using errcode = '22023';
    end if;

    update public.filiais
       set nome = v_nome,
           nome_fantasia = nullif(btrim(coalesce(p_dados ->> 'nome_fantasia', '')), ''),
           cnpj = nullif(btrim(coalesce(p_dados ->> 'cnpj', '')), ''),
           telefone = nullif(btrim(coalesce(p_dados ->> 'telefone', '')), ''),
           whatsapp = nullif(btrim(coalesce(p_dados ->> 'whatsapp', '')), ''),
           email = nullif(btrim(coalesce(p_dados ->> 'email', '')), ''),
           endereco = nullif(btrim(coalesce(p_dados ->> 'endereco', '')), ''),
           responsavel = nullif(btrim(coalesce(p_dados ->> 'responsavel', '')), ''),
           atualizado_em = now()
     where id = p_filial_id
     returning * into v_filial;
    return v_filial;
  elsif p_operacao = 'ativar' then
    update public.filiais
       set ativo = true, atualizado_em = now()
     where id = p_filial_id
     returning * into v_filial;
    return v_filial;
  elsif p_operacao = 'desativar' then
    if v_filial.tipo = 'matriz' then
      raise exception 'Defina outra unidade como matriz antes de desativar esta loja.'
        using errcode = '22023';
    end if;

    if (select count(*) from public.filiais f
         where f.empresa_id = v_filial.empresa_id and f.ativo) <= 1 then
      raise exception 'A empresa precisa manter ao menos uma filial ativa.'
        using errcode = '22023';
    end if;

    update public.filiais
       set ativo = false, atualizado_em = now()
     where id = p_filial_id
     returning * into v_filial;
    return v_filial;
  elsif p_operacao = 'definir_matriz' then
    if not v_filial.ativo then
      raise exception 'Ative a unidade antes de defini-la como matriz.'
        using errcode = '22023';
    end if;

    update public.filiais
       set tipo = 'filial', atualizado_em = now()
     where empresa_id = v_filial.empresa_id
       and tipo = 'matriz'
       and id <> p_filial_id;

    update public.filiais
       set tipo = 'matriz', atualizado_em = now()
     where id = p_filial_id
     returning * into v_filial;
    return v_filial;
  end if;

  raise exception 'Operacao de filial invalida.'
    using errcode = '22023';
end;
$$;

revoke all on function public.gerenciar_filial(text, uuid, jsonb) from public, anonymous;
grant execute on function public.gerenciar_filial(text, uuid, jsonb) to authenticated;

-- A leitura segue o RLS da migracao 33; toda escrita passa pela RPC acima.
revoke insert, update, delete on public.filiais from public, anonymous, authenticated;
grant select on public.filiais to authenticated;
