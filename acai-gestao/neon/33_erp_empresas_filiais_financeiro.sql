-- ============================================================================
-- 33 - ERP: empresas, filiais, depositos, recebimentos e financeiro integrado
-- ============================================================================
-- Migracao ADITIVA. Nao apaga dados, nao troca o significado das tabelas
-- existentes e pode ser reexecutada.
--
-- O que entra:
--   * empresas -> filiais -> depositos (a organizacao continua sendo o tenant);
--   * dimensao de filial/deposito nos lancamentos operacionais;
--   * recebimentos de compra rastreaveis, ligados ao item e ao movimento;
--   * contas a pagar e a receber (titulos + parcelas + baixas);
--   * pagamentos de venda (inclusive mistos) e sessoes de caixa;
--   * plano de contas, fichas tecnicas e views de leitura;
--   * integracao transacional: receber compra gera conta a pagar; vender gera
--     conta a receber e, quando liquidada, um lancamento de caixa.
--
-- O que NAO muda:
--   * `vendas`, `compras`, `movimentacoes_estoque` e `lancamentos` continuam
--     funcionando com as colunas antigas;
--   * `registrar_venda()` e `confirmar_recebimento_compra()` continuam sendo as
--     portas transacionais; a 33 apenas acrescenta o rastro financeiro e de
--     recebimento.
--
-- IMPORTANTE: a 33 nao deve ser aplicada em producao sem backup e sem uma
-- janela de validacao. O validador local (PGlite) exercita a cadeia inteira.

-- ============================================================================
-- 1. Empresas, filiais e depositos
-- ============================================================================
create table if not exists public.empresas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations(id) on delete restrict,
  codigo          text not null check (char_length(btrim(codigo)) between 1 and 40),
  nome            text not null check (char_length(btrim(nome)) between 1 and 120),
  razao_social    text,
  cnpj            text,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (organization_id, codigo),
  unique (id, organization_id)
);

create table if not exists public.filiais (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations(id) on delete restrict,
  empresa_id      uuid not null,
  codigo          text not null check (char_length(btrim(codigo)) between 1 and 40),
  nome            text not null check (char_length(btrim(nome)) between 1 and 120),
  tipo            text not null default 'filial'
                    check (tipo in ('matriz', 'filial', 'quiosque', 'cd')),
  cnpj            text,
  endereco        text,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (organization_id, codigo),
  unique (id, organization_id),
  foreign key (empresa_id, organization_id)
    references public.empresas (id, organization_id) on delete restrict
);

create table if not exists public.depositos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations(id) on delete restrict,
  filial_id       uuid not null,
  codigo          text not null check (char_length(btrim(codigo)) between 1 and 40),
  nome            text not null check (char_length(btrim(nome)) between 1 and 120),
  tipo            text not null default 'estoque'
                    check (tipo in ('estoque', 'loja', 'buffet', 'preparacao',
                                    'producao', 'perda', 'transito')),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  unique (filial_id, codigo),
  unique (id, organization_id),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

-- A coluna fica anulavel para nao quebrar o app antigo. O trigger abaixo
-- preenche a filial padrao em toda insercao nova.
alter table public.profiles          add column if not exists filial_id uuid;
alter table public.estoque_locais    add column if not exists filial_id uuid;
alter table public.estoque_locais    add column if not exists deposito_id uuid;
alter table public.vendas            add column if not exists filial_id uuid;
alter table public.itens_venda       add column if not exists filial_id uuid;
alter table public.venda_detalhes    add column if not exists filial_id uuid;
alter table public.compras           add column if not exists filial_id uuid;
alter table public.movimentacoes_estoque add column if not exists filial_id uuid;
alter table public.transferencias_estoque add column if not exists filial_id uuid;
alter table public.lancamentos       add column if not exists filial_id uuid;
alter table public.lancamentos       add column if not exists plano_conta_id uuid;
alter table public.lancamentos       add column if not exists origem_tipo text;
alter table public.lancamentos       add column if not exists origem_id uuid;
alter table public.lancamentos       add column if not exists natureza text;
alter table public.lancamentos       add column if not exists chave_idempotencia text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_filial_fk'
  ) then
    alter table public.profiles
      add constraint profiles_filial_fk foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'estoque_locais_filial_fk'
  ) then
    alter table public.estoque_locais
      add constraint estoque_locais_filial_fk foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'estoque_locais_deposito_fk'
  ) then
    alter table public.estoque_locais
      add constraint estoque_locais_deposito_fk foreign key (deposito_id, organization_id)
      references public.depositos (id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vendas_filial_fk'
  ) then
    alter table public.vendas
      add constraint vendas_filial_fk foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'itens_venda_filial_fk'
  ) then
    alter table public.itens_venda
      add constraint itens_venda_filial_fk foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'venda_detalhes_filial_fk'
  ) then
    alter table public.venda_detalhes
      add constraint venda_detalhes_filial_fk foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'compras_filial_fk'
  ) then
    alter table public.compras
      add constraint compras_filial_fk foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'movimentacoes_estoque_filial_fk'
  ) then
    alter table public.movimentacoes_estoque
      add constraint movimentacoes_estoque_filial_fk foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'transferencias_estoque_filial_fk'
  ) then
    alter table public.transferencias_estoque
      add constraint transferencias_estoque_filial_fk foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'lancamentos_filial_fk'
  ) then
    alter table public.lancamentos
      add constraint lancamentos_filial_fk foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete restrict;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Estrutura padrao: toda organizacao existente ganha uma empresa e uma filial.
-- Isso e idempotente e nao restringe as organizacoes que ainda nao passaram
-- pelo cadastro de filiais.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org     uuid;
  v_empresa uuid;
  v_filial  uuid;
  v_local   record;
begin
  for v_org in select id from public.organizations loop
    insert into public.empresas (organization_id, codigo, nome, razao_social)
    select v_org, 'MATRIZ', o.nome, o.nome
      from public.organizations o
     where o.id = v_org
    on conflict (organization_id, codigo) do nothing;

    select id into v_empresa
      from public.empresas
     where organization_id = v_org and codigo = 'MATRIZ';

    insert into public.filiais (organization_id, empresa_id, codigo, nome, tipo)
    values (v_org, v_empresa, 'MATRIZ', 'Matriz', 'matriz')
    on conflict (organization_id, codigo) do nothing;

    select id into v_filial
      from public.filiais
     where organization_id = v_org and codigo = 'MATRIZ';

    update public.estoque_locais
       set filial_id = v_filial
     where organization_id = v_org and filial_id is null;

    for v_local in
      select codigo, nome
        from public.estoque_locais
       where organization_id = v_org
    loop
      insert into public.depositos (organization_id, filial_id, codigo, nome, tipo)
      values (
        v_org,
        v_filial,
        v_local.codigo,
        v_local.nome,
        case v_local.codigo
          when 'loja' then 'loja'
          when 'geral' then 'estoque'
          when 'buffet' then 'buffet'
          when 'preparacao' then 'preparacao'
          when 'producao' then 'producao'
          else 'estoque'
        end
      )
      on conflict (filial_id, codigo) do nothing;
    end loop;

    update public.estoque_locais l
       set deposito_id = d.id
      from public.depositos d
     where l.organization_id = v_org
       and l.filial_id = v_filial
       and d.organization_id = v_org
       and d.filial_id = v_filial
       and d.codigo = l.codigo
       and l.deposito_id is null;

    -- Dados antigos recebem a filial padrao. A operacao nova e preenchida por
    -- trigger; a coluna continua anulavel para compatibilidade.
    update public.vendas set filial_id = v_filial
     where organization_id = v_org and filial_id is null;
    update public.itens_venda set filial_id = v_filial
     where organization_id = v_org and filial_id is null;
    update public.venda_detalhes set filial_id = v_filial
     where organization_id = v_org and filial_id is null;
    update public.compras set filial_id = v_filial
     where organization_id = v_org and filial_id is null;
    update public.lancamentos set filial_id = v_filial
     where organization_id = v_org and filial_id is null;
    update public.transferencias_estoque set filial_id = v_filial
     where organization_id = v_org and filial_id is null;
  end loop;
end
$$;

create index if not exists idx_filiais_org on public.filiais (organization_id, ativo);
create index if not exists idx_depositos_filial on public.depositos (filial_id, ativo);create index if not exists idx_vendas_filial on public.vendas (filial_id, criado_em desc);
create index if not exists idx_compras_filial on public.compras (filial_id, data_compra desc);
create index if not exists idx_movimentos_filial on public.movimentacoes_estoque (filial_id, criado_em desc);
create index if not exists idx_lancamentos_filial on public.lancamentos (filial_id, data desc);

create or replace function public.criar_depositos_da_filial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.depositos (organization_id, filial_id, codigo, nome, tipo)
  values
    (new.organization_id, new.id, 'loja', 'Loja', 'loja'),
    (new.organization_id, new.id, 'geral', 'Estoque geral', 'estoque'),
    (new.organization_id, new.id, 'buffet', 'Buffet', 'buffet'),
    (new.organization_id, new.id, 'preparacao', 'Preparação', 'preparacao'),
    (new.organization_id, new.id, 'producao', 'Produção', 'producao')
  on conflict (filial_id, codigo) do nothing;
  return new;
end;
$$;

drop trigger if exists criar_depositos_da_filial on public.filiais;
create trigger criar_depositos_da_filial
  after insert on public.filiais
  for each row execute function public.criar_depositos_da_filial();

create or replace function public.filial_padrao(p_organization_id uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.id
    from public.filiais f
   where f.organization_id = coalesce(p_organization_id, public.minha_organizacao())
     and f.ativo
   order by (f.tipo = 'matriz') desc, f.codigo, f.criado_em
   limit 1
$$;

create or replace function public.deposito_por_codigo(
  p_organization_id uuid,
  p_filial_id uuid,
  p_codigo text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
    from public.depositos d
   where d.organization_id = p_organization_id
     and d.filial_id = p_filial_id
     and d.codigo = case p_codigo
       when 'estoque' then 'loja'
       when 'estoque_geral' then 'geral'
       else p_codigo
     end
     and d.ativo
   limit 1
$$;

-- Trigger unico para movimentos: preenche filial, resolve os dois depositos e
-- preserva os textos antigos (`origem`/`destino`) que o app e as views usam.
create or replace function public.preencher_contexto_movimento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.filial_id is null then
    new.filial_id := public.filial_padrao(new.organization_id);
  end if;

  new.origem_deposito_id := coalesce(
    new.origem_deposito_id,
    public.deposito_por_codigo(new.organization_id, new.filial_id, new.origem)
  );
  new.destino_deposito_id := coalesce(
    new.destino_deposito_id,
    public.deposito_por_codigo(new.organization_id, new.filial_id, new.destino)
  );

  return new;
end;
$$;

alter table public.movimentacoes_estoque
  add column if not exists origem_deposito_id uuid,
  add column if not exists destino_deposito_id uuid,
  add column if not exists recebimento_compra_id uuid,
  add column if not exists recebimento_item_id uuid,
  add column if not exists compra_id uuid,
  add column if not exists compra_item_id uuid,
  add column if not exists custo_unitario numeric(14, 4),
  add column if not exists valor_total numeric(14, 2),
  add column if not exists documento_tipo text,
  add column if not exists documento_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'movimentos_origem_deposito_fk'
  ) then
    alter table public.movimentacoes_estoque
      add constraint movimentos_origem_deposito_fk
      foreign key (origem_deposito_id, organization_id)
      references public.depositos (id, organization_id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'movimentos_destino_deposito_fk'
  ) then
    alter table public.movimentacoes_estoque
      add constraint movimentos_destino_deposito_fk
      foreign key (destino_deposito_id, organization_id)
      references public.depositos (id, organization_id) on delete restrict;
  end if;
end
$$;

create index if not exists idx_movimentos_origem_deposito
  on public.movimentacoes_estoque (origem_deposito_id)
  where origem_deposito_id is not null;
create index if not exists idx_movimentos_destino_deposito
  on public.movimentacoes_estoque (destino_deposito_id)
  where destino_deposito_id is not null;
create index if not exists idx_movimentos_compra
  on public.movimentacoes_estoque (compra_id)
  where compra_id is not null;

drop trigger if exists preencher_contexto_movimento on public.movimentacoes_estoque;
create trigger preencher_contexto_movimento
  before insert on public.movimentacoes_estoque
  for each row execute function public.preencher_contexto_movimento();

-- Filial padrao nas demais tabelas transacionais.
create or replace function public.preencher_filial_padrao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.filial_id is null then
    new.filial_id := public.filial_padrao(new.organization_id);
  end if;
  return new;
end;
$$;

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array[
    'vendas', 'itens_venda', 'venda_detalhes', 'compras',
    'transferencias_estoque', 'lancamentos'
  ] loop
    execute format('drop trigger if exists preencher_filial_padrao on public.%I', v_tabela);
    execute format(
      'create trigger preencher_filial_padrao before insert on public.%I
       for each row execute function public.preencher_filial_padrao()',
      v_tabela
    );
  end loop;
end
$$;

-- ============================================================================
-- 2. Recebimentos de compra
-- ============================================================================
create sequence if not exists public.recebimentos_compra_numero_seq;

create table if not exists public.recebimentos_compra (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.minha_organizacao()
                      references public.organizations(id) on delete restrict,
  filial_id         uuid not null,
  compra_id         uuid not null references public.compras(id) on delete restrict,
  numero            text not null,
  data_recebimento  date not null default current_date,
  valor_total       numeric(14, 2) not null default 0 check (valor_total >= 0),
  observacoes       text not null default '',
  usuario_id        uuid references public.profiles(id) on delete set null,
  criado_em         timestamptz not null default now(),
  unique (organization_id, numero),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

create table if not exists public.recebimentos_compra_itens (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default public.minha_organizacao()
                          references public.organizations(id) on delete restrict,
  filial_id             uuid not null,
  recebimento_id        uuid not null references public.recebimentos_compra(id) on delete cascade,
  compra_item_id        uuid not null references public.compras_itens(id) on delete restrict,
  produto_id            uuid not null references public.produtos(id) on delete restrict,
  quantidade_compra     numeric(14, 3) not null check (quantidade_compra > 0),
  fator_conversao       numeric(14, 4) not null default 1 check (fator_conversao > 0),
  quantidade_base       numeric(14, 3) not null check (quantidade_base > 0),
  custo_unitario        numeric(14, 4) not null default 0 check (custo_unitario >= 0),
  valor                 numeric(14, 2) not null default 0 check (valor >= 0),
  lote                  text,
  validade              date,
  movimento_id          uuid references public.movimentacoes_estoque(id) on delete restrict,
  criado_em             timestamptz not null default now(),
  unique (recebimento_id, compra_item_id),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

alter table public.recebimentos_compra_itens
  add column if not exists filial_id uuid;

update public.recebimentos_compra_itens i
   set filial_id = r.filial_id
  from public.recebimentos_compra r
 where i.recebimento_id = r.id
   and i.filial_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'recebimentos_itens_filial_fk'
  ) then
    alter table public.recebimentos_compra_itens
      add constraint recebimentos_itens_filial_fk
      foreign key (filial_id, organization_id)
      references public.filiais (id, organization_id) on delete restrict;
  end if;
end
$$;

create index if not exists idx_recebimentos_compra_compra
  on public.recebimentos_compra (compra_id, data_recebimento desc);
create index if not exists idx_recebimentos_compra_itens_receb
  on public.recebimentos_compra_itens (recebimento_id);
create index if not exists idx_movimentos_recebimento
  on public.movimentacoes_estoque (recebimento_compra_id)
  where recebimento_compra_id is not null;

-- Um item de recebimento gera no maximo um movimento. O indice e a garantia
-- contra dupla contagem mesmo se alguma rotina futura tentar repetir.
create unique index if not exists movimentos_recebimento_item_unico
  on public.movimentacoes_estoque (recebimento_item_id)
  where recebimento_item_id is not null;

-- ============================================================================
-- 3. Plano de contas, titulos, parcelas e baixas
-- ============================================================================
create table if not exists public.plano_contas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations(id) on delete restrict,
  codigo          text not null,
  nome            text not null,
  natureza        text not null check (natureza in (
                    'receita', 'custo', 'despesa', 'ativo', 'passivo', 'patrimonio'
                  )),
  tipo            text not null default 'analitica'
                    check (tipo in ('sintetica', 'analitica')),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  unique (organization_id, codigo)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lancamentos_plano_conta_fk'
  ) then
    alter table public.lancamentos
      add constraint lancamentos_plano_conta_fk
      foreign key (plano_conta_id) references public.plano_contas(id)
      on delete set null;
  end if;
end
$$;

drop index if exists public.lancamentos_chave_idempotencia_unica;
create unique index lancamentos_chave_idempotencia_unica
  on public.lancamentos (organization_id, chave_idempotencia);

create table if not exists public.titulos_financeiros (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.minha_organizacao()
                      references public.organizations(id) on delete restrict,
  filial_id         uuid not null,
  tipo              text not null check (tipo in ('receber', 'pagar')),
  origem_tipo       text not null check (origem_tipo in (
                      'venda', 'recebimento_compra', 'compra', 'manual', 'outro'
                    )),
  origem_id         uuid,
  numero            text not null,
  descricao         text not null,
  plano_conta_id    uuid references public.plano_contas(id) on delete set null,
  cliente_id        uuid references public.clientes(id) on delete set null,
  fornecedor_id     uuid references public.fornecedores(id) on delete set null,
  data_emissao      date not null default current_date,
  data_competencia  date not null default current_date,
  data_vencimento   date not null default current_date,
  valor_original    numeric(14, 2) not null check (valor_original > 0),
  valor_liquidado   numeric(14, 2) not null default 0
                      check (valor_liquidado >= 0 and valor_liquidado <= valor_original),
  status            text not null default 'aberto'
                      check (status in ('aberto', 'parcial', 'liquidado', 'cancelado')),
  observacoes       text not null default '',
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (organization_id, origem_tipo, origem_id, tipo),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

create table if not exists public.parcelas_financeiras (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.minha_organizacao()
                      references public.organizations(id) on delete restrict,
  filial_id         uuid not null,
  titulo_id         uuid not null references public.titulos_financeiros(id) on delete cascade,
  numero            integer not null default 1 check (numero > 0),
  vencimento        date not null,
  valor             numeric(14, 2) not null check (valor > 0),
  valor_liquidado   numeric(14, 2) not null default 0
                      check (valor_liquidado >= 0 and valor_liquidado <= valor),
  status            text not null default 'aberto'
                      check (status in ('aberto', 'parcial', 'liquidado', 'cancelado')),
  criado_em         timestamptz not null default now(),
  unique (titulo_id, numero),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

create table if not exists public.baixas_financeiras (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.minha_organizacao()
                      references public.organizations(id) on delete restrict,
  filial_id         uuid not null,
  parcela_id        uuid not null references public.parcelas_financeiras(id) on delete restrict,
  tipo              text not null check (tipo in (
                      'recebimento', 'pagamento', 'estorno_recebimento',
                      'estorno_pagamento'
                    )),
  valor             numeric(14, 2) not null check (valor > 0),
  data              date not null default current_date,
  forma_pagamento_id uuid references public.formas_pagamento(id) on delete set null,
  forma              text,
  observacoes       text not null default '',
  chave_idempotencia text,
  baixa_original_id uuid references public.baixas_financeiras(id) on delete set null,
  criado_por        uuid references public.profiles(id) on delete set null,
  criado_em         timestamptz not null default now(),
  unique (organization_id, chave_idempotencia),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

create table if not exists public.venda_pagamentos (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.minha_organizacao()
                      references public.organizations(id) on delete restrict,
  filial_id         uuid not null,
  venda_id          uuid not null references public.vendas(id) on delete restrict,
  forma_pagamento_id uuid references public.formas_pagamento(id) on delete set null,
  forma             text not null,
  valor             numeric(14, 2) not null check (valor > 0),
  valor_recebido    numeric(14, 2),
  troco             numeric(14, 2) not null default 0,
  status            text not null default 'pendente'
                      check (status in ('pendente', 'confirmado', 'estornado')),
  confirmado_em     timestamptz,
  criado_em         timestamptz not null default now(),
  unique (venda_id, forma, valor),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

create table if not exists public.caixas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations(id) on delete restrict,
  filial_id       uuid not null,
  codigo          text not null,
  nome            text not null,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  unique (filial_id, codigo),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

create table if not exists public.sessoes_caixa (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.minha_organizacao()
                      references public.organizations(id) on delete restrict,
  filial_id         uuid not null,
  caixa_id          uuid not null references public.caixas(id) on delete restrict,
  status            text not null default 'aberta'
                      check (status in ('aberta', 'fechada')),
  aberta_por        uuid references public.profiles(id) on delete set null,
  aberta_em         timestamptz not null default now(),
  valor_abertura    numeric(14, 2) not null default 0 check (valor_abertura >= 0),
  fechada_por       uuid references public.profiles(id) on delete set null,
  fechada_em        timestamptz,
  valor_fechamento  numeric(14, 2),
  observacoes       text not null default '',
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

create table if not exists public.movimentos_caixa (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default public.minha_organizacao()
                      references public.organizations(id) on delete restrict,
  filial_id         uuid not null,
  sessao_id         uuid not null references public.sessoes_caixa(id) on delete restrict,
  tipo              text not null check (tipo in ('abertura', 'venda', 'sangria', 'suprimento', 'despesa', 'fechamento')),
  valor             numeric(14, 2) not null,
  descricao         text not null default '',
  origem_tipo       text,
  origem_id         uuid,
  criado_por        uuid references public.profiles(id) on delete set null,
  criado_em         timestamptz not null default now(),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

create index if not exists idx_titulos_org_status
  on public.titulos_financeiros (organization_id, tipo, status, data_vencimento);
create index if not exists idx_titulos_origem
  on public.titulos_financeiros (organization_id, origem_tipo, origem_id);
create index if not exists idx_parcelas_titulo on public.parcelas_financeiras (titulo_id, numero);
create index if not exists idx_parcelas_vencimento on public.parcelas_financeiras (vencimento, status);
create index if not exists idx_baixas_parcela on public.baixas_financeiras (parcela_id, data);
create index if not exists idx_venda_pagamentos_venda on public.venda_pagamentos (venda_id);
create index if not exists idx_sessoes_caixa_filial on public.sessoes_caixa (filial_id, status);
create index if not exists idx_movimentos_caixa_sessao on public.movimentos_caixa (sessao_id, criado_em);

-- Categorias minimas. Se a organizacao ja tiver o codigo, nao sobrescreve.
insert into public.plano_contas (organization_id, codigo, nome, natureza, tipo)
select o.id, c.codigo, c.nome, c.natureza, 'analitica'
  from public.organizations o
 cross join (values
   ('1.1', 'Caixa e bancos', 'ativo'),
   ('2.1', 'Fornecedores a pagar', 'passivo'),
   ('2.2', 'Clientes a receber', 'ativo'),
   ('3.1', 'Receita de vendas', 'receita'),
   ('3.2', 'Outras receitas', 'receita'),
   ('4.1', 'Custo das mercadorias vendidas', 'custo'),
   ('5.1', 'Despesas operacionais', 'despesa')
 ) as c(codigo, nome, natureza)
on conflict (organization_id, codigo) do nothing;

-- ---------------------------------------------------------------------------
-- 3.1 Parcela automatica: todo titulo nasce com uma parcela unica. Titulos
--     parcelados podem receber parcelas extras pela rotina financeira.
-- ---------------------------------------------------------------------------
create or replace function public.criar_parcela_do_titulo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.parcelas_financeiras p where p.titulo_id = new.id
  ) then
    insert into public.parcelas_financeiras
      (organization_id, filial_id, titulo_id, numero, vencimento, valor)
    values
      (new.organization_id, new.filial_id, new.id, 1, new.data_vencimento, new.valor_original);
  end if;

  return new;
end;
$$;

drop trigger if exists criar_parcela_do_titulo on public.titulos_financeiros;
create trigger criar_parcela_do_titulo
  after insert on public.titulos_financeiros
  for each row execute function public.criar_parcela_do_titulo();

create or replace function public.recalcular_titulo_financeiro(p_titulo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total     numeric(14, 2);
  v_liquidado numeric(14, 2);
  v_aberto    integer;
  v_status    text;
begin
  select t.valor_original into v_total
    from public.titulos_financeiros t
   where t.id = p_titulo_id;

  if v_total is null then
    return;
  end if;

  select
    coalesce(sum(p.valor_liquidado), 0),
    count(*) filter (where p.status in ('aberto', 'parcial')),
    coalesce(sum(p.valor), 0)
    into v_liquidado, v_aberto, v_total
    from public.parcelas_financeiras p
   where p.titulo_id = p_titulo_id;

  v_status := case
    when v_liquidado <= 0.0001 then 'aberto'
    when v_liquidado + 0.0001 >= v_total then 'liquidado'
    else 'parcial'
  end;

  if v_aberto = 0 and v_liquidado <= 0.0001 then
    v_status := 'aberto';
  end if;

  update public.titulos_financeiros
     set valor_liquidado = least(v_liquidado, valor_original),
         status = case when status = 'cancelado' then 'cancelado' else v_status end,
         atualizado_em = now()
   where id = p_titulo_id;
end;
$$;

create or replace function public.atualizar_status_parcela()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.status := case
    when new.valor_liquidado <= 0.0001 then 'aberto'
    when new.valor_liquidado + 0.0001 >= new.valor then 'liquidado'
    else 'parcial'
  end;
  return new;
end;
$$;

drop trigger if exists atualizar_status_parcela on public.parcelas_financeiras;
create trigger atualizar_status_parcela
  before insert or update of valor_liquidado on public.parcelas_financeiras
  for each row execute function public.atualizar_status_parcela();

create or replace function public.after_parcela_financeira()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recalcular_titulo_financeiro(coalesce(new.titulo_id, old.titulo_id));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists after_parcela_financeira on public.parcelas_financeiras;
create trigger after_parcela_financeira
  after insert or update of valor_liquidado or delete on public.parcelas_financeiras
  for each row execute function public.after_parcela_financeira();

-- ---------------------------------------------------------------------------
-- 3.2 Baixa: atualiza a parcela/titulo e escreve UM lancamento de caixa.
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_baixa_financeira()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parcela public.parcelas_financeiras%rowtype;
  v_titulo  public.titulos_financeiros%rowtype;
  v_saldo   numeric(14, 2);
  v_entrada boolean;
  v_natureza text;
  v_categoria text;
begin
  select * into v_parcela
    from public.parcelas_financeiras
   where id = new.parcela_id
     and organization_id = new.organization_id
   for update;

  if not found then
    raise exception 'Parcela financeira nao encontrada.';
  end if;

  select * into v_titulo
    from public.titulos_financeiros
   where id = v_parcela.titulo_id
     and organization_id = new.organization_id
   for update;

  if not found then
    raise exception 'Titulo financeiro nao encontrado.';
  end if;

  if v_titulo.status = 'cancelado' then
    raise exception 'Titulo cancelado nao recebe baixa.';
  end if;

  v_saldo := round(v_parcela.valor - v_parcela.valor_liquidado, 2);

  if new.tipo in ('recebimento', 'pagamento') then
    if new.valor > v_saldo + 0.0001 then
      raise exception 'A baixa de % ultrapassa o saldo de % da parcela.', new.valor, v_saldo;
    end if;

    update public.parcelas_financeiras
       set valor_liquidado = round(valor_liquidado + new.valor, 2)
     where id = v_parcela.id;
  else
    if new.valor > v_parcela.valor_liquidado + 0.0001 then
      raise exception 'O estorno de % ultrapassa o valor ja baixado (%).', new.valor, v_parcela.valor_liquidado;
    end if;

    update public.parcelas_financeiras
       set valor_liquidado = round(valor_liquidado - new.valor, 2)
     where id = v_parcela.id;
  end if;

  v_entrada := case
    when new.tipo in ('recebimento', 'estorno_pagamento') then v_titulo.tipo = 'receber'
    when new.tipo in ('pagamento', 'estorno_recebimento') then v_titulo.tipo <> 'receber'
    else false
  end;

  -- Recebimento de venda entra no caixa; pagamento de compra sai. Estornos
  -- invertem o sentido sem criar uma segunda despesa/receita.
  if v_titulo.tipo = 'receber' then
    v_entrada := new.tipo = 'recebimento' or new.tipo = 'estorno_pagamento';
  else
    v_entrada := not (new.tipo = 'pagamento' or new.tipo = 'estorno_recebimento');
  end if;

  select p.nome into v_categoria
    from public.plano_contas p
   where p.id = v_titulo.plano_conta_id;

  v_natureza := case
    when new.tipo = 'recebimento' then 'recebimento'
    when new.tipo = 'pagamento' then 'pagamento'
    else 'estorno'
  end;

  insert into public.lancamentos
    (organization_id, filial_id, descricao, categoria, tipo, valor, forma, data,
     origem_tipo, origem_id, natureza, chave_idempotencia)
  values
    (new.organization_id, new.filial_id, v_titulo.descricao,
     coalesce(v_categoria, case when v_titulo.tipo = 'receber' then 'Vendas' else 'Fornecedores' end),
     case when v_entrada then 'entrada' else 'saida' end,
     new.valor, coalesce(new.forma, '—'), new.data,
     'baixa', new.id, v_natureza, 'baixa:' || new.id::text)
  on conflict (organization_id, chave_idempotencia) do nothing;

  return new;
end;
$$;

drop trigger if exists aplicar_baixa_financeira on public.baixas_financeiras;
create trigger aplicar_baixa_financeira
  after insert on public.baixas_financeiras
  for each row execute function public.aplicar_baixa_financeira();

-- ============================================================================
-- 4. Integracao com vendas
-- ============================================================================
create or replace function public.saldo_parcela(p_parcela_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, round(p.valor - p.valor_liquidado, 2))
    from public.parcelas_financeiras p
   where p.id = p_parcela_id
$$;

create or replace function public.garantir_financeiro_venda(p_venda_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venda     public.vendas%rowtype;
  v_detalhe   public.venda_detalhes%rowtype;
  v_titulo    public.titulos_financeiros%rowtype;
  v_parcela   public.parcelas_financeiras%rowtype;
  v_forma_id  uuid;
  v_plano     uuid;
  v_filial    uuid;
  v_valor     numeric(14, 2);
  v_status    text;
  v_baixa     uuid;
begin
  select * into v_venda from public.vendas where id = p_venda_id;
  if not found then
    return null;
  end if;

  select * into v_detalhe from public.venda_detalhes where venda_id = p_venda_id;
  if not found then
    return null;
  end if;

  v_filial := coalesce(v_venda.filial_id, public.filial_padrao(v_venda.organization_id));
  v_valor := round(coalesce(v_detalhe.total_cobrado, v_venda.total), 2);

  if v_valor <= 0 then
    return null;
  end if;

  select id into v_plano
    from public.plano_contas
   where organization_id = v_venda.organization_id and codigo = '3.1';

  insert into public.titulos_financeiros
    (organization_id, filial_id, tipo, origem_tipo, origem_id, numero, descricao,
     plano_conta_id, cliente_id, data_emissao, data_competencia, data_vencimento,
     valor_original, status)
  values
    (v_venda.organization_id, v_filial, 'receber', 'venda', v_venda.id,
     'VR-' || v_venda.codigo,
     'Venda ' || v_venda.codigo || coalesce(' - ' || v_detalhe.tipo_venda_nome, ''),
     v_plano, v_venda.cliente_id,
     coalesce(v_venda.criado_em::date, current_date),
     coalesce(v_venda.criado_em::date, current_date),
     coalesce(v_venda.criado_em::date, current_date),
     v_valor,
     case when v_venda.status = 'Cancelada' or v_venda.estornada_em is not null
          then 'cancelado' else 'aberto' end)
  on conflict (organization_id, origem_tipo, origem_id, tipo) do nothing;

  select * into v_titulo
    from public.titulos_financeiros
   where organization_id = v_venda.organization_id
     and origem_tipo = 'venda'
     and origem_id = v_venda.id
     and tipo = 'receber';

  if not found then
    return null;
  end if;

  select id into v_forma_id
    from public.formas_pagamento
   where organization_id = v_venda.organization_id
     and (
       id = v_detalhe.forma_pagamento_id
       or (v_detalhe.forma_pagamento_id is null
           and lower(nome) = lower(v_detalhe.forma_pagamento_nome))
     )
   limit 1;

  insert into public.venda_pagamentos
    (organization_id, filial_id, venda_id, forma_pagamento_id, forma, valor,
     valor_recebido, troco, status, confirmado_em)
  values
    (v_venda.organization_id, v_filial, v_venda.id,
     v_detalhe.forma_pagamento_id, v_detalhe.forma_pagamento_nome, v_valor,
     v_detalhe.valor_recebido, v_detalhe.troco,
     case when v_venda.status = 'Concluída' and v_venda.estornada_em is null
          then 'confirmado' else 'pendente' end,
     case when v_venda.status = 'Concluída' and v_venda.estornada_em is null
          then now() else null end)
  on conflict (venda_id, forma, valor) do nothing;

  if v_venda.status = 'Cancelada' or v_venda.estornada_em is not null then
    update public.titulos_financeiros
       set status = 'cancelado', atualizado_em = now()
     where id = v_titulo.id;
    update public.parcelas_financeiras
       set status = 'cancelado'
     where titulo_id = v_titulo.id and valor_liquidado <= 0.0001;
    update public.venda_pagamentos
       set status = 'estornado'
     where venda_id = v_venda.id;
    return v_titulo.id;
  end if;

  if v_venda.status = 'Concluída' then
    select * into v_parcela
      from public.parcelas_financeiras
     where titulo_id = v_titulo.id and numero = 1;

    if found and public.saldo_parcela(v_parcela.id) > 0.0001
       and not exists (
         select 1 from public.baixas_financeiras b
          where b.organization_id = v_venda.organization_id
            and b.chave_idempotencia = 'venda:' || v_venda.id::text
       ) then
      insert into public.baixas_financeiras
        (organization_id, filial_id, parcela_id, tipo, valor, data,
         forma_pagamento_id, forma, chave_idempotencia, criado_por)
      values
        (v_venda.organization_id, v_filial, v_parcela.id, 'recebimento',
         public.saldo_parcela(v_parcela.id), coalesce(v_venda.criado_em::date, current_date),
         v_detalhe.forma_pagamento_id, v_detalhe.forma_pagamento_nome,
         'venda:' || v_venda.id::text, coalesce(v_venda.usuario_id, auth.uid()))
      returning id into v_baixa;
    end if;

    update public.venda_pagamentos
       set status = 'confirmado', confirmado_em = coalesce(confirmado_em, now())
     where venda_id = v_venda.id and status = 'pendente';
  end if;

  return v_titulo.id;
end;
$$;

create or replace function public.financeiro_venda_detalhe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.garantir_financeiro_venda(new.venda_id);
  return new;
end;
$$;

drop trigger if exists financeiro_venda_detalhe on public.venda_detalhes;
create trigger financeiro_venda_detalhe
  after insert on public.venda_detalhes
  for each row execute function public.financeiro_venda_detalhe();

create or replace function public.financeiro_venda_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estornada_em is not null or new.status = 'Cancelada' then
    perform public.cancelar_financeiro_venda(new.id);
  elsif new.status = 'Concluída' and old.status is distinct from 'Concluída' then
    perform public.garantir_financeiro_venda(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.cancelar_financeiro_venda(p_venda_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venda   public.vendas%rowtype;
  v_titulo  public.titulos_financeiros%rowtype;
  v_parcela public.parcelas_financeiras%rowtype;
  v_baixa   public.baixas_financeiras%rowtype;
  v_valor   numeric(14, 2);
begin
  select * into v_venda from public.vendas where id = p_venda_id;
  if not found then
    return;
  end if;

  select * into v_titulo
    from public.titulos_financeiros
   where organization_id = v_venda.organization_id
     and origem_tipo = 'venda'
     and origem_id = p_venda_id
     and tipo = 'receber';

  if not found then
    update public.venda_pagamentos set status = 'estornado' where venda_id = p_venda_id;
    return;
  end if;

  select * into v_parcela
    from public.parcelas_financeiras
   where titulo_id = v_titulo.id and numero = 1;

  if found and v_parcela.valor_liquidado > 0.0001 then
    select * into v_baixa
      from public.baixas_financeiras
     where organization_id = v_venda.organization_id
       and chave_idempotencia = 'estorno-venda:' || p_venda_id::text;

    if not found then
      insert into public.baixas_financeiras
        (organization_id, filial_id, parcela_id, tipo, valor, data,
         forma, observacoes, chave_idempotencia, criado_por)
      values
        (v_venda.organization_id, v_titulo.filial_id, v_parcela.id,
         'estorno_recebimento', v_parcela.valor_liquidado,
         coalesce(v_venda.estornada_em::date, current_date), 'Estorno',
         'Estorno da venda ' || v_venda.codigo,
         'estorno-venda:' || p_venda_id::text,
         coalesce(v_venda.estornada_por, auth.uid()));
    end if;
  end if;

  update public.titulos_financeiros
     set status = 'cancelado', atualizado_em = now()
   where id = v_titulo.id;

  update public.parcelas_financeiras
     set status = 'cancelado'
   where titulo_id = v_titulo.id and valor_liquidado <= 0.0001;

  update public.venda_pagamentos
     set status = 'estornado'
   where venda_id = p_venda_id;
end;
$$;

drop trigger if exists financeiro_venda_status on public.vendas;
create trigger financeiro_venda_status
  after update of status, estornada_em on public.vendas
  for each row execute function public.financeiro_venda_status();

-- ============================================================================
-- 5. Integracao com compras recebidas: conta a pagar por recebimento
-- ============================================================================
create or replace function public.garantir_financeiro_recebimento(p_recebimento_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec     public.recebimentos_compra%rowtype;
  v_compra  public.compras%rowtype;
  v_plano   uuid;
  v_titulo  public.titulos_financeiros%rowtype;
begin
  select * into v_rec from public.recebimentos_compra where id = p_recebimento_id;
  if not found then
    return null;
  end if;

  select * into v_compra from public.compras where id = v_rec.compra_id;

  if v_rec.valor_total <= 0.0001 then
    return null;
  end if;

  select id into v_plano
    from public.plano_contas
   where organization_id = v_rec.organization_id and codigo = '2.1';

  insert into public.titulos_financeiros
    (organization_id, filial_id, tipo, origem_tipo, origem_id, numero, descricao,
     plano_conta_id, fornecedor_id, data_emissao, data_competencia, data_vencimento,
     valor_original, status)
  values
    (v_rec.organization_id, v_rec.filial_id, 'pagar', 'recebimento_compra',
     v_rec.id, 'CP-' || v_rec.numero,
     'Recebimento ' || v_rec.numero || ' - compra ' || coalesce(v_compra.numero, ''),
     v_plano, v_compra.fornecedor_id,
     v_rec.data_recebimento, v_rec.data_recebimento,
     v_rec.data_recebimento + 30,
     v_rec.valor_total, 'aberto')
  on conflict (organization_id, origem_tipo, origem_id, tipo) do nothing;

  select * into v_titulo
    from public.titulos_financeiros
   where organization_id = v_rec.organization_id
     and origem_tipo = 'recebimento_compra'
     and origem_id = v_rec.id
     and tipo = 'pagar';

  return v_titulo.id;
end;
$$;

create or replace function public.financeiro_recebimento_compra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.garantir_financeiro_recebimento(new.id);
  return new;
end;
$$;

drop trigger if exists financeiro_recebimento_compra on public.recebimentos_compra;
create trigger financeiro_recebimento_compra
  after insert or update of valor_total on public.recebimentos_compra
  for each row execute function public.financeiro_recebimento_compra();

-- ---------------------------------------------------------------------------
-- 5.1 A RPC de recebimento passa a criar o recebimento rastreavel e a ligar
--     cada movimento ao item. O destino escolhido na tela (estoque, geral ou
--     buffet) deixa de ser ignorado. A funcao mantem a mesma assinatura e o
--     mesmo retorno da migracao 16.
-- ---------------------------------------------------------------------------
create or replace function public.confirmar_recebimento_compra(
  p_compra_id uuid,
  p_itens     jsonb
)
returns table (
  compra_id        uuid,
  status           text,
  data_recebimento date,
  itens_recebidos  integer,
  valor_recebido   numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario        uuid := auth.uid();
  v_org            uuid := public.minha_organizacao();
  v_compra         public.compras%rowtype;
  v_item           public.compras_itens%rowtype;
  v_entrada        jsonb;
  v_qtd            numeric;
  v_qtd_base       numeric;
  v_saldo          numeric;
  v_custo_atual    numeric;
  v_custo_novo     numeric;
  v_controla       boolean;
  v_subtotal_total numeric;
  v_sub_item       numeric;
  v_rateio         numeric;
  v_valor_item     numeric;
  v_motivo         text;
  v_total          numeric := 0;
  v_contador       integer := 0;
  v_todos          boolean;
  v_status         text;
  v_data           date;
  v_filial         uuid;
  v_recebimento_id uuid;
  v_recebimento_item_id uuid;
  v_movimento_id   uuid;
  v_local_destino  text;
  v_lote           text;
  v_validade       date;
  v_numero         text;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para confirmar o recebimento.';
  end if;

  if not public.pode('compras', 'editar') then
    raise exception 'Sua conta não tem permissão para confirmar recebimento de compras.'
      using errcode = '42501';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Informe pelo menos um item recebido.';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_itens) e
     group by e->>'item_id'
    having count(*) > 1
  ) then
    raise exception 'O mesmo item apareceu duas vezes no recebimento.';
  end if;

  -- Trava a compra: dois cliques simultâneos viram uma espera, e o segundo
  -- encontra o status já atualizado e é recusado.
  select * into v_compra
    from public.compras
   where id = p_compra_id
     and organization_id = v_org
   for update;

  if not found then
    raise exception 'Compra não encontrada.';
  end if;

  if v_compra.status = 'recebido_confirmado' then
    raise exception 'Esta compra já foi recebida e confirmada. Não é possível lançar uma segunda entrada.';
  end if;

  if v_compra.status = 'cancelado' then
    raise exception 'Compra cancelada não pode receber mercadoria.';
  end if;

  select coalesce(sum(ci.quantidade_solicitada * ci.custo_unitario - ci.desconto_valor), 0)
    into v_subtotal_total
    from public.compras_itens ci
   where ci.compra_id = p_compra_id;

  v_filial := coalesce(v_compra.filial_id, public.filial_padrao(v_org));
  v_numero := 'RC-' || lpad(nextval('public.recebimentos_compra_numero_seq')::text, 6, '0');

  insert into public.recebimentos_compra
    (organization_id, filial_id, compra_id, numero, data_recebimento, valor_total,
     observacoes, usuario_id)
  values
    (v_org, v_filial, p_compra_id, v_numero, current_date, 0,
     '', v_usuario)
  returning id into v_recebimento_id;

  for v_entrada in select * from jsonb_array_elements(p_itens)
  loop
    select ci.* into v_item
      from public.compras_itens ci
     where ci.id = (v_entrada->>'item_id')::uuid
       and ci.compra_id = p_compra_id
     for update;

    if not found then
      raise exception 'Item % não pertence a esta compra.',
        coalesce(v_entrada->>'item_id', '(sem identificação)');
    end if;

    if v_item.produto_id is null then
      raise exception 'O item "%" não tem produto vinculado ao estoque.', v_item.nome;
    end if;

    if v_item.quantidade_solicitada <= 0 then
      raise exception 'O item "%" está com quantidade zerada. Corrija a compra antes de receber.', v_item.nome;
    end if;

    v_qtd := coalesce((v_entrada->>'quantidade')::numeric, 0);

    if v_qtd <= 0 then
      raise exception 'A quantidade recebida de "%" precisa ser maior que zero.', v_item.nome;
    end if;

    if v_qtd > (v_item.quantidade_solicitada - v_item.quantidade_recebida) + 0.0005 then
      raise exception 'A quantidade recebida de "%" (%) passa do saldo pendente (%).',
        v_item.nome, v_qtd, v_item.quantidade_solicitada - v_item.quantidade_recebida;
    end if;

    select p.custo, p.controla_estoque
      into v_custo_atual, v_controla
      from public.produtos p
     where p.id = v_item.produto_id;

    if not found then
      raise exception 'O produto do item "%" não existe mais no estoque.', v_item.nome;
    end if;

    if not v_controla then
      raise exception 'O item "%" está marcado como "sem controle de estoque" e não pode ser recebido.', v_item.nome;
    end if;

    v_saldo    := public.saldo_estoque(v_item.produto_id);
    v_qtd_base := v_qtd * coalesce(v_item.fator_conversao, 1);

    if v_qtd_base <= 0 then
      raise exception 'A conversão de unidade de "%" resultou em quantidade inválida.', v_item.nome;
    end if;

    -- O local vem da tela de recebimento. O texto antigo `estoque` continua
    -- valendo para a loja; `geral` vira estoque_geral, como nas views da 25.
    v_local_destino := case lower(btrim(coalesce(v_entrada->>'local', 'estoque')))
      when 'geral' then 'estoque_geral'
      when 'estoque_geral' then 'estoque_geral'
      when 'loja' then 'estoque'
      when 'estoque' then 'estoque'
      when 'buffet' then 'buffet'
      else 'estoque'
    end;

    v_lote := nullif(btrim(coalesce(v_entrada->>'lote', '')), '');
    v_validade := nullif(v_entrada->>'validade', '')::date;

    v_motivo := 'Compra ' || v_compra.numero || ' · ' || v_item.nome;
    if v_lote is not null then
      v_motivo := v_motivo || ' · lote ' || v_lote;
    end if;

    -- Custo médio ponderado, por unidade-base. O desconto do item é rateado na
    -- mesma proporção da quantidade recebida; frete/desconto do cabeçalho são
    -- rateados pelo valor de cada item. PREÇO DE VENDA NÃO É TOCADO.
    v_sub_item := (v_qtd * v_item.custo_unitario)
                  - (v_item.desconto_valor * (v_qtd / v_item.quantidade_solicitada));

    v_rateio := case when v_subtotal_total > 0 then v_sub_item / v_subtotal_total else 0 end;

    v_valor_item := v_sub_item
                    + (v_compra.frete_valor * v_rateio)
                    - (v_compra.desconto_valor * v_rateio);

    insert into public.recebimentos_compra_itens
      (organization_id, filial_id, recebimento_id, compra_item_id, produto_id,
       quantidade_compra, fator_conversao, quantidade_base, custo_unitario, valor,
       lote, validade)
    values
      (v_org, v_filial, v_recebimento_id, v_item.id, v_item.produto_id,
       v_qtd, coalesce(v_item.fator_conversao, 1), v_qtd_base,
       round(case when v_qtd_base > 0 then v_valor_item / v_qtd_base else 0 end, 4),
       round(greatest(v_valor_item, 0), 2), v_lote, v_validade)
    returning id into v_recebimento_item_id;

    insert into public.movimentacoes_estoque
      (organization_id, filial_id, produto_id, quantidade, origem, destino, motivo,
       usuario_id, compra_id, compra_item_id, recebimento_compra_id,
       recebimento_item_id, custo_unitario, valor_total, documento_tipo, documento_id)
    values
      (v_org, v_filial, v_item.produto_id, v_qtd_base, 'fornecedor',
       v_local_destino, v_motivo, v_usuario, p_compra_id, v_item.id,
       v_recebimento_id, v_recebimento_item_id,
       round(case when v_qtd_base > 0 then v_valor_item / v_qtd_base else 0 end, 4),
       round(greatest(v_valor_item, 0), 2), 'recebimento_compra', v_recebimento_id)
    returning id into v_movimento_id;

    update public.recebimentos_compra_itens
       set movimento_id = v_movimento_id
     where id = v_recebimento_item_id;

    update public.compras_itens
       set quantidade_recebida = quantidade_recebida + v_qtd,
           lote = coalesce(v_lote, lote),
           validade = coalesce(v_validade, validade)
     where id = v_item.id;

    if v_valor_item > 0 then
      v_custo_novo := ((greatest(v_saldo, 0) * coalesce(v_custo_atual, 0)) + v_valor_item)
                      / (greatest(v_saldo, 0) + v_qtd_base);

      update public.produtos
         set custo = round(v_custo_novo, 4)
       where id = v_item.produto_id;
    end if;

    v_total    := v_total + v_valor_item;
    v_contador := v_contador + 1;
  end loop;

  select bool_and(ci.quantidade_recebida >= ci.quantidade_solicitada)
    into v_todos
    from public.compras_itens ci
   where ci.compra_id = p_compra_id;

  v_status := case when coalesce(v_todos, false) then 'recebido_confirmado'
                   else 'recebimento_parcial' end;

  v_data := case when v_status = 'recebido_confirmado' then current_date else null end;

  update public.compras c
     set status = v_status,
         data_recebimento = coalesce(v_data, c.data_recebimento)
   where c.id = p_compra_id;

  update public.recebimentos_compra
     set valor_total = round(v_total, 2)
   where id = v_recebimento_id;

  return query
    select p_compra_id, v_status, v_data, v_contador, round(v_total, 2);
end;
$$;

comment on function public.confirmar_recebimento_compra(uuid, jsonb) is
  'Recebe itens em transacao unica, grava recebimento+itens, movimenta fornecedor -> local escolhido, atualiza custo medio e gera conta a pagar. Exige compras.editar.';


-- ============================================================================
-- 6. RPC de baixa financeira
-- ============================================================================
create or replace function public.baixar_parcela_financeira(
  p_parcela_id uuid,
  p_valor numeric default null,
  p_data date default current_date,
  p_forma_pagamento_id uuid default null,
  p_observacoes text default '',
  p_chave text default null
)
returns table (
  baixa_id uuid,
  titulo_id uuid,
  status text,
  saldo numeric,
  ja_existia boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid := public.minha_organizacao();
  v_usuario  uuid := auth.uid();
  v_parcela  public.parcelas_financeiras%rowtype;
  v_titulo   public.titulos_financeiros%rowtype;
  v_forma    public.formas_pagamento%rowtype;
  v_saldo    numeric(14, 2);
  v_valor    numeric(14, 2);
  v_tipo     text;
  v_baixa    public.baixas_financeiras%rowtype;
  v_chave    text := nullif(btrim(coalesce(p_chave, '')), '');
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente para baixar o título.';
  end if;

  if not public.pode('financeiro', 'editar') then
    raise exception 'Sua conta não tem permissão para baixar títulos financeiros.'
      using errcode = '42501';
  end if;

  select * into v_parcela
    from public.parcelas_financeiras
   where id = p_parcela_id
     and organization_id = v_org
   for update;

  if not found then
    raise exception 'Parcela não encontrada.';
  end if;

  select * into v_titulo
    from public.titulos_financeiros
   where id = v_parcela.titulo_id
     and organization_id = v_org
   for update;

  if not found then
    raise exception 'Título não encontrado.';
  end if;

  if v_titulo.status = 'cancelado' then
    raise exception 'Título cancelado não recebe baixa.';
  end if;

  if v_chave is not null then
    select * into v_baixa
      from public.baixas_financeiras
     where organization_id = v_org and chave_idempotencia = v_chave;

    if found then
      return query
        select v_baixa.id, v_titulo.id, v_titulo.status,
               public.saldo_parcela(v_parcela.id), true;
      return;
    end if;
  end if;

  v_saldo := public.saldo_parcela(v_parcela.id);
  v_valor := round(coalesce(p_valor, v_saldo), 2);

  if v_valor <= 0 then
    raise exception 'O valor da baixa precisa ser maior que zero.';
  end if;

  if v_valor > v_saldo + 0.0001 then
    raise exception 'O valor de % ultrapassa o saldo de % da parcela.', v_valor, v_saldo;
  end if;

  if p_forma_pagamento_id is not null then
    select * into v_forma
      from public.formas_pagamento
     where id = p_forma_pagamento_id
       and organization_id = v_org
       and ativo;

    if not found then
      raise exception 'Forma de pagamento não encontrada ou inativa.';
    end if;
  end if;

  v_tipo := case when v_titulo.tipo = 'receber' then 'recebimento' else 'pagamento' end;

  insert into public.baixas_financeiras
    (organization_id, filial_id, parcela_id, tipo, valor, data,
     forma_pagamento_id, forma, observacoes, chave_idempotencia, criado_por)
  values
    (v_org, v_titulo.filial_id, v_parcela.id, v_tipo, v_valor,
     coalesce(p_data, current_date), p_forma_pagamento_id,
     coalesce(v_forma.nome, case when v_tipo = 'recebimento' then 'Recebimento' else 'Pagamento' end),
     coalesce(btrim(p_observacoes), ''), v_chave, v_usuario)
  returning * into v_baixa;

  select * into v_titulo from public.titulos_financeiros where id = v_titulo.id;

  return query
    select v_baixa.id, v_titulo.id, v_titulo.status,
           public.saldo_parcela(v_parcela.id), false;
end;
$$;

comment on function public.baixar_parcela_financeira(uuid, numeric, date, uuid, text, text) is
  'Baixa (recebe ou paga) uma parcela em transação única, atualiza o título e grava o lançamento de caixa. Exige financeiro.editar.';

-- ============================================================================
-- 7. Fichas tecnicas
-- ============================================================================
create table if not exists public.fichas_tecnicas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations(id) on delete restrict,
  filial_id       uuid,
  produto_id      uuid not null references public.produtos(id) on delete restrict,
  nome            text not null,
  rendimento      numeric(14, 3) not null default 1 check (rendimento > 0),
  unidade         text not null default 'un',
  ativa           boolean not null default true,
  observacoes     text not null default '',
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (organization_id, produto_id),
  foreign key (filial_id, organization_id)
    references public.filiais (id, organization_id) on delete restrict
);

create table if not exists public.fichas_tecnicas_itens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.minha_organizacao()
                    references public.organizations(id) on delete restrict,
  ficha_id        uuid not null references public.fichas_tecnicas(id) on delete cascade,
  componente_id   uuid not null references public.produtos(id) on delete restrict,
  quantidade      numeric(14, 3) not null check (quantidade > 0),
  unidade         text not null default 'un',
  perda_percentual numeric(7, 4) not null default 0
                    check (perda_percentual >= 0 and perda_percentual < 100),
  observacoes     text not null default '',
  unique (ficha_id, componente_id)
);

create index if not exists idx_fichas_produto on public.fichas_tecnicas (organization_id, produto_id);
create index if not exists idx_fichas_itens_ficha on public.fichas_tecnicas_itens (ficha_id);

create or replace function public.custo_ficha_tecnica(p_ficha_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
           (i.quantidade / f.rendimento)
           * (1 + i.perda_percentual / 100)
           * coalesce(p.custo, 0)
         ), 0)
    from public.fichas_tecnicas f
    join public.fichas_tecnicas_itens i on i.ficha_id = f.id
    join public.produtos p on p.id = i.componente_id
   where f.id = p_ficha_id
$$;

-- ============================================================================
-- 8. Views de leitura
-- ============================================================================
drop view if exists public.vw_titulos_financeiros;
create or replace view public.vw_titulos_financeiros as
select
  t.id,
  t.organization_id,
  t.filial_id,
  f.nome as filial_nome,
  t.tipo,
  t.origem_tipo,
  t.origem_id,
  t.numero,
  t.descricao,
  t.status,
  t.data_emissao,
  t.data_vencimento,
  t.valor_original,
  t.valor_liquidado,
  p.id as parcela_id,
  p.numero as parcela_numero,
  p.vencimento as parcela_vencimento,
  p.valor as parcela_valor,
  p.valor_liquidado as parcela_liquidado,
  p.status as parcela_status,
  greatest(0, round(p.valor - p.valor_liquidado, 2)) as saldo,
  c.nome as cliente,
  fo.nome as fornecedor
from public.titulos_financeiros t
left join public.filiais f on f.id = t.filial_id
join public.parcelas_financeiras p on p.titulo_id = t.id
left join public.clientes c on c.id = t.cliente_id
left join public.fornecedores fo on fo.id = t.fornecedor_id;
alter view public.vw_titulos_financeiros set (security_invoker = on);

drop view if exists public.vw_financeiro_resumo;
create or replace view public.vw_financeiro_resumo as
select
  coalesce(sum(case when t.tipo = 'receber' and t.status in ('aberto', 'parcial') then t.valor_original - t.valor_liquidado else 0 end), 0) as a_receber,
  coalesce(sum(case when t.tipo = 'pagar' and t.status in ('aberto', 'parcial') then t.valor_original - t.valor_liquidado else 0 end), 0) as a_pagar,
  coalesce(sum(case when t.tipo = 'receber' and t.status in ('aberto', 'parcial') and t.data_vencimento < current_date then t.valor_original - t.valor_liquidado else 0 end), 0) as a_receber_vencido,
  coalesce(sum(case when t.tipo = 'pagar' and t.status in ('aberto', 'parcial') and t.data_vencimento < current_date then t.valor_original - t.valor_liquidado else 0 end), 0) as a_pagar_vencido,
  count(*) filter (where t.status in ('aberto', 'parcial')) as titulos_abertos,
  count(*) filter (where t.status = 'liquidado') as titulos_liquidados
from public.titulos_financeiros t;
alter view public.vw_financeiro_resumo set (security_invoker = on);

drop view if exists public.vw_resultado_mensal;
create or replace view public.vw_resultado_mensal as
with faturamento as (
  select date_trunc('month', v.criado_em)::date as mes,
         sum(v.total) as faturamento
    from public.vendas v
   where v.status <> 'Cancelada' and v.estornada_em is null
   group by 1
),
custo as (
  select date_trunc('month', v.criado_em)::date as mes,
         sum(i.quantidade * coalesce(p.custo, 0)) as custo
    from public.itens_venda i
    join public.vendas v on v.id = i.venda_id
    join public.produtos p on p.id = i.produto_id
   where v.status <> 'Cancelada' and v.estornada_em is null
   group by 1
),
despesa as (
  select date_trunc('month', l.data)::date as mes,
         sum(l.valor) as despesa
    from public.lancamentos l
   where l.tipo = 'saida' and l.natureza = 'despesa'
   group by 1
)
select
  coalesce(f.mes, c.mes, d.mes) as mes,
  coalesce(f.faturamento, 0) as faturamento,
  coalesce(c.custo, 0) as custo,
  coalesce(d.despesa, 0) as despesa,
  coalesce(f.faturamento, 0) - coalesce(c.custo, 0) - coalesce(d.despesa, 0) as resultado
from faturamento f
full join custo c on c.mes = f.mes
full join despesa d on d.mes = coalesce(f.mes, c.mes)
order by 1;
alter view public.vw_resultado_mensal set (security_invoker = on);

drop view if exists public.vw_saldos_por_filial_deposito;
create or replace view public.vw_saldos_por_filial_deposito as
select
  m.organization_id,
  m.filial_id,
  f.nome as filial_nome,
  d.id as deposito_id,
  d.codigo as deposito,
  d.nome as deposito_nome,
  m.produto_id,
  p.nome as produto,
  sum(case when m.destino_deposito_id = d.id then m.quantidade
           when m.origem_deposito_id = d.id then -m.quantidade
           else 0 end) as saldo
from public.movimentacoes_estoque m
join public.produtos p on p.id = m.produto_id
join public.filiais f on f.id = m.filial_id
join public.depositos d
  on d.organization_id = m.organization_id
 and d.filial_id = m.filial_id
 and d.id in (m.origem_deposito_id, m.destino_deposito_id)
where m.origem_deposito_id is not null or m.destino_deposito_id is not null
group by m.organization_id, m.filial_id, f.nome, d.id, d.codigo, d.nome, m.produto_id, p.nome;
alter view public.vw_saldos_por_filial_deposito set (security_invoker = on);

-- ============================================================================
-- 9. RLS, GRANTs e politicas
-- ============================================================================
revoke all on public.empresas, public.filiais, public.depositos,
  public.plano_contas, public.titulos_financeiros, public.parcelas_financeiras,
  public.baixas_financeiras, public.recebimentos_compra,
  public.recebimentos_compra_itens, public.venda_pagamentos,
  public.caixas, public.sessoes_caixa, public.movimentos_caixa,
  public.fichas_tecnicas, public.fichas_tecnicas_itens
from public, anonymous, authenticated;

grant select, insert, update, delete on public.empresas, public.filiais, public.depositos
  to authenticated;
grant select, insert, update, delete on public.plano_contas
  to authenticated;
grant select on public.titulos_financeiros, public.parcelas_financeiras,
  public.baixas_financeiras, public.recebimentos_compra,
  public.recebimentos_compra_itens, public.venda_pagamentos,
  public.caixas, public.sessoes_caixa, public.movimentos_caixa,
  public.fichas_tecnicas, public.fichas_tecnicas_itens
  to authenticated;
grant select, insert, update, delete on public.fichas_tecnicas, public.fichas_tecnicas_itens
  to authenticated;

revoke all on public.vw_titulos_financeiros, public.vw_financeiro_resumo,
  public.vw_resultado_mensal, public.vw_saldos_por_filial_deposito
from public, anonymous;
grant select on public.vw_titulos_financeiros, public.vw_financeiro_resumo,
  public.vw_resultado_mensal, public.vw_saldos_por_filial_deposito
  to authenticated;

alter table public.empresas enable row level security;
alter table public.filiais enable row level security;
alter table public.depositos enable row level security;
alter table public.plano_contas enable row level security;
alter table public.titulos_financeiros enable row level security;
alter table public.parcelas_financeiras enable row level security;
alter table public.baixas_financeiras enable row level security;
alter table public.recebimentos_compra enable row level security;
alter table public.recebimentos_compra_itens enable row level security;
alter table public.venda_pagamentos enable row level security;
alter table public.caixas enable row level security;
alter table public.sessoes_caixa enable row level security;
alter table public.movimentos_caixa enable row level security;
alter table public.fichas_tecnicas enable row level security;
alter table public.fichas_tecnicas_itens enable row level security;

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array['empresas', 'filiais', 'depositos'] loop
    execute format('drop policy if exists %I_leitura on public.%I', v_tabela, v_tabela);
    execute format(
      'create policy %I_leitura on public.%I for select to authenticated
       using (organization_id = public.minha_organizacao()
              and (select public.pode(''configuracoes'', ''ver'')))',
      v_tabela, v_tabela
    );
    execute format('drop policy if exists %I_escrita on public.%I', v_tabela, v_tabela);
    execute format(
      'create policy %I_escrita on public.%I for all to authenticated
       using (organization_id = public.minha_organizacao()
              and (select public.pode(''configuracoes'', ''editar'')))
       with check (organization_id = public.minha_organizacao()
              and (select public.pode(''configuracoes'', ''editar'')))',
      v_tabela, v_tabela
    );
  end loop;
end
$$;

drop policy if exists plano_contas_leitura on public.plano_contas;
create policy plano_contas_leitura on public.plano_contas
  for select to authenticated
  using (organization_id = public.minha_organizacao()
         and (select public.pode('financeiro', 'consultar')));

drop policy if exists plano_contas_escrita on public.plano_contas;
create policy plano_contas_escrita on public.plano_contas
  for all to authenticated
  using (organization_id = public.minha_organizacao()
         and (select public.pode('financeiro', 'editar')))
  with check (organization_id = public.minha_organizacao()
         and (select public.pode('financeiro', 'editar')));

do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array[
    'titulos_financeiros', 'parcelas_financeiras', 'baixas_financeiras',
    'recebimentos_compra', 'recebimentos_compra_itens', 'venda_pagamentos',
    'caixas', 'sessoes_caixa', 'movimentos_caixa'
  ] loop
    execute format('drop policy if exists %I_leitura on public.%I', v_tabela, v_tabela);
    execute format(
      'create policy %I_leitura on public.%I for select to authenticated
       using (organization_id = public.minha_organizacao()
              and (select public.pode(''financeiro'', ''consultar'')))',
      v_tabela, v_tabela
    );
  end loop;
end
$$;

drop policy if exists fichas_tecnicas_leitura on public.fichas_tecnicas;
create policy fichas_tecnicas_leitura on public.fichas_tecnicas
  for select to authenticated
  using (organization_id = public.minha_organizacao()
         and (select public.pode('estoque', 'consultar')));

drop policy if exists fichas_tecnicas_escrita on public.fichas_tecnicas;
create policy fichas_tecnicas_escrita on public.fichas_tecnicas
  for all to authenticated
  using (organization_id = public.minha_organizacao()
         and (select public.pode('estoque', 'editar')))
  with check (organization_id = public.minha_organizacao()
         and (select public.pode('estoque', 'editar')));

drop policy if exists fichas_tecnicas_itens_leitura on public.fichas_tecnicas_itens;
create policy fichas_tecnicas_itens_leitura on public.fichas_tecnicas_itens
  for select to authenticated
  using (organization_id = public.minha_organizacao()
         and (select public.pode('estoque', 'consultar')));

drop policy if exists fichas_tecnicas_itens_escrita on public.fichas_tecnicas_itens;
create policy fichas_tecnicas_itens_escrita on public.fichas_tecnicas_itens
  for all to authenticated
  using (organization_id = public.minha_organizacao()
         and (select public.pode('estoque', 'editar')))
  with check (organization_id = public.minha_organizacao()
         and (select public.pode('estoque', 'editar')));

-- Funcoes internas nao sao RPC direto.
do $$
begin
  revoke execute on function public.filial_padrao(uuid) from public, anonymous;
  revoke execute on function public.deposito_por_codigo(uuid, uuid, text) from public, anonymous;
  revoke execute on function public.preencher_contexto_movimento() from public, anonymous;
  revoke execute on function public.preencher_filial_padrao() from public, anonymous;
  revoke execute on function public.criar_parcela_do_titulo() from public, anonymous;
  revoke execute on function public.recalcular_titulo_financeiro(uuid) from public, anonymous;
  revoke execute on function public.after_parcela_financeira() from public, anonymous;
  revoke execute on function public.aplicar_baixa_financeira() from public, anonymous;
  revoke execute on function public.saldo_parcela(uuid) from public, anonymous;
  revoke execute on function public.garantir_financeiro_venda(uuid) from public, anonymous;
  revoke execute on function public.financeiro_venda_detalhe() from public, anonymous;
  revoke execute on function public.financeiro_venda_status() from public, anonymous;
  revoke execute on function public.cancelar_financeiro_venda(uuid) from public, anonymous;
  revoke execute on function public.garantir_financeiro_recebimento(uuid) from public, anonymous;
  revoke execute on function public.financeiro_recebimento_compra() from public, anonymous;
  revoke execute on function public.custo_ficha_tecnica(uuid) from public, anonymous;
  revoke execute on function public.criar_depositos_da_filial() from public, anonymous;

  grant execute on function public.filial_padrao(uuid) to authenticated;
  grant execute on function public.saldo_parcela(uuid) to authenticated;
  grant execute on function public.custo_ficha_tecnica(uuid) to authenticated;

  revoke execute on function public.baixar_parcela_financeira(uuid, numeric, date, uuid, text, text)
    from public, anonymous;
  grant execute on function public.baixar_parcela_financeira(uuid, numeric, date, uuid, text, text)
    to authenticated;
end
$$;

-- ============================================================================
-- 10. Backfill de dados existentes (idempotente e somente leitura de origem)
-- ============================================================================
-- Vendas antigas que ja tem detalhe passam a ter titulo/pagamento. Vendas sem
-- detalhe ficam como estao; a tela nova mostra a pendencia em vez de inventar.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select v.id
      from public.vendas v
      join public.venda_detalhes d on d.venda_id = v.id
     where not exists (
       select 1 from public.titulos_financeiros t
        where t.organization_id = v.organization_id
          and t.origem_tipo = 'venda'
          and t.origem_id = v.id
          and t.tipo = 'receber'
     )
  loop
    perform public.garantir_financeiro_venda(v_id);
  end loop;
end
$$;

-- Compras ja recebidas antes da 33 ganham uma conta a pagar pelo valor
-- efetivamente recebido. Compras com recebimento novo usam o recebimento e
-- ficam com origem_tipo='recebimento_compra'.
do $$
declare
  v_compra public.compras%rowtype;
  v_valor numeric(14, 2);
  v_plano uuid;
  v_filial uuid;
begin
  for v_compra in
    select * from public.compras
     where status in ('recebimento_parcial', 'recebido_confirmado')
  loop
    if exists (
      select 1 from public.titulos_financeiros t
       where t.organization_id = v_compra.organization_id
         and t.origem_tipo in ('compra', 'recebimento_compra')
         and t.tipo = 'pagar'
         and (
           t.origem_id = v_compra.id
           or exists (
             select 1 from public.recebimentos_compra r
              where r.compra_id = v_compra.id and r.id = t.origem_id
           )
         )
    ) then
      continue;
    end if;

    select coalesce(sum(
             ci.quantidade_recebida * ci.custo_unitario * coalesce(ci.fator_conversao, 1)
           ), 0)
      into v_valor
      from public.compras_itens ci
     where ci.compra_id = v_compra.id;

    if v_valor <= 0.0001 then
      continue;
    end if;

    v_filial := coalesce(v_compra.filial_id, public.filial_padrao(v_compra.organization_id));
    select id into v_plano from public.plano_contas
     where organization_id = v_compra.organization_id and codigo = '2.1';

    insert into public.titulos_financeiros
      (organization_id, filial_id, tipo, origem_tipo, origem_id, numero, descricao,
       plano_conta_id, fornecedor_id, data_emissao, data_competencia,
       data_vencimento, valor_original, status)
    values
      (v_compra.organization_id, v_filial, 'pagar', 'compra', v_compra.id,
       'CP-' || v_compra.numero,
       'Compra ' || v_compra.numero || ' - saldo recebido antes da migracao 33',
       v_plano, v_compra.fornecedor_id,
       coalesce(v_compra.data_recebimento, v_compra.data_compra),
       coalesce(v_compra.data_recebimento, v_compra.data_compra),
       coalesce(v_compra.data_recebimento, v_compra.data_compra) + 30,
       v_valor, 'aberto')
    on conflict (organization_id, origem_tipo, origem_id, tipo) do nothing;
  end loop;
end
$$;

-- Uma caixa padrao por filial ajuda a operacao e o demo; nao abre sessao.
insert into public.caixas (organization_id, filial_id, codigo, nome)
select f.organization_id, f.id, 'CAIXA-1', 'Caixa principal'
  from public.filiais f
on conflict (filial_id, codigo) do nothing;

notify pgrst, 'reload schema';
