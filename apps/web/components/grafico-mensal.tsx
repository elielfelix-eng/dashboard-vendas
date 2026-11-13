'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const curto = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil` : String(Math.round(v)));
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const estilo = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 };

/** Barras = receita do mês; linha = margem de contribuição do mês. */
export function GraficoMensal({ linhas }: { linhas: { mes: string; receita: number; margem_contribuicao: number | null }[] }) {
  const dados = linhas.map((l) => ({
    rotulo: `${MESES[Number(l.mes.slice(5, 7)) - 1]}/${l.mes.slice(2, 4)}`,
    receita: l.receita,
    margem: l.margem_contribuicao,
  }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis tickFormatter={curto} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={56} />
          <Tooltip formatter={(v) => (v == null ? '—' : BRL.format(Number(v)))} contentStyle={estilo} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="receita" name="Receita" fill="var(--accent)" radius={[3, 3, 0, 0]} />
          <Line dataKey="margem" name="Margem de contribuição" stroke="var(--good)" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const CORES = ['var(--muted)', '#a78bfa', '#f59e0b', '#14b8a6', 'var(--accent)'];

/** Uma linha por ano, de janeiro a dezembro, para comparar os anos. */
export function GraficoAnos({ linhas, medida, rotulo }: {
  linhas: { mes: string; receita: number; margem_contribuicao: number | null }[];
  medida: 'receita' | 'margem_contribuicao';
  rotulo: string;
}) {
  const anos = [...new Set(linhas.map((l) => l.mes.slice(0, 4)))].sort();
  const dados = MESES.map((m, i) => {
    const ponto: Record<string, string | number | null> = { rotulo: m };
    for (const a of anos) {
      const l = linhas.find((x) => x.mes === `${a}-${String(i + 1).padStart(2, '0')}-01`);
      ponto[a] = l ? l[medida] : null;
    }
    return ponto;
  });
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis tickFormatter={curto} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={56} />
          <Tooltip formatter={(v, nome) => [v == null ? '—' : BRL.format(Number(v)), `${rotulo} ${nome}`]} contentStyle={estilo} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {anos.map((a, i) => (
            <Line key={a} dataKey={a} name={a} stroke={CORES[(CORES.length - anos.length + i + CORES.length) % CORES.length]}
              strokeWidth={a === anos.at(-1) ? 3 : 2} dot={false} connectNulls={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
