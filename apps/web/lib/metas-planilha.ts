// Validação da planilha de metas (Canal | Ano | Mês | Meta). Sem dependências: testado com node --test.

export type CanalMeta = 'mercadolivre' | 'shopee' | 'brindedobem';
export interface LinhaMetaValida { channel: CanalMeta; ano: number; mes: number; valor: number }
export interface ErroLinha { linha: number; motivo: string }

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '').trim();

const CANAIS: Record<string, CanalMeta> = { mercadolivre: 'mercadolivre', shopee: 'shopee', brindedobem: 'brindedobem' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const vazio = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');

function lerNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^R\$\s*/i, '');
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? n : null;
}

function lerMes(v: unknown): number | null {
  const n = lerNumero(v);
  if (n != null) return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
  if (typeof v !== 'string') return null;
  const i = MESES.indexOf(semAcento(v).slice(0, 3));
  return i >= 0 ? i + 1 : null;
}

function colunas(cab: unknown[]): Record<'canal' | 'ano' | 'mes' | 'meta', number> | ErroLinha {
  const nomes = cab.map((c) => semAcento(String(c ?? '')));
  const achar = (...alvos: string[]) => nomes.findIndex((n) => alvos.includes(n));
  const idx = { canal: achar('canal', 'marketplace'), ano: achar('ano'), mes: achar('mes'), meta: achar('meta', 'valor') };
  const faltando = (Object.entries(idx) as [string, number][]).find(([, i]) => i < 0);
  if (faltando) {
    const rot = { canal: 'Canal', ano: 'Ano', mes: 'Mês', meta: 'Meta' }[faltando[0]];
    return { linha: 1, motivo: `coluna ${rot} não encontrada` };
  }
  return idx;
}

export function validarLinhasMetas(linhas: unknown[][]): { validas: LinhaMetaValida[]; erros: ErroLinha[]; totais: Record<string, number> } {
  const validas: LinhaMetaValida[] = [];
  const erros: ErroLinha[] = [];
  if (!linhas.length) return { validas, erros: [{ linha: 1, motivo: 'planilha vazia' }], totais: {} };
  const idx = colunas(linhas[0]);
  if ('motivo' in idx) return { validas, erros: [idx], totais: {} };

  const vistos = new Map<string, number>();
  linhas.slice(1).forEach((l, i) => {
    const linha = i + 2;
    if (l.every(vazio)) return;
    const [rCanal, rAno, rMes, rMeta] = [l[idx.canal], l[idx.ano], l[idx.mes], l[idx.meta]];

    const channel = vazio(rCanal) ? undefined : CANAIS[semAcento(String(rCanal))];
    if (!channel) return erros.push({ linha, motivo: vazio(rCanal) ? 'canal ausente' : `canal desconhecido: "${rCanal}"` });
    if (vazio(rAno)) return erros.push({ linha, motivo: 'ano ausente' });
    const ano = lerNumero(rAno);
    if (ano == null || !Number.isInteger(ano) || ano < 2000 || ano > 2100) return erros.push({ linha, motivo: `ano inválido: "${rAno}"` });
    if (vazio(rMes)) return erros.push({ linha, motivo: 'mês ausente' });
    const mes = lerMes(rMes);
    if (mes == null) return erros.push({ linha, motivo: `mês inválido: "${rMes}"` });
    if (vazio(rMeta)) return erros.push({ linha, motivo: 'meta ausente' });
    const valor = lerNumero(rMeta);
    if (valor == null) return erros.push({ linha, motivo: `meta não numérica: "${rMeta}"` });
    if (valor < 0) return erros.push({ linha, motivo: 'meta negativa' });

    const chave = `${channel}|${ano}|${mes}`;
    const antes = vistos.get(chave);
    if (antes) return erros.push({ linha, motivo: `repete canal, ano e mês da linha ${antes}` });
    vistos.set(chave, linha);
    validas.push({ channel, ano, mes, valor: Math.round(valor * 100) / 100 });
  });

  const totais: Record<string, number> = {};
  for (const v of validas) totais[v.channel] = Math.round(((totais[v.channel] ?? 0) + v.valor) * 100) / 100;
  return { validas, erros, totais };
}
