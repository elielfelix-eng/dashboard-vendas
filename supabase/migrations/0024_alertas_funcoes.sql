-- =====================================================================
-- 0024 - Alertas de atraso e reputacao: calculo em dias uteis, listas de alerta e reputacao
-- Pode ser reexecutada. Aplicar depois da 0023.
-- Dia util = segunda a sexta, fora das datas de core.feriados. "Hoje" = data de Brasilia.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Dias uteis
-- ---------------------------------------------------------------------

-- Volta p_n dias uteis a partir de p_data (p_n <= 0 devolve a propria data).
-- Ex.: (2026-11-30, 4) -> 2026-11-24; (2026-11-23, 1) -> 2026-11-19 (pula fim de semana e o feriado de 20/11).
create or replace function core.subtrai_dias_uteis(p_data date, p_n integer)
returns date
language plpgsql stable strict set search_path = '' as $$
declare
  v_d date := p_data;
  v_n integer := greatest(p_n, 0);
begin
  while v_n > 0 loop
    v_d := v_d - 1;
    if extract(isodow from v_d) < 6 and not exists (select 1 from core.feriados f where f.data = v_d) then
      v_n := v_n - 1;
    end if;
  end loop;
  return v_d;
end $$;

-- Dias uteis em (p_de, p_ate]; negativo quando p_ate < p_de (conta (p_ate, p_de] com sinal trocado).
-- Ex.: (2026-11-24, 2026-11-30) -> 4; (2026-11-30, 2026-11-30) -> 0; (2026-12-01, 2026-11-30) -> -1.
create or replace function core.dias_uteis_ate(p_de date, p_ate date)
returns integer
language sql stable strict set search_path = '' as $$
  select (case when p_ate >= p_de then 1 else -1 end * count(*))::integer
    from generate_series(least(p_de, p_ate) + 1, greatest(p_de, p_ate), interval '1 day') g(d)
   where extract(isodow from g.d) < 6
     and not exists (select 1 from core.feriados f where f.data = g.d::date)
$$;

grant execute on function core.subtrai_dias_uteis(date, integer), core.dias_uteis_ate(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Lista de alertas por envio (despacho ou entrega)
-- EXCECAO DOCUMENTADA (security definer), como analytics.ads_serie: le pedidos, envios, grupos e
-- parametros com os direitos do dono; exige core.has_perm('operacao') e aplica core.can_see_channel
-- explicitamente (a RLS nao vale aqui). Sem a permissao (ou p_tipo invalido): zero linhas.
--  Universo: envios de mkt.envios_prazos com pelo menos um pedido 'paid' (so os itens dos pedidos pagos
--  contam) e envio fora de 'cancelled'.
--   despacho: status in ('pending','handling','ready_to_ship'); prazo = prazo_despacho.
--     (Lista padrao do plano; o levantamento da Task 1 ainda nao rodou - revisar quando rodar.)
--   entrega: status fora de ('delivered','not_delivered','cancelled'), status nulo entra; prazo = prazo_entrega.
--  Antecedencia: a maior entre os itens do envio (grupo do anuncio ou, sem grupo,
--  core.parametros_alertas.antecedencia_padrao). item_id, titulo e grupo vem desse item.
--  Situacao: prazo nulo -> 'prazo_desconhecido'; hoje > prazo -> 'atrasada';
--  hoje >= prazo - antecedencia (dias uteis) -> 'em_risco'; fora disso nao entra.
--  faltam = core.dias_uteis_ate(hoje, prazo). despachado = despachado_em preenchido ou status
--  conhecido fora da lista de despacho.
--  Ordem: prazo_desconhecido por ultimo; na entrega, os nao despachados primeiro; depois o prazo.
-- ---------------------------------------------------------------------
create or replace function analytics.alertas_envio(p_tipo text,
                                                   p_hoje date default (now() at time zone 'America/Sao_Paulo')::date)
returns table (situacao text, shipment_id text, order_id text, pack_id text, item_id text, titulo text, grupo text,
               antecedencia integer, prazo date, faltam integer, status_envio text, substatus text, despachado boolean)
language sql stable security definer set search_path = '' as $$
  with ok as materialized (
    select core.has_perm('operacao') and coalesce(p_tipo, '') in ('despacho', 'entrega') as v,
           coalesce(p_hoje, (now() at time zone 'America/Sao_Paulo')::date) as hoje,
           coalesce((select pa.antecedencia_padrao from core.parametros_alertas pa limit 1), 4) as padrao
  ),
  env as materialized (
    select ep.channel, ep.shipment_id, ep.status, ep.substatus,
           case when p_tipo = 'despacho' then ep.prazo_despacho else ep.prazo_entrega end as prazo,
           ep.despachado_em is not null
             or (ep.status is not null and ep.status not in ('pending', 'handling', 'ready_to_ship')) as despachado
      from mkt.envios_prazos ep
     where (select ok.v from ok)
       and core.can_see_channel(ep.channel)
       and coalesce(ep.status, '') <> 'cancelled'
       and case when p_tipo = 'despacho' then coalesce(ep.status in ('pending', 'handling', 'ready_to_ship'), false)
                else coalesce(ep.status, '') not in ('delivered', 'not_delivered', 'cancelled') end
  ),
  item as materialized (
    -- um item por envio: o de maior antecedencia
    select distinct on (e.channel, e.shipment_id)
           e.channel, e.shipment_id, e.status, e.substatus, e.prazo, e.despachado,
           o.order_id, o.pack_id, oi.item_id, coalesce(oi.title, it.title) as titulo, g.nome as grupo,
           coalesce(g.antecedencia_dias, ok.padrao) as antecedencia
      from env e
      join mkt.orders o on o.channel = e.channel and o.shipment_id = e.shipment_id and o.status = 'paid'
      left join mkt.order_items oi on oi.channel = o.channel and oi.order_id = o.order_id
      left join core.grupo_anuncio_itens gi on gi.channel = oi.channel and gi.item_id = oi.item_id
      left join core.grupos_anuncio g on g.id = gi.grupo_id
      left join mkt.items it on it.channel = oi.channel and it.item_id = oi.item_id
     cross join ok
     order by e.channel, e.shipment_id, coalesce(g.antecedencia_dias, ok.padrao) desc, o.order_id, oi.line_no
  ),
  sit as (
    select i.*,
           case when i.prazo is null then 'prazo_desconhecido'
                when ok.hoje > i.prazo then 'atrasada'
                when ok.hoje >= core.subtrai_dias_uteis(i.prazo, i.antecedencia) then 'em_risco'
           end as situacao,
           core.dias_uteis_ate(ok.hoje, i.prazo) as faltam
      from item i
     cross join ok
  )
  select s.situacao, s.shipment_id, s.order_id, s.pack_id, s.item_id, s.titulo, s.grupo, s.antecedencia,
         s.prazo, s.faltam, s.status, s.substatus, s.despachado
    from sit s
   where s.situacao is not null
   order by s.situacao = 'prazo_desconhecido',
            p_tipo = 'entrega' and s.despachado,
            s.prazo, s.shipment_id
$$;

revoke execute on function analytics.alertas_envio(text, date) from public, anon;
grant execute on function analytics.alertas_envio(text, date) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Contagem para o aviso: envios distintos nas duas listas (um envio nas duas conta uma vez).
-- Sem 'operacao': 0 (alertas_envio ja devolve zero linhas).
-- ---------------------------------------------------------------------
create or replace function analytics.alertas_contagem(p_hoje date default (now() at time zone 'America/Sao_Paulo')::date)
returns integer
language sql stable security invoker set search_path = '' as $$
  select count(distinct x.shipment_id)::integer
    from (select a.shipment_id from analytics.alertas_envio('despacho', p_hoje) a
          union all
          select a.shipment_id from analytics.alertas_envio('entrega', p_hoje) a) x
$$;

revoke execute on function analytics.alertas_contagem(date) from public, anon;
grant execute on function analytics.alertas_contagem(date) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Reputacao atual: 3 linhas (reclamacoes, cancelamentos, atrasos) da foto mais recente.
-- security definer como alertas_envio; exige core.has_perm('operacao'), senao zero linhas.
--  limite_pct = core.reputacao_limites do nivel da foto (nulo se nao cadastrado).
--  perto = valor >= limite * perto_limite_pct / 100; acima = valor > limite. Limite nulo -> ambos nulos.
-- ---------------------------------------------------------------------
create or replace function analytics.reputacao_atual()
returns table (level_id text, power_seller_status text, capturado_em timestamptz, indicador text,
               valor_pct numeric, limite_pct numeric, perto boolean, acima boolean)
language sql stable security definer set search_path = '' as $$
  with f as materialized (
    select rf.*
      from mkt.reputacao_fotos rf
     where core.has_perm('operacao')
     order by rf.capturado_em desc
     limit 1
  ),
  par as materialized (
    select coalesce((select pa.perto_limite_pct from core.parametros_alertas pa limit 1), 80) as perto
  )
  select f.level_id, f.power_seller_status, f.capturado_em, i.indicador, i.valor, l.limite_pct,
         i.valor >= l.limite_pct * par.perto / 100,
         i.valor > l.limite_pct
    from f
   cross join lateral (values (1, 'reclamacoes', f.reclamacoes_taxa),
                              (2, 'cancelamentos', f.cancelamentos_taxa),
                              (3, 'atrasos', f.atrasos_taxa)) i(ordem, indicador, valor)
   cross join par
    left join core.reputacao_limites l on l.level_id = f.level_id and l.indicador = i.indicador
   order by i.ordem
$$;

revoke execute on function analytics.reputacao_atual() from public, anon;
grant execute on function analytics.reputacao_atual() to authenticated;

-- ---------------------------------------------------------------------
-- 5. Serie da reputacao: a ultima foto de cada dia (Brasilia) nos ultimos p_dias dias.
-- security definer; exige core.has_perm('operacao'), senao zero linhas.
-- ---------------------------------------------------------------------
create or replace function analytics.reputacao_serie(p_dias integer default 180)
returns table (dia date, level_id text, reclamacoes numeric, cancelamentos numeric, atrasos numeric)
language sql stable security definer set search_path = '' as $$
  select distinct on (x.dia) x.dia, x.level_id, x.reclamacoes_taxa, x.cancelamentos_taxa, x.atrasos_taxa
    from (select (rf.capturado_em at time zone 'America/Sao_Paulo')::date as dia, rf.*
            from mkt.reputacao_fotos rf
           where core.has_perm('operacao')) x
   where x.dia >= (now() at time zone 'America/Sao_Paulo')::date - coalesce(p_dias, 180)
   order by x.dia, x.capturado_em desc
$$;

revoke execute on function analytics.reputacao_serie(integer) from public, anon;
grant execute on function analytics.reputacao_serie(integer) to authenticated;
