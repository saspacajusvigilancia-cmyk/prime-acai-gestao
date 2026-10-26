-- Reversão segura da migração 27.
-- Não remove registros operacionais, snapshots ou autorizações já utilizados.

do $$
begin
  if exists (select 1 from public.fechamentos_buffet_abertura)
     or exists (select 1 from public.perdas_buffet)
     or exists (select 1 from public.devolucoes_buffet)
     or exists (select 1 from public.produtos where permite_retorno_buffet) then
    raise exception
      'A migração 27 já tem operações, snapshots ou autorizações. Preserve os registros e migre-os antes de reverter.';
  end if;
end
$$;

drop function if exists public.resumo_fechamento_buffet(uuid);
drop function if exists public.listar_operacoes_buffet(date, date, uuid);
drop function if exists public.registrar_perda_buffet(uuid, numeric, text, text, text);
drop function if exists public.devolver_produto_buffet(uuid, numeric, text, text, text, text);

create or replace function public.abrir_fechamento_buffet()
returns table (id uuid, status text, aberto_em timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_org uuid := public.minha_organizacao();
  v_id uuid;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para abrir o fechamento.';
  end if;
  if not public.pode('estoque', 'fechar_buffet') then
    raise exception 'Sua conta não tem permissão para abrir o fechamento do Buffet.'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.estoque_locais l
     where l.organization_id = v_org and l.codigo = 'buffet' and l.ativo
  ) then
    raise exception 'O Estoque Buffet não está ativo nesta filial.';
  end if;

  insert into public.fechamentos_buffet as f (organization_id, aberto_por)
  values (v_org, v_usuario)
  returning f.id into v_id;

  return query
    select f.id, f.status, f.aberto_em
      from public.fechamentos_buffet f where f.id = v_id;
exception
  when unique_violation then
    raise exception 'Já existe um fechamento aberto para o Estoque Buffet.';
end;
$$;

drop function if exists public.abrir_fechamento_buffet_turno(text);

drop function if exists public.listar_fechamentos_buffet();

create function public.listar_fechamentos_buffet()
returns table (
  id uuid,
  status text,
  aberto_em timestamptz,
  fechado_em timestamptz,
  motivo_reabertura text,
  aberto_por uuid,
  fechado_por uuid,
  reaberto_por uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.pode('estoque', 'consultar') then
    raise exception 'Sua conta não tem permissão para consultar fechamentos.'
      using errcode = '42501';
  end if;
  return query
    select f.id, f.status, f.aberto_em, f.fechado_em, f.motivo_reabertura,
           f.aberto_por, f.fechado_por, f.reaberto_por
      from public.fechamentos_buffet f
     where f.organization_id = public.minha_organizacao()
     order by f.aberto_em desc
     limit 50;
end;
$$;

revoke all on function public.listar_fechamentos_buffet() from public, anonymous;
grant execute on function public.listar_fechamentos_buffet() to authenticated;

drop table public.fechamentos_buffet_abertura;
drop table public.perdas_buffet;
drop table public.devolucoes_buffet;

alter table public.produtos
  drop constraint if exists produtos_retorno_buffet_tipo_valido,
  drop column if exists permite_retorno_buffet;

notify pgrst, 'reload schema';
