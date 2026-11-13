// Resultado por ano a partir do resultado mensal. Sem dependências: testado com node --test.

interface Mes {
  mes: string; pedidos: number; receita: number; comissao: number; frete: number; parcelamento: number;
  product_ads: number; seguidores: number; estornos: number; difal: number; outras: number;
  custo_produto: number | null; margem_contribuicao: number | null;
}

export interface LinhaAno {
  ano: number; meses_venda: number; pedidos: number; receita: number; custos_ml: number; publicidade: number;
  custo_produto: number | null; margem: number | null; margem_pct: number | null;
}

export const pctDe = (v: number | null | undefined, base: number | null | undefined) =>
  v == null || !base ? null : (v / base) * 100;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Soma os meses por ano. Custos do ML = todas as tarifas (inclui publicidade); publicidade = Ads + Seguidores + estornos. */
export function agregarAnual(meses: Mes[]): LinhaAno[] {
  const anos = new Map<number, LinhaAno>();
  for (const m of meses) {
    const ano = Number(m.mes.slice(0, 4));
    const a = anos.get(ano) ?? { ano, meses_venda: 0, pedidos: 0, receita: 0, custos_ml: 0, publicidade: 0, custo_produto: 0, margem: 0, margem_pct: null };
    a.meses_venda += m.pedidos > 0 ? 1 : 0;
    a.pedidos += m.pedidos;
    a.receita += m.receita;
    a.publicidade += m.product_ads + m.seguidores + m.estornos;
    a.custos_ml += m.comissao + m.frete + m.parcelamento + m.product_ads + m.seguidores + m.estornos + m.difal + m.outras;
    a.custo_produto = a.custo_produto == null || m.custo_produto == null ? null : a.custo_produto + m.custo_produto;
    a.margem = a.margem == null || m.margem_contribuicao == null ? null : a.margem + m.margem_contribuicao;
    anos.set(ano, a);
  }
  return [...anos.values()]
    .filter((a) => a.pedidos > 0 || a.receita !== 0)
    .sort((x, y) => x.ano - y.ano)
    .map((a) => ({
      ...a,
      receita: r2(a.receita), custos_ml: r2(a.custos_ml), publicidade: r2(a.publicidade),
      custo_produto: a.custo_produto == null ? null : r2(a.custo_produto),
      margem: a.margem == null ? null : r2(a.margem),
      margem_pct: a.margem == null ? null : pctDe(a.margem, a.receita),
    }));
}
