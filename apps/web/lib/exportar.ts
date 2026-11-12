import writeXlsxFile from 'write-excel-file/browser';

export type TipoColuna = 'texto' | 'brl' | 'num' | 'pct' | 'variacao';
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
      if (c.tipo === 'texto') return { value: String(v) };
      return { value: Number(v), format: c.tipo === 'brl' ? '#,##0.00' : c.tipo === 'pct' ? '0.0' : '#,##0' };
    }),
  );
  await writeXlsxFile([cabecalho, ...corpo]).toFile(`${nomeArquivo}.xlsx`);
}
