-- Reverte apenas a classificação aplicada por `classificar_produtos_buffet.sql`.
-- Devolve os mesmos produtos para `outro` e desliga o retorno, sem tocar em
-- produtos que a operação tenha classificado depois. Se já houver fechamento,
-- perda, devolução ou autorização de retorno registrada, a reversão é
-- bloqueada para não reescrever histórico operacional.
--
-- Passo manual:
--   psql "$DATABASE_URL" -f neon/classificar_produtos_buffet_reverter.sql
--
-- O trigger `produtos_saldo_do_livro` exige sessão de usuário para qualquer
-- UPDATE em `produtos`; como aqui só se mexe em classificação, ele é desligado
-- durante a reversão e religado no fim, na mesma transação.

do $$
begin
  if exists (select 1 from public.fechamentos_buffet)
     or exists (select 1 from public.perdas_buffet)
     or exists (select 1 from public.devolucoes_buffet) then
    raise exception
      'Há operações de Buffet registradas; a classificação não pode ser revertida.';
  end if;
end;
$$;

alter table public.produtos disable trigger produtos_saldo_do_livro;

update public.produtos
   set permite_retorno_buffet = false
 where permite_retorno_buffet = true
   and nome in ('Granola crocante', 'Leite em pó');

update public.produtos
   set tipo_produto = 'outro'
 where tipo_produto in ('buffet', 'insumo')
   and nome in (
     'Acai self-service',
     'Granola crocante',
     'Leite em pó',
     'Morango',
     'Morango fresco',
     'Banana'
   );

alter table public.produtos enable trigger produtos_saldo_do_livro;

notify pgrst, 'reload schema';
