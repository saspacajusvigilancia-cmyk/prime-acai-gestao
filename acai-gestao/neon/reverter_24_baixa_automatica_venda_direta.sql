-- Reverte somente o comportamento novo. As colunas de configuração,
-- organização e unidade são preservadas para não descartar dados/auditoria.
do $$
begin
  if exists (
    select 1
      from public.produtos
     where regra_baixa_estoque = 'venda_confirmada'
       and local_estoque_origem <> 'estoque'
  ) then
    raise exception
      'Há produtos com baixa automática fora do Estoque Normal. Reconfigure-os antes de reverter a migração 24.';
  end if;

  if exists (
    select 1 from public.produtos where quantidade < 0
  ) then
    raise exception
      'Há saldos negativos. Corrija-os antes de restaurar a validação de saldo da migração 24.';
  end if;
end;
$$;

alter table public.produtos disable trigger produtos_saldo_do_livro;

update public.produtos
   set regra_baixa_estoque = 'legada'
 where regra_baixa_estoque = 'venda_confirmada';

alter table public.produtos enable trigger produtos_saldo_do_livro;

create or replace function public.validar_movimentacao_produto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.unidade into new.unidade
    from public.produtos p
   where p.id = new.produto_id
     and p.organization_id = new.organization_id;
  if not found then
    raise exception 'Produto não pertence à filial desta movimentação.';
  end if;

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

  return new;
end;
$$;

drop trigger if exists itens_venda_produto_filial_ativo on public.itens_venda;
drop function if exists public.validar_item_venda_produto();

create or replace function public.produtos_saldo_vem_do_livro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saldo numeric;
begin
  v_saldo := public.saldo_estoque(new.id);

  if v_saldo < 0 then
    raise exception
      'Saldo insuficiente para "%": o livro-razão fecharia em % %. Registre a entrada antes de dar esta saída.',
      new.nome, v_saldo, new.unidade;
  end if;

  new.quantidade := v_saldo;
  return new;
end;
$$;

alter table public.produtos
  drop constraint if exists produtos_quantidade_nao_negativa;

alter table public.produtos
  add constraint produtos_quantidade_check check (quantidade >= 0);
