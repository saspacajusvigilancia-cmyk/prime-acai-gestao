-- ============================================================================
-- Classificação dos produtos do Estoque Buffet · passo manual, não é NN_*
-- ============================================================================
-- A migração 27 criou o fechamento por turno, as perdas e as devoluções, mas
-- não classifica produto nenhum — de propósito. Sem produto `buffet`/`insumo`
-- o snapshot de abertura nasce vazio. Este roteiro aplica a classificação
-- aprovada para a operação atual da Prime Açaí.
--
-- Não tem numeração de propósito: é configuração de dados da filial, não
-- schema. Rode uma vez por base, como `garantir_perfil_novo.sql`:
--
--   psql "$DATABASE_URL" -f neon/classificar_produtos_buffet.sql
--
-- ou cole no SQL Editor do Neon. A reversão está em
-- `classificar_produtos_buffet_reverter.sql`.
--
-- Regras:
--  * `Acai self-service` passa a `buffet` (o que entra no buffet).
--  * Itens consumidos na montagem passam a `insumo`.
--  * `permite_retorno_buffet` só é ligado nos insumos lacrados (granola e
--    leite em pó). Perecíveis como morango e banana ficam sem retorno, e a
--    constraint `produtos_retorno_buffet_tipo_valido` exige tipo buffet/insumo
--    para ligar a coluna — embalagem e venda direta não podem habilitar.
--
-- Tudo é condicional ao nome existente e ao tipo ainda ser `outro`: repetir a
-- migração não reposiciona produto já classificado pela operação.
-- Não há DDL nem alteração de política, RLS ou função.
--
-- O trigger `produtos_saldo_do_livro` (migração 06/24) valida a filial a partir
-- de `auth.uid()` e aborta qualquer UPDATE feito fora de uma sessão de usuário.
-- Como aqui só se mexe em classificação — nunca em `quantidade` — o trigger é
-- desligado durante a migração e religado no fim, dentro da mesma transação:
-- se qualquer passo falhar, o rollback devolve o trigger ligado.

alter table public.produtos disable trigger produtos_saldo_do_livro;

update public.produtos
   set tipo_produto = 'buffet'
 where tipo_produto = 'outro'
   and nome = 'Acai self-service';

update public.produtos
   set tipo_produto = 'insumo'
 where tipo_produto = 'outro'
   and nome in (
     'Granola crocante',
     'Leite em pó',
     'Morango',
     'Morango fresco',
     'Banana'
   );

update public.produtos
   set permite_retorno_buffet = true
 where permite_retorno_buffet = false
   and tipo_produto in ('buffet', 'insumo')
   and nome in (
     'Granola crocante',
     'Leite em pó'
   );

alter table public.produtos enable trigger produtos_saldo_do_livro;

notify pgrst, 'reload schema';
