'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AdsSeriePonto } from '@/lib/ads';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const curto = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(Math.round(v)));
const estilo = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };

/** Barras = investimento do dia; linha = vendas atribuídas a Ads no dia. */
export function GraficoAds({ serie }: { serie: AdsSeriePonto[] }) {
  const dados = serie.map((p) => ({ rotulo: `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}`, investimento: p.investimento, vendas: p.vendas_ads }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval="preserveStartEnd" />
          <YAxis tickFormatter={curto} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={56} />
          <Tooltip formatter={(v) => (v == null ? '—' : BRL.format(Number(v)))} contentStyle={estilo} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="investimento" name="Investimento" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          <Line dataKey="vendas" name="Vendas por Ads" stroke="var(--good)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
