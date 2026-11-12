// Formatos de exibição (pt-BR). Sem dependências: testado com node --test.

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const DEC1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const brl = (v: number | null | undefined) => (v == null ? '—' : BRL.format(v));
export const num = (v: number | null | undefined) => (v == null ? '—' : INT.format(v));
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${DEC1.format(v)}%`);
export const dataBr = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/** Variação percentual do período atual sobre o anterior. */
export function variacao(atual: number | null | undefined, anterior: number | null | undefined): { valor: number | null; rotulo: string } {
  if (atual == null || anterior == null) return { valor: null, rotulo: '—' };
  if (anterior === 0) return atual === 0 ? { valor: null, rotulo: '—' } : { valor: null, rotulo: 'novo' };
  const valor = ((atual - anterior) / Math.abs(anterior)) * 100;
  return { valor, rotulo: `${valor >= 0 ? '▲' : '▼'} ${DEC1.format(Math.abs(valor))}%` };
}

/** Diferença em pontos percentuais (para margens em %). */
export function variacaoPp(atual: number | null | undefined, anterior: number | null | undefined): { valor: number | null; rotulo: string } {
  if (atual == null || anterior == null) return { valor: null, rotulo: '—' };
  const valor = atual - anterior;
  return { valor, rotulo: `${valor >= 0 ? '▲' : '▼'} ${DEC1.format(Math.abs(valor))} p.p.` };
}
