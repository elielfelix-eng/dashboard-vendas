import writeXlsxFile from 'write-excel-file/browser';

export type TipoColuna = 'texto' | 'brl' | 'num' | 'dec1' | 'pct' | 'variacao' | 'sugestao' | 'roas';
export interface Coluna<T> {
  chave: keyof T & string;
  titulo: string;
  tipo: TipoColuna;
}

type Celula = { value: string | number; fontWeight?: 'bold'; format?: string } | null;

/** Baixa um .xlsx com as colunas e linhas que estão na tela. */
export async function exportarXlsx<T extends object>(nomeArquivo: string, colunas: Coluna<T>[], linhas: T[]): Promise<void> {
  const cabecalho: Celula[] = colunas.map((c) => ({ value: c.titulo, fontWeight: 'bold' }));
  const corpo: Celula[][] = linhas.map((l) =>
    colunas.map((c) => {
      const v = (l as Record<string, unknown>)[c.chave];
      if (v == null) return null;
      if (c.tipo === 'variacao') return { value: (v as { rotulo: string }).rotulo };
      if (c.tipo === 'sugestao') { const x = v as { rotulo: string; motivo: string | null }; return { value: x.motivo ? `${x.rotulo} — ${x.motivo}` : x.rotulo }; }
      if (c.tipo === 'texto') return { value: String(v) };
      return { value: Number(v), format: c.tipo === 'brl' ? '#,##0.00' : c.tipo === 'pct' || c.tipo === 'dec1' ? '0.0' : c.tipo === 'roas' ? '0.00' : '#,##0' };
    }),
  );
  await writeXlsxFile([cabecalho, ...corpo]).toFile(`${nomeArquivo}.xlsx`);
}
