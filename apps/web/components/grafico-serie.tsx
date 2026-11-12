'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SeriePonto } from '@/lib/dash';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const curto = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(Math.round(v)));

function rotulo(iso: string, grao: 'dia' | 'semana' | 'mes') {
  if (grao === 'mes') return `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

interface Props {
  atual: SeriePonto[];
  anterior: SeriePonto[];
  medida?: 'vendas_brutas' | 'receita';
  grao?: 'dia' | 'semana' | 'mes';
}

/** Barras = período atual; linha = período anterior, alinhado pela posição (1º dia com 1º dia). */
export function GraficoSerie({ atual, anterior, medida = 'vendas_brutas', grao = 'dia' }: Props) {
  const dados = atual.map((p, i) => ({
    rotulo: rotulo(p.periodo, grao),
    atual: p[medida],
    anterior: anterior[i]?.[medida] ?? null,
  }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval="preserveStartEnd" />
          <YAxis tickFormatter={curto} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={56} />
          <Tooltip
            formatter={(v) => BRL.format(Number(v))}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="atual" name="Período atual" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          <Line dataKey="anterior" name="Período anterior" stroke="var(--muted)" strokeDasharray="4 3" dot={false} strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
