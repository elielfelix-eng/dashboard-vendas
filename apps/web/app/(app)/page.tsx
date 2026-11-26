import Link from 'next/link';
import { AvisoDados, CartaoIndicador, ErroDados, SemDados } from '@/components/cartao-indicador';
import { GradeArrastavel } from '@/components/grade-arrastavel';
import { ComoCalculamos } from '@/components/como-calculamos';
import { FotoProduto } from '@/components/foto-produto';
import { FiltroTopo } from '@/components/filtro-topo';
import { GraficoSerie } from '@/components/grafico-serie';
import { PainelAtencao } from '@/components/painel-atencao';
import { atualizadoEmCanal, avisoSemDadosShopee, canaisDaMeta, metaDoMes } from '@/lib/canais';
import * as dash from '@/lib/dash';
import { brl, dataBr, num, pct, variacao } from '@/lib/formato';
import { granularidadeDoPeriodo, hojeBrasilia, lerFiltros, resolverPeriodo } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

const margemPct = (m: number | null, receita: number) => (m == null || receita === 0 ? null : (m / receita) * 100);

export default async function VisaoGeralPage({ searchParams }: { searchParams: SP }) {
  const perms = await exigirPermissao('visao_geral');
  const hoje = hojeBrasilia();
  const { canal, chave, periodo } = lerFiltros(await searchParams, hoje);
  const verCustos = perms.has('custos');

  let dados;
  try {
    const ontem = resolverPeriodo('hoje', hoje).anteriorDe;
    const sinc = await dash.sincronizacoes();
    const shopee = await dash.contextoShopee(sinc);
    const ano = Number(hoje.slice(0, 4));
    const [atual, anterior, serieAtual, serieAnterior, modelos, metas, rHoje, rOntem] = await Promise.all([
      dash.resumo(canal, periodo.de, periodo.ate),
      dash.resumo(canal, periodo.anteriorDe, periodo.anteriorAte),
      dash.serie(canal, periodo.de, periodo.ate, granularidadeDoPeriodo(chave)),
      dash.serie(canal, periodo.anteriorDe, periodo.anteriorAte, granularidadeDoPeriodo(chave)),
      dash.modelos(canal, periodo.de, periodo.ate),
      perms.has('metas') ? Promise.all(canaisDaMeta(canal, shopee.ativa).map((c) => dash.metas(c, ano))) : Promise.resolve([]),
      dash.resumo(canal, hoje, hoje),
      dash.resumo(canal, ontem, ontem),
    ]);
    dados = { atual, anterior, serieAtual, serieAnterior, modelos, sinc, metas, rHoje, rOntem, shopee };
  } catch (e) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-4 text-2xl font-semibold">Visão Geral</h1>
        <ErroDados mensagem={(e as Error).message} />
      </div>
    );
  }
  const { atual: a, anterior: p, serieAtual, serieAnterior, modelos, sinc, metas, rHoje, rOntem, shopee } = dados;
  const mes = `${hoje.slice(0, 7)}-01`;
  // Meta do mês: no consolidado, soma as metas do Mercado Livre e da Shopee (só canais com meta cadastrada).
  const mesAtual = metaDoMes(metas.map((linhas) => linhas.find((m) => m.mes === mes) ?? { realizado: null, meta: null }));
  const aviso = avisoSemDadosShopee(canal, periodo, shopee.cob);
  const avisoHoje = avisoSemDadosShopee(canal, { de: hoje, ate: hoje, anteriorDe: hoje }, shopee.cob);
  const tacos = a.vendas_brutas > 0 ? (a.product_ads / a.vendas_brutas) * 100 : null;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-2xl font-semibold">Visão Geral</h1>
      <FiltroTopo canal={canal} chave={chave} periodo={periodo} shopeeAtiva={shopee.ativa}
        atualizadoEm={atualizadoEmCanal(canal, sinc, shopee.ativa)} />

      <section className="mb-6 rounded-xl border border-accent/40 bg-accent-soft p-4">
        <p className="text-sm text-muted">Vendas de hoje, {dataBr(hoje)}</p>
        {avisoHoje?.semDados ? <p className="mt-1 text-sm">{avisoHoje.texto}</p> : (
          <>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{brl(rHoje.receita)}</p>
            <p className="mt-1 text-sm">
              {num(rHoje.pedidos)} pedidos · {num(rHoje.unidades)} unidades
              <span className="text-muted"> · Ontem: {brl(rOntem.receita)} em {num(rOntem.pedidos)} pedidos</span>
            </p>
          </>
        )}
        <p className="mt-1 text-xs text-muted">Receita = pedidos pagos. Os números de hoje mudam a cada atualização (08h, 13h e 17h).</p>
      </section>

      {aviso && !aviso.semDados && <AvisoDados texto={aviso.texto} />}
      {aviso?.semDados ? (
        <SemDados texto={aviso.texto} />
      ) : a.pedidos === 0 ? (
        <SemDados />
      ) : (
        <>
          <GradeArrastavel id="visao-geral" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" itens={[
            { chave: 'vendas-brutas', node: <CartaoIndicador titulo="Vendas brutas" valor={brl(a.vendas_brutas)} variacao={variacao(a.vendas_brutas, p.vendas_brutas)}
              ajuda={canal === 'mercadolivre' ? 'Pedidos pagos, cancelados e devolvidos (sem divididos), igual ao painel do Mercado Livre.'
                : canal === 'shopee' ? 'Pedidos pagos e cancelados depois do pagamento.'
                : 'Mercado Livre: pedidos pagos, cancelados e devolvidos (sem divididos). Shopee: pedidos pagos e cancelados depois do pagamento.'} /> },
            { chave: 'pedidos', node: <CartaoIndicador titulo="Pedidos" valor={num(a.pedidos)} variacao={variacao(a.pedidos, p.pedidos)} /> },
            { chave: 'unidades', node: <CartaoIndicador titulo="Unidades" valor={num(a.unidades)} variacao={variacao(a.unidades, p.unidades)} /> },
            { chave: 'ticket-medio', node: <CartaoIndicador titulo="Ticket médio" valor={brl(a.ticket_medio)} variacao={variacao(a.ticket_medio, p.ticket_medio)} /> },
            ...(verCustos && a.margem_bruta != null ? [{ chave: 'margem-bruta', node: <CartaoIndicador titulo="Margem bruta" valor={brl(a.margem_bruta)} variacao={variacao(a.margem_bruta, p.margem_bruta)}
              detalhe={pct(margemPct(a.margem_bruta, a.receita))} ajuda="Receita (pedidos pagos) menos o custo dos produtos." /> }] : []),
            ...(verCustos && a.margem_contribuicao != null ? [{ chave: 'margem-contribuicao', node: <CartaoIndicador titulo="Margem de contribuição" valor={brl(a.margem_contribuicao)}
              variacao={variacao(a.margem_contribuicao, p.margem_contribuicao)} detalhe={pct(margemPct(a.margem_contribuicao, a.receita))}
              ajuda={`Receita menos tarifas ${canal === 'mercadolivre' ? 'do Mercado Livre' : canal === 'shopee' ? 'da Shopee' : 'do Mercado Livre e da Shopee'}, frete, Ads, imposto, embalagem e custo dos produtos.`} /> }] : []),
            { chave: 'ads', node: <CartaoIndicador titulo="Ads" valor={brl(a.product_ads)} variacao={variacao(a.product_ads, p.product_ads)} inverterCores
              detalhe={`TACOS ${pct(tacos)}`} ajuda="Investimento em Product Ads. TACOS = Ads ÷ vendas brutas." /> },
            { chave: 'cancelados', node: <CartaoIndicador titulo="Cancelados e devolvidos" valor={num(a.cancelados + a.devolvidos)}
              variacao={variacao(a.cancelados + a.devolvidos, p.cancelados + p.devolvidos)} inverterCores
              detalhe={`${pct(a.pct_cancel_devol)} dos pedidos`} /> },
            ...(mesAtual != null && mesAtual.meta !== 0 ? [{ chave: 'meta-mes', node: <CartaoIndicador titulo="Mês atual: realizado × meta" valor={`${pct((mesAtual.realizado / mesAtual.meta) * 100)}`}
              detalhe={`${brl(mesAtual.realizado)} de ${brl(mesAtual.meta)}`} ajuda="Receita (pedidos pagos) do mês até hoje ÷ meta do mês." /> }] : []),
          ]} />

          <section className="mt-6 rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Vendas brutas por dia</h2>
            <GraficoSerie atual={serieAtual} anterior={serieAnterior} grao={granularidadeDoPeriodo(chave)} />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="text-sm font-semibold">Top 5 modelos (vendas brutas)</h2>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {modelos.slice(0, 5).map((m) => (
                    <tr key={m.modelo} className="border-t border-border">
                      <td className="py-1.5">
                        <span className="flex items-center gap-2">
                          <FotoProduto src={m.foto} alt={m.modelo ?? 'sem SKU'} />
                          {m.modelo ? <Link href={`/vendas/${encodeURIComponent(m.modelo)}`} className="hover:underline">{m.modelo}</Link> : '(sem SKU)'}
                        </span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{brl(m.vendas_brutas)}</td>
                      {verCustos && (
                        <td className="py-1.5 text-right text-muted tabular-nums" title={m.receita === 0 ? 'Margem é calculada sobre os pedidos pagos; neste período as vendas do modelo foram canceladas ou devolvidas.' : undefined}>
                          {m.contribuicao_pct != null ? `margem ${pct(m.contribuicao_pct)}` : m.receita === 0 ? 'sem pedidos pagos' : ''}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PainelAtencao pedidosSemCusto={verCustos ? a.pedidos_sem_custo : null} sincronizacoes={sinc} comShopee={shopee.cob.conectada} />
          </section>
          <ComoCalculamos verCustos={verCustos} canal={canal} />
        </>
      )}
    </div>
  );
}
