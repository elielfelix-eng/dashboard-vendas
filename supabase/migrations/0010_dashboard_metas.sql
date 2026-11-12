-- =====================================================================
-- 0010 - Dashboard: metas e projecao mensal
-- Pode ser reexecutada. Ordem de aplicacao: 0003 -> 0006 -> 0007 -> 0008 -> 0009 -> 0010.
--
-- Realizado = receita (pedidos pagos) do mes. A projecao parte do ultimo mes FECHADO;
-- o mes em andamento aparece so como referencia. Cada mes projetado = mes anterior
-- (realizado ou projetado) x (1 + crescimento/100). Crescimento = premissa do mes
-- (editada) ou, se nao houver, o padrao do canal no ano; sem nada, 0.
-- 'consolidado' soma os canais (realizado, projecao e meta).
-- =====================================================================

drop function if exists analytics.dash_metas(text, integer, date);

create function analytics.dash_metas(p_canal text, p_ano integer,
                                     p_hoje date default (now() at time zone 'America/Sao_Paulo')::date)
returns table (mes date, situacao text, realizado numeric, crescimento_pct numeric,
               crescimento_editado boolean, projecao numeric, meta numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_atual  date := date_trunc('month', p_hoje)::date;
  v_inicio date := (date_trunc('month', p_hoje) - interval '12 months')::date;
  v_fim    date := make_date(p_ano, 12, 1);
  v_m      date;
  v_base   numeric := 0;
  v_proj   numeric;
  v_cresc  numeric;
  v_edit   boolean;
  v_meses  date[] := '{}';
  v_vals   numeric[] := '{}';
  v_i      integer;
begin
  if not core.has_perm('metas') then
    return;
  end if;

  if p_canal = 'consolidado' then
    return query
      select d.mes,
             min(d.situacao),
             sum(d.realizado),
             null::numeric,
             null::boolean,
             sum(d.projecao),
             sum(d.meta)
        from (
          select * from analytics.dash_metas('mercadolivre', p_ano, p_hoje)
          union all select * from analytics.dash_metas('shopee', p_ano, p_hoje)
          union all select * from analytics.dash_metas('brindedobem', p_ano, p_hoje)
        ) d
       group by d.mes
       order by d.mes;
    return;
  end if;

  -- Receita mensal calculada UMA vez (a base de pedidos e cara); so canais com vendas no painel.
  if p_canal = 'mercadolivre' then
    select coalesce(array_agg(x.m order by x.m), '{}'), coalesce(array_agg(x.r order by x.m), '{}')
      into v_meses, v_vals
      from (select date_trunc('month', b.data_venda)::date as m, sum(b.receita) as r
              from analytics.dash_pedidos_base() b
             where b.channel = p_canal and b.data_venda >= v_inicio and b.data_venda < (v_atual + interval '1 month')
             group by 1) x;
  end if;

  v_m := v_inicio;
  while v_m <= v_fim loop
    mes := v_m;
    meta := (select mt.valor from core.metas mt
              where mt.channel = p_canal and mt.ano = extract(year from v_m) and mt.mes = extract(month from v_m));

    if v_m <= v_atual then
      v_i := array_position(v_meses, v_m);
      realizado := coalesce(case when v_i is null then 0 else v_vals[v_i] end, 0);
    else
      realizado := null;
    end if;

    if v_m < v_atual then
      situacao := 'realizado';
      crescimento_pct := null;
      crescimento_editado := null;
      projecao := null;
      v_base := realizado;
    else
      situacao := case when v_m = v_atual then 'em_andamento' else 'projetado' end;
      select p.crescimento_pct into v_cresc
        from core.premissas_projecao p
       where p.channel = p_canal and p.ano = extract(year from v_m) and p.mes = extract(month from v_m);
      v_edit := found;
      if not v_edit then
        v_cresc := coalesce((select p.crescimento_pct from core.premissas_projecao p
                              where p.channel = p_canal and p.ano = extract(year from v_m) and p.mes is null), 0);
      end if;
      v_proj := coalesce(v_proj, v_base) * (1 + v_cresc / 100);
      crescimento_pct := v_cresc;
      crescimento_editado := v_edit;
      projecao := round(v_proj, 2);
    end if;

    return next;
    v_m := (v_m + interval '1 month')::date;
  end loop;
end $$;

grant execute on function analytics.dash_metas(text, integer, date) to authenticated;
