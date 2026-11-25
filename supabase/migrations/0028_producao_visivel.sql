-- =====================================================================
-- 0028 - Alertas: pedidos em producao visiveis fora da antecedencia
-- Pode ser reexecutada. Aplicar depois da 0027.
-- Regra do dono (opcao 1): todos os pedidos em producao ('pending' + 'manufacturing') aparecem na
-- lista de despacho. Os que ainda estao fora da antecedencia (hoje antes de prazo - antecedencia em
-- dias uteis) voltam com situacao 'em_producao' em vez de sumirem. 'em_producao' nao conta no aviso
-- do menu (analytics.alertas_contagem). Casos que motivaram: envios 48631458020 e 48617609826
-- (sem grupo, fim da producao 05/12 e 04/12), ocultos pela janela de 4 dias uteis.
-- Recria analytics.alertas_envio com a mesma assinatura e o mesmo retorno da 0027 e
-- analytics.alertas_contagem com a mesma assinatura da 0024.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lista de alertas por envio (despacho ou entrega)
-- EXCECAO DOCUMENTADA (security definer), como analytics.ads_serie: le pedidos, envios, grupos e
-- parametros com os direitos do dono; exige core.has_perm('operacao') e aplica core.can_see_channel
-- explicitamente (a RLS nao vale aqui). Sem a permissao (ou p_tipo invalido): zero linhas.
--  Despacho (0028): envio em producao (origem 'producao' ou 'estimado') fora da antecedencia -> 'em_producao'.
--   Nenhum outro envio recebe 'em_producao'; atrasada, em_risco e prazo_desconhecido nao mudam.
--  Ordem (0028): riscos, depois 'em_producao', depois 'prazo_desconhecido'.
--  Entrega (0027): alem da 0024, exclui envios 'pending' com substatus 'manufacturing' (ficam so no despacho).
--  Universo, demais filtros, antecedencia, situacao, faltam, despachado e ordem: iguais a 0024.
--  Prazo para terminar o produto (fim_producao): data de Brasilia de raw->>'manufacturing_ending_date'
--  (ex.: 2026-12-02T23:30:00-03:00 -> 2026-12-02). Num pacote, vale o menor entre os pedidos do envio.
--  Prazo usado:
--   despacho, envio lido, nao despachado, status 'pending' com substatus 'manufacturing'
--     (tela "Aguardando disponibilidade de estoque"; handling e ready_to_ship nao entram):
--       com fim_producao -> fim_producao, origem 'producao';
--       sem fim_producao -> 2 dias uteis antes de prazo_entrega,
--         origem 'estimado' (sem prazo_entrega: prazo nulo -> 'prazo_desconhecido');
--   demais casos -> prazo_despacho (despacho) ou prazo_entrega (entrega), origem 'envio'
--     (sem prazo_despacho: 'prazo_desconhecido').
--  O campo so e lido com fuso explicito (Z ou +-hh:mm); sem fuso, conta como ausente.
--  origem_prazo: 'producao' | 'envio' | 'estimado'; nula quando a situacao e 'prazo_desconhecido'.
-- ---------------------------------------------------------------------
drop function if exists analytics.alertas_envio(text, date);

create or replace function analytics.alertas_envio(p_tipo text,
                                                   p_hoje date default (now() at time zone 'America/Sao_Paulo')::date)
returns table (situacao text, shipment_id text, order_id text, pack_id text, item_id text, titulo text, grupo text,
               antecedencia integer, prazo date, faltam integer, status_envio text, substatus text, despachado boolean,
               origem_prazo text)
language sql stable security definer set search_path = '' as $$
  with ok as materialized (
    select core.has_perm('operacao') and coalesce(p_tipo, '') in ('despacho', 'entrega') as v,
           coalesce(p_hoje, (now() at time zone 'America/Sao_Paulo')::date) as hoje,
           coalesce((select pa.antecedencia_padrao from core.parametros_alertas pa limit 1), 4) as padrao
  ),
  env as materialized (
    -- um registro por pedido pago, com a leitura do prazo do envio (se houver)
    select o.channel, o.order_id, o.pack_id, o.shipment_id,
           coalesce(o.shipment_id, 'pedido:' || o.order_id) as chave,
           ep.shipment_id is not null as lido,
           ep.status, ep.substatus,
           case when p_tipo = 'despacho' then ep.prazo_despacho else ep.prazo_entrega end as prazo_envio,
           ep.prazo_entrega,
           case when o.raw->>'manufacturing_ending_date' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$'
                then ((o.raw->>'manufacturing_ending_date')::timestamptz at time zone 'America/Sao_Paulo')::date
           end as fim_producao,
           coalesce(ep.despachado_em is not null
                    or (ep.status is not null and ep.status not in ('pending', 'handling', 'ready_to_ship')), false) as despachado
      from mkt.orders o
      left join mkt.envios_prazos ep on ep.channel = o.channel and ep.shipment_id = o.shipment_id
     where (select ok.v from ok)
       and o.channel = 'mercadolivre'
       and o.status = 'paid'
       and core.can_see_channel(o.channel)
       and case
             when ep.shipment_id is null then
               coalesce((coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date
                          >= (select ok.hoje from ok) - 45, true)
             when coalesce(ep.status, '') = 'cancelled' then false
             when p_tipo = 'despacho' then coalesce(ep.status in ('pending', 'handling', 'ready_to_ship'), true)
             else coalesce(ep.status, '') not in ('delivered', 'not_delivered', 'cancelled')
                  and not coalesce(ep.status = 'pending' and ep.substatus = 'manufacturing', false)
           end
  ),
  item as materialized (
    -- um item por envio: o de maior antecedencia; fim_producao = o menor entre os pedidos do envio
    select distinct on (e.channel, e.chave)
           e.channel, e.chave, e.shipment_id, e.lido, e.status, e.substatus, e.prazo_envio, e.prazo_entrega, e.despachado,
           min(e.fim_producao) over (partition by e.channel, e.chave) as fim_producao,
           e.order_id, e.pack_id, oi.item_id, coalesce(oi.title, it.title) as titulo, g.nome as grupo,
           coalesce(g.antecedencia_dias, ok.padrao) as antecedencia
      from env e
      left join mkt.order_items oi on oi.channel = e.channel and oi.order_id = e.order_id
      left join core.grupo_anuncio_itens gi on gi.channel = oi.channel and gi.item_id = oi.item_id
      left join core.grupos_anuncio g on g.id = gi.grupo_id
      left join mkt.items it on it.channel = oi.channel and it.item_id = oi.item_id
     cross join ok
     order by e.channel, e.chave, coalesce(g.antecedencia_dias, ok.padrao) desc, e.order_id, oi.line_no
  ),
  pz as (
    select i.*,
           coalesce(p_tipo = 'despacho' and i.lido and not i.despachado
                    and i.status = 'pending' and i.substatus = 'manufacturing', false) as producao
      from item i
  ),
  prz as (
    select p.*,
           case when p.producao and p.fim_producao is not null then p.fim_producao
                when p.producao then core.subtrai_dias_uteis(p.prazo_entrega, 2)
                else p.prazo_envio end as prazo,
           case when p.producao and p.fim_producao is not null then 'producao'
                when p.producao then 'estimado'
                else 'envio' end as origem
      from pz p
  ),
  sit as (
    select i.*,
           case when i.prazo is null or not i.lido or (p_tipo = 'despacho' and i.status is null) then 'prazo_desconhecido'
                when ok.hoje > i.prazo then 'atrasada'
                when ok.hoje >= core.subtrai_dias_uteis(i.prazo, i.antecedencia) then 'em_risco'
                when i.producao then 'em_producao'
           end as situacao,
           case when ok.hoje > i.prazo then least(core.dias_uteis_ate(ok.hoje, i.prazo), -1)
                else core.dias_uteis_ate(ok.hoje, i.prazo) end as faltam
      from prz i
     cross join ok
  )
  select s.situacao, s.shipment_id, s.order_id, s.pack_id, s.item_id, s.titulo, s.grupo, s.antecedencia,
         s.prazo, s.faltam, s.status, s.substatus, s.despachado,
         case when s.situacao = 'prazo_desconhecido' then null else s.origem end
    from sit s
   where s.situacao is not null
   order by s.situacao = 'prazo_desconhecido',
            s.situacao = 'em_producao',
            p_tipo = 'entrega' and s.despachado,
            s.prazo, s.shipment_id, s.order_id
$$;

revoke execute on function analytics.alertas_envio(text, date) from public, anon;
grant execute on function analytics.alertas_envio(text, date) to authenticated;

-- ---------------------------------------------------------------------
-- Contagem para o aviso: envios distintos com atrasada, em_risco ou prazo_desconhecido nas duas listas
-- (um envio nas duas conta uma vez; 'em_producao' nao conta). Pedido sem envio conta pelo pedido.
-- Sem 'operacao': 0 (alertas_envio ja devolve zero linhas).
-- ---------------------------------------------------------------------
create or replace function analytics.alertas_contagem(p_hoje date default (now() at time zone 'America/Sao_Paulo')::date)
returns integer
language sql stable security invoker set search_path = '' as $$
  select count(distinct x.chave)::integer
    from (select coalesce(a.shipment_id, 'pedido:' || a.order_id) as chave, a.situacao from analytics.alertas_envio('despacho', p_hoje) a
          union all
          select coalesce(a.shipment_id, 'pedido:' || a.order_id), a.situacao from analytics.alertas_envio('entrega', p_hoje) a) x
   where x.situacao in ('atrasada', 'em_risco', 'prazo_desconhecido')
$$;

revoke execute on function analytics.alertas_contagem(date) from public, anon;
grant execute on function analytics.alertas_contagem(date) to authenticated;
