-- ============================================================================
-- 24 · Política de baixa por produto e isolamento de estoque por organização
-- ============================================================================
-- Aditiva: preserva o livro-razão, as vendas e os estornos existentes.
-- A organização do produto representa a filial/loja proprietária do saldo.
--
-- A baixa de venda continua centralizada no único caminho existente:
-- registrar_venda() -> movimentacoes_estoque. O trigger abaixo valida e adapta
-- esse movimento já existente; não cria uma segunda rotina de baixa.
-- Reverter o comportamento: neon/reverter_24_baixa_automatica_venda_direta.sql

alter table public.produtos
  add column if not exists organization_id uuid,
  add column if not exists tipo_produto text not null default 'outro',
  add column if not exists regra_baixa_estoque text not null default 'legada',
  add column if not exists local_estoque_origem text not null default 'estoque',
  add column if not exists permitir_estoque_negativo boolean not null default false;

do $$
begin
  if exists (
    select 1
      from public.movimentacoes_estoque
     group by produto_id
    having count(distinct organization_id) > 1
  ) then
    raise exception
      'Migração 24 interrompida: há produtos com movimentos em mais de uma organização. Não altere o ledger imutável; defina uma estratégia de separação auditável antes de migrar.';
  end if;

  if exists (
    select 1
      from public.produtos p
     where not exists (
       select 1 from public.movimentacoes_estoque m where m.produto_id = p.id
     )
       and p.organization_id is null
       and (select count(*) from public.organizations) <> 1
  ) then
    raise exception
      'Migração 24 interrompida: há produtos sem movimentos e mais de uma organização. Defina manualmente a filial de cada produto antes de migrar.';
  end if;

  if exists (select 1 from public.organizations) = false then
    raise exception 'Migração 24 interrompida: nenhuma organização está cadastrada.';
  end if;
end
$$;

update public.produtos p
   set organization_id = coalesce(
     (
       select m.organization_id
         from public.movimentacoes_estoque m
        where m.produto_id = p.id
        group by m.organization_id
        order by m.organization_id
        limit 1
     ),
     (
       select o.id
         from public.organizations o
        order by o.created_at, o.id
        limit 1
     )
   )
 where p.organization_id is null;

alter table public.produtos
  alter column organization_id set default public.minha_organizacao(),
  alter column organization_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'produtos_organization_id_fkey'
  ) then
    alter table public.produtos
      add constraint produtos_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'produtos_organization_id_id_unico'
  ) then
    alter table public.produtos
      add constraint produtos_organization_id_id_unico unique (organization_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'produtos_tipo_produto_valido'
  ) then
    alter table public.produtos
      add constraint produtos_tipo_produto_valido
      check (tipo_produto in ('venda_direta', 'buffet', 'insumo', 'embalagem', 'outro'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'produtos_regra_baixa_valida'
  ) then
    alter table public.produtos
      add constraint produtos_regra_baixa_valida
      check (regra_baixa_estoque in
        ('venda_confirmada', 'manual', 'fechamento_buffet', 'nenhuma', 'legada'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'produtos_local_estoque_origem_valido'
  ) then
    alter table public.produtos
      add constraint produtos_local_estoque_origem_valido
      check (local_estoque_origem in ('estoque', 'estoque_geral', 'buffet'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'produtos_baixa_venda_coerente'
  ) then
    alter table public.produtos
      add constraint produtos_baixa_venda_coerente
      check (
        regra_baixa_estoque <> 'venda_confirmada'
        or (
          tipo_produto = 'venda_direta'
          and controla_estoque
          and metodo_estoque = 'movimentacoes'
          and local_estoque_origem in ('estoque', 'estoque_geral')
          and permitir_estoque_negativo = false
          and (
            (tipo_venda = 'unidade' and unidade = 'un')
            or (tipo_venda = 'peso' and unidade = 'kg')
          )
        )
      );
  end if;
end
$$;

-- A rotina existente continua dona da baixa e do contador retornado. Ajusta
-- somente a seleção e condição do movimento para que políticas manuais não
-- dependam de um trigger cancelar silenciosamente um INSERT.
do $$
declare
  v_def text;
  v_select_antigo text := 'p.controla_estoque, p.metodo_estoque';
  v_select_novo text := 'p.controla_estoque, p.metodo_estoque, p.regra_baixa_estoque';
  v_if_antigo text := 'if v_deduz and v_prod.controla_estoque and v_prod.metodo_estoque = ''movimentacoes'' then';
  v_if_novo text := 'if v_deduz and v_prod.controla_estoque and v_prod.metodo_estoque = ''movimentacoes'' and v_prod.regra_baixa_estoque in (''legada'', ''venda_confirmada'') then';
begin
  select pg_get_functiondef(
    'public.registrar_venda(jsonb, text, uuid, text, text, text)'::regprocedure
  ) into v_def;

  if position(v_select_novo in v_def) = 0 then
    if position(v_select_antigo in v_def) = 0 then
      raise exception 'Migração 24 não reconheceu a consulta de produtos em registrar_venda().';
    end if;
    v_def := replace(v_def, v_select_antigo, v_select_novo);
  end if;

  if position(v_if_novo in v_def) = 0 then
    if position(v_if_antigo in v_def) = 0 then
      raise exception 'Migração 24 não reconheceu a condição de baixa em registrar_venda().';
    end if;
    v_def := replace(v_def, v_if_antigo, v_if_novo);
  end if;

  execute v_def;
end
$$;

create index if not exists produtos_organization_ativo_idx
  on public.produtos (organization_id, ativo, nome);

-- O livro-razão já carrega a organização. A restrição composta impede registrar
-- um movimento de uma filial para produto/saldo pertencente a outra.
do $$
begin
  if exists (
    select 1
      from public.movimentacoes_estoque m
      join public.produtos p on p.id = m.produto_id
     where m.organization_id <> p.organization_id
  ) then
    raise exception
      'Migração 24 interrompida: há movimentos cuja organização difere da filial do produto.';
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'movimentacoes_produto_organizacao_fk'
  ) then
    alter table public.movimentacoes_estoque
      add constraint movimentacoes_produto_organizacao_fk
      foreign key (organization_id, produto_id)
      references public.produtos (organization_id, id) on delete restrict;
  end if;
end
$$;

alter table public.movimentacoes_estoque
  add column if not exists unidade text;

alter table public.movimentacoes_estoque
  alter column unidade set default 'un';

-- A unidade fica registrada como fotografia histórica; alterações futuras no
-- cadastro não reescrevem a unidade. Movimentos anteriores à migração mantêm
-- NULL para não reescrever o livro-razão imutável.
create or replace function public.validar_movimentacao_produto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_prod public.produtos%rowtype;
  v_item public.itens_venda%rowtype;
  v_org_venda uuid;
  v_saldo numeric;
  v_local text;
begin
  select p.* into v_prod
    from public.produtos p
   where p.id = new.produto_id
     and p.organization_id = new.organization_id
   for update;

  if not found then
    raise exception 'Produto não pertence à filial desta movimentação.';
  end if;
  if v_org is null or new.organization_id <> v_org then
    raise exception 'A movimentação não pertence à filial autenticada.'
      using errcode = '42501';
  end if;

  new.unidade := v_prod.unidade;

  if new.estorno_de_id is not null then
    select m.unidade into new.unidade
      from public.movimentacoes_estoque m
     where m.id = new.estorno_de_id
       and m.produto_id = new.produto_id
       and m.organization_id = new.organization_id;
    if not found then
      raise exception 'O movimento original do estorno não pertence a este produto e filial.';
    end if;
  end if;

  if new.item_venda_id is null then
    return new;
  end if;

  select i.* into v_item
    from public.itens_venda i
   where i.id = new.item_venda_id
     and i.venda_id = new.venda_id
     and i.produto_id = new.produto_id;
  if not found then
    raise exception 'A baixa precisa apontar para o item correspondente da venda.';
  end if;

  select p.organization_id into v_org_venda
    from public.vendas v
    join public.profiles p on p.id = v.usuario_id and p.is_active
   where v.id = new.venda_id
     and p.organization_id = new.organization_id;
  if not found then
    raise exception 'A venda e o produto não pertencem à mesma filial.';
  end if;

  if not v_prod.ativo then
    raise exception 'O produto "%" está inativo e não pode ser vendido.', v_prod.nome;
  end if;

  if v_prod.regra_baixa_estoque not in ('legada', 'venda_confirmada')
     or not v_prod.controla_estoque
     or v_prod.metodo_estoque <> 'movimentacoes' then
    raise exception 'A política do produto não autoriza uma baixa automática de venda.';
  end if;

  if v_prod.regra_baixa_estoque = 'venda_confirmada' then
    if v_prod.tipo_produto <> 'venda_direta' then
      raise exception 'A baixa automática só é permitida para produtos de venda direta.';
    end if;
    if v_prod.local_estoque_origem not in ('estoque', 'estoque_geral') then
      raise exception 'A baixa automática de venda direta não pode usar o Estoque Buffet.';
    end if;
    if (v_prod.tipo_venda = 'unidade' and v_prod.unidade <> 'un')
       or (v_prod.tipo_venda = 'peso' and v_prod.unidade <> 'kg')
       or v_prod.tipo_venda = 'receita' then
      raise exception
        'Unidade comercial incompatível com o estoque de "%". Configure uma conversão antes de habilitar a baixa automática.',
        v_prod.nome;
    end if;
    if not exists (
      select 1
        from public.estoque_locais l
       where l.organization_id = v_prod.organization_id
         and l.codigo = case v_prod.local_estoque_origem
           when 'estoque' then 'loja'
           when 'estoque_geral' then 'geral'
         end
         and l.ativo
    ) then
      raise exception 'O local de estoque configurado não está ativo nesta filial.';
    end if;

    new.origem := v_prod.local_estoque_origem;
  end if;

  if new.origem = 'buffet' then
    raise exception 'Venda direta não pode baixar saldo do Estoque Buffet.';
  end if;

  v_local := case new.origem
    when 'estoque' then 'loja'
    when 'estoque_geral' then 'geral'
    else null
  end;

  if not v_prod.permitir_estoque_negativo then
    v_saldo := public.saldo_estoque_local(v_prod.id, v_local);
    if v_saldo < new.quantidade then
      raise exception 'Saldo insuficiente no Estoque % para "%": disponível %, solicitado %.',
        case v_local when 'loja' then 'Normal' else 'Geral' end,
        v_prod.nome, v_saldo, new.quantidade;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists movimentacao_valida_produto on public.movimentacoes_estoque;
create trigger movimentacao_valida_produto
  before insert on public.movimentacoes_estoque
  for each row execute function public.validar_movimentacao_produto();

-- Uma trava por filial evita deadlocks entre vendas com os mesmos produtos em
-- ordens diferentes. O bloqueio por linha do produto serializa ainda compras e
-- movimentos manuais; saldo e venda permanecem na mesma transação.
create or replace function public.validar_item_venda_produto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.minha_organizacao();
  v_org_venda uuid;
  v_prod public.produtos%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':confirmar-venda', 0));

  select p.organization_id into v_org_venda
    from public.vendas v
    join public.profiles p on p.id = v.usuario_id and p.is_active
   where v.id = new.venda_id;
  if not found or v_org_venda is distinct from v_org then
    raise exception 'A venda não pertence à filial autenticada.'
      using errcode = '42501';
  end if;

  select p.* into v_prod
    from public.produtos p
   where p.id = new.produto_id
     and p.organization_id = v_org
   for update;
  if not found then
    raise exception 'Produto não encontrado nesta filial.'
      using errcode = '42501';
  end if;
  if not v_prod.ativo then
    raise exception 'O produto "%" está inativo e não pode ser vendido.', v_prod.nome;
  end if;

  return new;
end;
$$;

drop trigger if exists itens_venda_produto_filial_ativo on public.itens_venda;
create trigger itens_venda_produto_filial_ativo
  before insert on public.itens_venda
  for each row execute function public.validar_item_venda_produto();

-- A coluna quantidade é o cache do saldo normal. Produtos que explicitamente
-- permitem negativo podem manter o cache negativo; o padrão continua bloqueado.
alter table public.produtos
  drop constraint if exists produtos_quantidade_check,
  drop constraint if exists produtos_quantidade_nao_negativa;
alter table public.produtos
  add constraint produtos_quantidade_nao_negativa
  check (quantidade >= 0 or permitir_estoque_negativo);

create or replace function public.produtos_saldo_vem_do_livro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saldo numeric;
  v_org uuid := public.minha_organizacao();
begin
  if new.organization_id is null then
    new.organization_id := v_org;
  end if;
  if v_org is null or new.organization_id <> v_org then
    raise exception 'O produto não pode ser atribuído a outra filial.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.organization_id <> new.organization_id then
    raise exception 'A filial de um produto não pode ser alterada.';
  end if;
  if new.controla_estoque
     and new.local_estoque_origem <> 'buffet'
     and not exists (
       select 1
         from public.estoque_locais l
        where l.organization_id = new.organization_id
          and l.codigo = case new.local_estoque_origem
            when 'estoque' then 'loja'
            when 'estoque_geral' then 'geral'
          end
          and l.ativo
     ) then
    raise exception 'O local de estoque precisa estar ativo nesta filial.';
  end if;

  v_saldo := public.saldo_estoque(new.id);
  if v_saldo < 0 and not new.permitir_estoque_negativo then
    raise exception
      'Saldo insuficiente para "%": o livro-razão fecharia em % %. Registre a entrada antes de dar esta saída.',
      new.nome, v_saldo, new.unidade;
  end if;

  new.quantidade := v_saldo;
  return new;
end;
$$;

drop policy if exists produtos_leitura on public.produtos;
create policy produtos_leitura on public.produtos
  for select to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'consultar'))
  );

drop policy if exists produtos_criacao on public.produtos;
create policy produtos_criacao on public.produtos
  for insert to authenticated
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'criar'))
  );

drop policy if exists produtos_edicao on public.produtos;
create policy produtos_edicao on public.produtos
  for update to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'editar'))
  )
  with check (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'editar'))
  );

drop policy if exists produtos_exclusao on public.produtos;
create policy produtos_exclusao on public.produtos
  for delete to authenticated
  using (
    organization_id = (select public.minha_organizacao())
    and (select public.pode('estoque', 'excluir'))
  );

-- Mantém a RPC de imagem compatível com os novos campos do cadastro.
create or replace function public.salvar_produto_com_imagem(
  p_produto jsonb,
  p_mime text default null,
  p_conteudo bytea default null,
  p_remover_imagem boolean default false
)
returns public.produtos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_produto public.produtos;
  v_id uuid := nullif(p_produto ->> 'id', '')::uuid;
begin
  if v_id is null then
    insert into public.produtos (
      codigo, nome, descricao, categoria, quantidade, minimo, unidade,
      custo, preco, ativo, tipo_venda, controla_estoque, metodo_estoque,
      metodo_peso, tipo_produto, regra_baixa_estoque, local_estoque_origem,
      permitir_estoque_negativo
    )
    values (
      p_produto ->> 'codigo', p_produto ->> 'nome',
      nullif(p_produto ->> 'descricao', ''), p_produto ->> 'categoria', 0,
      coalesce(nullif(p_produto ->> 'minimo', '')::numeric, 0),
      coalesce(nullif(p_produto ->> 'unidade', ''), 'un'),
      coalesce(nullif(p_produto ->> 'custo', '')::numeric, 0),
      coalesce(nullif(p_produto ->> 'preco', '')::numeric, 0),
      coalesce((p_produto ->> 'ativo')::boolean, true),
      coalesce(nullif(p_produto ->> 'tipo_venda', ''), 'unidade'),
      coalesce((p_produto ->> 'controla_estoque')::boolean, true),
      coalesce(nullif(p_produto ->> 'metodo_estoque', ''), 'movimentacoes'),
      nullif(p_produto ->> 'metodo_peso', ''),
      coalesce(nullif(p_produto ->> 'tipo_produto', ''), 'outro'),
      coalesce(nullif(p_produto ->> 'regra_baixa_estoque', ''), 'legada'),
      coalesce(nullif(p_produto ->> 'local_estoque_origem', ''), 'estoque'),
      coalesce((p_produto ->> 'permitir_estoque_negativo')::boolean, false)
    )
    returning * into v_produto;
  else
    update public.produtos
       set codigo = p_produto ->> 'codigo',
           nome = p_produto ->> 'nome',
           descricao = nullif(p_produto ->> 'descricao', ''),
           categoria = p_produto ->> 'categoria',
           minimo = coalesce(nullif(p_produto ->> 'minimo', '')::numeric, 0),
           unidade = coalesce(nullif(p_produto ->> 'unidade', ''), 'un'),
           custo = coalesce(nullif(p_produto ->> 'custo', '')::numeric, 0),
           preco = coalesce(nullif(p_produto ->> 'preco', '')::numeric, 0),
           ativo = coalesce((p_produto ->> 'ativo')::boolean, true),
           tipo_venda = coalesce(nullif(p_produto ->> 'tipo_venda', ''), 'unidade'),
           controla_estoque = coalesce((p_produto ->> 'controla_estoque')::boolean, true),
           metodo_estoque = coalesce(nullif(p_produto ->> 'metodo_estoque', ''), 'movimentacoes'),
           metodo_peso = nullif(p_produto ->> 'metodo_peso', ''),
           tipo_produto = coalesce(nullif(p_produto ->> 'tipo_produto', ''), 'outro'),
           regra_baixa_estoque = coalesce(nullif(p_produto ->> 'regra_baixa_estoque', ''), 'legada'),
           local_estoque_origem = coalesce(nullif(p_produto ->> 'local_estoque_origem', ''), 'estoque'),
           permitir_estoque_negativo = coalesce((p_produto ->> 'permitir_estoque_negativo')::boolean, false)
     where id = v_id
     returning * into v_produto;

    if not found then
      raise exception 'Produto não encontrado ou sem permissão para edição.';
    end if;
  end if;

  if p_remover_imagem then
    delete from public.imagens_produtos where produto_id = v_produto.id;
  elsif p_mime is not null or p_conteudo is not null then
    if p_mime not in ('image/jpeg', 'image/png', 'image/webp')
       or p_conteudo is null
       or octet_length(p_conteudo) not between 1 and 524288 then
      raise exception 'Imagem inválida: formato não permitido ou tamanho acima de 512 KiB.';
    end if;

    insert into public.imagens_produtos (produto_id, mime, conteudo)
    values (v_produto.id, p_mime, p_conteudo)
    on conflict (produto_id) do update
      set mime = excluded.mime,
          conteudo = excluded.conteudo,
          atualizado_em = now();
  end if;

  return v_produto;
end;
$$;

comment on column public.produtos.organization_id is
  'Filial/organização proprietária do produto e de seu saldo de estoque.';
comment on column public.produtos.tipo_produto is
  'Classificação operacional: venda direta, buffet, insumo, embalagem ou outro.';
comment on column public.produtos.regra_baixa_estoque is
  'Política por produto para a baixa de vendas. Registros legados mantêm a regra anterior.';
comment on column public.movimentacoes_estoque.unidade is
  'Unidade fotografada no momento do movimento; não muda quando o cadastro é editado.';

revoke all on function public.validar_movimentacao_produto() from public, anonymous;
revoke all on function public.validar_item_venda_produto() from public, anonymous;
grant execute on function public.validar_movimentacao_produto() to authenticated;
grant execute on function public.validar_item_venda_produto() to authenticated;
