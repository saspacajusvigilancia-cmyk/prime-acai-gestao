-- ============================================================================
-- 34 - Carga de demonstracao protegida
-- ============================================================================
-- Esta migracao NAO carrega dados sozinha. Ela apenas instala uma funcao que
-- exige, ao mesmo tempo:
--   1. a configuracao local `app.demo_isolada = 'true'`;
--   2. um token explicito;
--   3. um administrador autenticado;
--   4. uma base sem vendas e sem compras (ou seja, uma branch descartavel
--      recem-criada, nunca a producao).
--
-- A carga e feita por `neon/carregar-demonstracao.mjs`, que tambem recusa o
-- host de producao. Nada aqui roda no `aplicar.mjs` normal.
-- ============================================================================

create or replace function public.demo_carregar(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_admin     uuid := auth.uid();
  v_empresa   uuid;
  v_filial    uuid;
  v_empresa2  uuid;
  v_filial2   uuid;
  v_tipo      uuid;
  v_forma_din uuid;
  v_forma_pix uuid;
  v_forma_cred uuid;
  v_prod1     uuid;
  v_prod2     uuid;
  v_prod3     uuid;
  v_prod4     uuid;
  v_prod5     uuid;
  v_prod6     uuid;
  v_prod7     uuid;
  v_prod8     uuid;
  v_forn      uuid;
  v_forn_ids  uuid[] := array[]::uuid[];
  v_cli       uuid;
  v_cli_ids   uuid[] := array[]::uuid[];
  v_compra    uuid;
  v_item1     uuid;
  v_item2     uuid;
  v_itens     jsonb;
  v_venda     uuid;
  v_i         integer;
  v_caixa     uuid;
  v_sessao    uuid;
  v_ficha     uuid;
  v_produto   uuid;
  v_item_json jsonb;
  v_quantidade numeric;
  v_local     text;
  v_total     integer := 0;
begin
  if coalesce(current_setting('app.demo_isolada', true), '') <> 'true' then
    raise exception 'Carga de demonstração bloqueada: falta app.demo_isolada=true.';
  end if;

  if p_token is distinct from 'PRIME-ACAI-DEMO-2026' then
    raise exception 'Carga de demonstração bloqueada: token inválido.';
  end if;

  if v_admin is null then
    raise exception 'Carga de demonstração bloqueada: nenhum usuário autenticado.';
  end if;

  select id into v_org
    from public.organizations
   order by created_at
   limit 1;

  if v_org is null then
    raise exception 'Carga de demonstração bloqueada: organização inexistente.';
  end if;

  if not exists (
    select 1
      from public.profiles p
     where p.id = v_admin
       and p.organization_id = v_org
       and p.is_active
       and p.role = 'admin'
  ) then
    raise exception 'Carga de demonstração bloqueada: é preciso um administrador ativo.';
  end if;

  if not public.pode('configuracoes', 'editar') then
    raise exception 'Carga de demonstração bloqueada: o administrador não pode editar configurações.'
      using errcode = '42501';
  end if;

  -- Idempotência: se esta organização já recebeu a carga, devolve o retrato em
  -- vez de duplicar. Precisa vir antes da trava de base vazia, porque a própria
  -- demonstração cria vendas e compras.
  if exists (
    select 1 from public.produtos
     where organization_id = v_org and codigo = 'DEMO-P001'
  ) then
    return jsonb_build_object(
      'ja_existia', true,
      'organizacao', v_org,
      'produtos', (select count(*) from public.produtos where organization_id = v_org and codigo like 'DEMO-%'),
      'clientes', (select count(*) from public.clientes where organization_id = v_org and codigo like 'DEMO-%'),
      'vendas', (select count(*) from public.vendas where organization_id = v_org and codigo like '#DEMO-%')
    );
  end if;

  if exists (select 1 from public.vendas where organization_id = v_org)
     or exists (select 1 from public.compras where organization_id = v_org) then
    raise exception
      'Carga de demonstração bloqueada: a base já tem vendas/compras. Use uma branch vazia e descartável.';
  end if;

  select id into v_empresa
    from public.empresas
   where organization_id = v_org
   order by (codigo = 'MATRIZ') desc, criado_em
   limit 1;

  if v_empresa is null then
    insert into public.empresas (organization_id, codigo, nome, razao_social)
    values (v_org, 'MATRIZ', 'Empresa principal', 'Empresa principal')
    returning id into v_empresa;
  end if;

  select id into v_filial
    from public.filiais
   where organization_id = v_org and empresa_id = v_empresa
   order by (codigo = 'MATRIZ') desc, criado_em
   limit 1;

  if v_filial is null then
    insert into public.filiais (organization_id, empresa_id, codigo, nome, tipo)
    values (v_org, v_empresa, 'MATRIZ', 'Matriz', 'matriz')
    returning id into v_filial;
  end if;

  insert into public.empresas (organization_id, codigo, nome, razao_social)
  values (v_org, 'DEMO-EMPRESA-2', '[DEMO] Empresa filial', '[DEMO] Empresa filial')
  on conflict (organization_id, codigo) do update
    set nome = excluded.nome, razao_social = excluded.razao_social
  returning id into v_empresa2;

  insert into public.filiais (organization_id, empresa_id, codigo, nome, tipo, endereco)
  values (v_org, v_empresa2, 'ZZZ-FILIAL-2', '[DEMO] Filial 2', 'filial', 'Endereço fictício de demonstração')
  on conflict (organization_id, codigo) do update
    set nome = excluded.nome, endereco = excluded.endereco
  returning id into v_filial2;

  -- ------------------------------------------------------------------------
  -- Catálogos básicos (formas e tipos existentes)
  -- ------------------------------------------------------------------------
  select id into v_tipo
    from public.tipos_venda
   where organization_id = v_org and codigo = 'balcao';
  if v_tipo is null then
    select id into v_tipo from public.tipos_venda
     where organization_id = v_org and ativo order by nome limit 1;
  end if;

  select id into v_forma_din from public.formas_pagamento
   where organization_id = v_org and codigo = 'dinheiro';
  select id into v_forma_pix from public.formas_pagamento
   where organization_id = v_org and codigo = 'pix';
  select id into v_forma_cred from public.formas_pagamento
   where organization_id = v_org and codigo = 'credito';

  if v_tipo is null or v_forma_din is null or v_forma_pix is null or v_forma_cred is null then
    raise exception 'Cadastros básicos de venda/formas de pagamento não existem nesta organização.';
  end if;

  -- ------------------------------------------------------------------------
  -- Produtos de demonstração (prefixo [DEMO] e códigos DEMO-)
  -- ------------------------------------------------------------------------
  insert into public.produtos
    (codigo, nome, categoria, quantidade, minimo, unidade, custo, preco, ativo,
     descricao, tipo_venda, controla_estoque, metodo_estoque, metodo_peso,
     organization_id, tipo_produto, regra_baixa_estoque, local_estoque_origem)
  values
    ('DEMO-P001', '[DEMO] Açaí 500 ml', '[DEMO] Açaí', 0, 10, 'un', 6.00, 18.00, true,
     'Produto fictício de demonstração', 'unidade', true, 'movimentacoes', null,
     v_org, 'venda_direta', 'venda_confirmada', 'estoque'),
    ('DEMO-P002', '[DEMO] Açaí 300 ml', '[DEMO] Açaí', 0, 10, 'un', 4.00, 12.00, true,
     'Produto fictício de demonstração', 'unidade', true, 'movimentacoes', null,
     v_org, 'venda_direta', 'venda_confirmada', 'estoque'),
    ('DEMO-P003', '[DEMO] Açaí self-service', '[DEMO] Açaí', 0, 5, 'kg', 18.00, 69.90, true,
     'Produto fictício de demonstração', 'peso', true, 'movimentacoes', 'liquido',
     v_org, 'venda_direta', 'venda_confirmada', 'estoque'),
    ('DEMO-P004', '[DEMO] Granola', '[DEMO] Adicionais', 0, 5, 'un', 2.00, 5.00, true,
     'Produto fictício de demonstração', 'unidade', true, 'movimentacoes', null,
     v_org, 'venda_direta', 'venda_confirmada', 'estoque'),
    ('DEMO-P005', '[DEMO] Leite em pó', '[DEMO] Insumos', 0, 5, 'un', 3.57, 0, true,
     'Produto fictício de demonstração', 'unidade', true, 'movimentacoes', null,
     v_org, 'insumo', 'legada', 'estoque'),
    ('DEMO-P006', '[DEMO] Morango', '[DEMO] Insumos', 0, 3, 'un', 8.00, 0, true,
     'Produto fictício de demonstração', 'unidade', true, 'movimentacoes', null,
     v_org, 'insumo', 'legada', 'estoque'),
    ('DEMO-P007', '[DEMO] Copo 500 ml com tampa', '[DEMO] Embalagens', 0, 20, 'un', 0.80, 0, true,
     'Produto fictício de demonstração', 'unidade', true, 'movimentacoes', null,
     v_org, 'embalagem', 'legada', 'estoque'),
    ('DEMO-P008', '[DEMO] Colher descartável', '[DEMO] Embalagens', 0, 50, 'un', 0.10, 0, true,
     'Produto fictício de demonstração', 'unidade', true, 'movimentacoes', null,
     v_org, 'embalagem', 'legada', 'estoque');

  select id into v_prod1 from public.produtos where codigo = 'DEMO-P001';
  select id into v_prod2 from public.produtos where codigo = 'DEMO-P002';
  select id into v_prod3 from public.produtos where codigo = 'DEMO-P003';
  select id into v_prod4 from public.produtos where codigo = 'DEMO-P004';
  select id into v_prod5 from public.produtos where codigo = 'DEMO-P005';
  select id into v_prod6 from public.produtos where codigo = 'DEMO-P006';
  select id into v_prod7 from public.produtos where codigo = 'DEMO-P007';
  select id into v_prod8 from public.produtos where codigo = 'DEMO-P008';

  -- Saldo inicial na matriz e uma pequena carga na filial 2.
  insert into public.movimentacoes_estoque
    (organization_id, filial_id, produto_id, quantidade, origem, destino, motivo, usuario_id)
  values
    (v_org, v_filial, v_prod1, 100, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO', v_admin),
    (v_org, v_filial, v_prod2, 100, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO', v_admin),
    (v_org, v_filial, v_prod3, 250, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO', v_admin),
    (v_org, v_filial, v_prod4, 60, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO', v_admin),
    (v_org, v_filial, v_prod5, 80, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO', v_admin),
    (v_org, v_filial, v_prod6, 40, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO', v_admin),
    (v_org, v_filial, v_prod7, 500, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO', v_admin),
    (v_org, v_filial, v_prod8, 500, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO', v_admin),
    (v_org, v_filial2, v_prod1, 30, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO filial 2', v_admin),
    (v_org, v_filial2, v_prod3, 40, 'abertura', 'estoque', 'Saldo inicial DEMONSTRAÇÃO filial 2', v_admin);

  -- ------------------------------------------------------------------------
  -- Fornecedores e clientes fictícios
  -- ------------------------------------------------------------------------
  for v_i in 1..4 loop
    insert into public.fornecedores
      (organization_id, nome, cnpj, telefone, whatsapp, email, observacoes, ativo)
    values
      (v_org, '[DEMO] Fornecedor ' || lpad(v_i::text, 2, '0'), null, null, null,
       'fornecedor' || v_i || '@exemplo.invalid',
       'DADOS FICTÍCIOS DE DEMONSTRAÇÃO', true)
    on conflict (organization_id, lower(btrim(nome))) do update
      set ativo = true, observacoes = excluded.observacoes
    returning id into v_forn;
    v_forn_ids := array_append(v_forn_ids, v_forn);
  end loop;

  for v_i in 1..20 loop
    insert into public.clientes
      (organization_id, codigo, nome, telefone, email, desde, tier, observacoes)
    values
      (v_org, 'DEMO-CLI-' || lpad(v_i::text, 2, '0'),
       '[DEMO] Cliente ' || lpad(v_i::text, 2, '0'), null,
       'cliente' || v_i || '@exemplo.invalid', current_date - (v_i * 3),
       case when v_i % 5 = 0 then 'VIP' when v_i % 3 = 0 then 'Recorrente' else 'Novo' end,
       'DADOS FICTÍCIOS DE DEMONSTRAÇÃO')
    on conflict (organization_id, codigo) do update
      set nome = excluded.nome, observacoes = excluded.observacoes
    returning id into v_cli;
    v_cli_ids := array_append(v_cli_ids, v_cli);
  end loop;

  -- ------------------------------------------------------------------------
  -- Compras: 5 recebimentos completos e 1 parcial; uma compra na filial 2.
  -- ------------------------------------------------------------------------
  for v_i in 1..6 loop
    v_forn := v_forn_ids[1 + ((v_i - 1) % array_length(v_forn_ids, 1))];
    v_compra := null;
    v_item1 := null;
    v_item2 := null;

    insert into public.compras
      (organization_id, filial_id, numero, data_compra, status, usuario_id,
       fornecedor_id, tipo_documento, numero_nota, observacoes, desconto_valor, frete_valor)
    values
      (v_org,
       case when v_i = 2 then v_filial2 else v_filial end,
       'DEMO-C-' || lpad(v_i::text, 3, '0'),
       current_date - (v_i * 3),
       'aguardando_recebimento',
       v_admin,
       v_forn,
       'sem_nota',
       null,
       'Compra fictícia de demonstração (sem documento fiscal)',
       0,
       case when v_i = 1 then 10 else 0 end)
    returning id into v_compra;

    insert into public.compras_itens
      (compra_id, produto_id, quantidade_recebida, custo_unitario, nome,
       unidade_compra, fator_conversao, quantidade_solicitada, desconto_valor, lote, validade)
    values
      (v_compra, v_prod5, 0, 3.57, '[DEMO] Leite em pó', 'un', 1, 30, 0,
       'DEMO-L' || v_i, current_date + 120)
    returning id into v_item1;

    insert into public.compras_itens
      (compra_id, produto_id, quantidade_recebida, custo_unitario, nome,
       unidade_compra, fator_conversao, quantidade_solicitada, desconto_valor, lote, validade)
    values
      (v_compra, v_prod6, 0, 8.00, '[DEMO] Morango', 'un', 1, 20, 0,
       'DEMO-M' || v_i, current_date + 7)
    returning id into v_item2;

    select jsonb_agg(jsonb_build_object(
             'item_id', ci.id,
             'quantidade', case when v_i = 6 then round(ci.quantidade_solicitada * 0.5, 3)
                                else ci.quantidade_solicitada end,
             'local', case when v_i % 3 = 0 then 'geral'
                           when v_i % 3 = 1 then 'loja'
                           else 'buffet' end,
             'lote', ci.lote,
             'validade', ci.validade
           ))
      into v_itens
      from public.compras_itens ci
     where ci.compra_id = v_compra;

    perform public.confirmar_recebimento_compra(v_compra, v_itens);
  end loop;

  -- Paga dois títulos a pagar; os demais ficam em aberto para a tela.
  for v_item1 in
    select parcela_id
      from public.vw_titulos_financeiros
     where organization_id = v_org
       and tipo = 'pagar'
       and status = 'aberto'
     order by parcela_vencimento
     limit 2
  loop
    perform public.baixar_parcela_financeira(
      v_item1, null, current_date, v_forma_pix,
      'Pagamento fictício de demonstração', 'demo-pagamento:' || v_item1::text
    );
  end loop;

  -- ------------------------------------------------------------------------
  -- Vendas: 60 vendas concluídas em 30 dias, com peso e pagamento variado.
  -- ------------------------------------------------------------------------
  for v_i in 1..60 loop
    v_produto := case (v_i % 4)
      when 0 then v_prod1
      when 1 then v_prod2
      when 2 then v_prod3
      else v_prod4
    end;

    if v_produto = v_prod3 then
      v_item_json := jsonb_build_object(
        'produto_id', v_produto,
        'metodo_peso', 'liquido',
        'peso_liquido_g', 250 + ((v_i % 5) * 50)
      );
    else
      v_item_json := jsonb_build_object(
        'produto_id', v_produto,
        'quantidade', 1 + (v_i % 2)
      );
    end if;

    v_cli := case when v_i % 7 = 0 then null
                  else v_cli_ids[1 + ((v_i - 1) % array_length(v_cli_ids, 1))] end;

    perform public.registrar_venda_completa(
      jsonb_build_array(v_item_json),
      'demo-venda-' || v_i::text,
      v_cli,
      v_tipo,
      case when v_i % 3 = 0 then v_forma_din
           when v_i % 3 = 1 then v_forma_pix
           else v_forma_cred end,
      'Concluída',
      '#DEMO-' || lpad(v_i::text, 4, '0'),
      null, 0, null, null, 0, 0, null
    );
    v_total := v_total + 1;
  end loop;

  -- ------------------------------------------------------------------------
  -- Caixa e ficha técnica (a ficha fica inativa: a baixa automática por
  -- ingredientes é uma evolução separada, não uma promessa desta carga).
  -- ------------------------------------------------------------------------
  insert into public.caixas (organization_id, filial_id, codigo, nome)
  values (v_org, v_filial, 'CAIXA-DEMO', '[DEMO] Caixa principal')
  on conflict (filial_id, codigo) do update set nome = excluded.nome
  returning id into v_caixa;

  if not exists (
    select 1 from public.sessoes_caixa
     where caixa_id = v_caixa and status = 'aberta'
  ) then
    insert into public.sessoes_caixa
      (organization_id, filial_id, caixa_id, status, aberta_por, valor_abertura, observacoes)
    values (v_org, v_filial, v_caixa, 'aberta', v_admin, 100,
            'Sessão fictícia de demonstração')
    returning id into v_sessao;

    insert into public.movimentos_caixa
      (organization_id, filial_id, sessao_id, tipo, valor, descricao, criado_por)
    values
      (v_org, v_filial, v_sessao, 'abertura', 100,
       'Fundo de troco fictício de demonstração', v_admin);
  end if;

  insert into public.fichas_tecnicas
    (organization_id, filial_id, produto_id, nome, rendimento, unidade, ativa, observacoes)
  values
    (v_org, v_filial, v_prod1, '[DEMO] Ficha do Açaí 500 ml', 1, 'un', false,
     'Ficha fictícia de demonstração. Ativação da baixa automática por ingredientes fica para a próxima etapa.')
  on conflict (organization_id, produto_id) do update set nome = excluded.nome
  returning id into v_ficha;

  insert into public.fichas_tecnicas_itens
    (organization_id, ficha_id, componente_id, quantidade, unidade, perda_percentual)
  values
    (v_org, v_ficha, v_prod5, 0.02, 'un', 0),
    (v_org, v_ficha, v_prod7, 1, 'un', 0),
    (v_org, v_ficha, v_prod8, 1, 'un', 0)
  on conflict (ficha_id, componente_id) do nothing;

  return jsonb_build_object(
    'ja_existia', false,
    'organizacao', v_org,
    'empresas', (select count(*) from public.empresas where organization_id = v_org),
    'filiais', (select count(*) from public.filiais where organization_id = v_org),
    'depositos', (select count(*) from public.depositos where organization_id = v_org),
    'produtos', (select count(*) from public.produtos where organization_id = v_org and codigo like 'DEMO-%'),
    'clientes', (select count(*) from public.clientes where organization_id = v_org and codigo like 'DEMO-%'),
    'fornecedores', (select count(*) from public.fornecedores where organization_id = v_org and nome like '[DEMO]%'),
    'compras', (select count(*) from public.compras where organization_id = v_org and numero like 'DEMO-%'),
    'recebimentos', (select count(*) from public.recebimentos_compra where organization_id = v_org and numero like 'RC-%'),
    'vendas', (select count(*) from public.vendas where organization_id = v_org and codigo like '#DEMO-%'),
    'titulos', (select count(*) from public.titulos_financeiros where organization_id = v_org),
    'lancamentos', (select count(*) from public.lancamentos where organization_id = v_org),
    'fichas', (select count(*) from public.fichas_tecnicas where organization_id = v_org and nome like '[DEMO]%')
  );
end;
$$;

comment on function public.demo_carregar(text) is
  'Carrega a base fictícia de demonstração. Exige app.demo_isolada=true, token, admin e base sem vendas/compras. Nunca roda automaticamente.';

revoke all on function public.demo_carregar(text) from public, anonymous, authenticated;
grant execute on function public.demo_carregar(text) to authenticated;

notify pgrst, 'reload schema';
