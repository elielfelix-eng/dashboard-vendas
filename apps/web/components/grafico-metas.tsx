'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { LinhaMeta } from '@/lib/dash';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const curto = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : String(Math.round(v)));
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Barras = realizado; tracejado = projeção; linha = meta. */
export function GraficoMetas({ linhas }: { linhas: LinhaMeta[] }) {
  const dados = linhas.map((l) => ({
    rotulo: `${MESES[Number(l.mes.slice(5, 7)) - 1]}/${l.mes.slice(2, 4)}`,
    realizado: l.realizado,
    projecao: l.projecao,
    meta: l.meta,
  }));
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval="preserveStartEnd" />
          <YAxis tickFormatter={curto} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={56} />
          <Tooltip
            formatter={(v) => (v == null ? '—' : BRL.format(Number(v)))}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="realizado" name="Realizado" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          <Line dataKey="projecao" name="Projeção" stroke="var(--accent)" strokeDasharray="5 4" strokeWidth={2} dot={false} connectNulls={false} />
          <Line dataKey="meta" name="Meta" stroke="var(--good)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
