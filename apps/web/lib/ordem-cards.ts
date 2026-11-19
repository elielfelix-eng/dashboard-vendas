// Ordem dos cards salva no navegador. Funções puras (testadas em ordem-cards.test.ts).

/** Ordem salva aplicada aos itens atuais: chaves que sumiram são ignoradas; itens novos vão para o fim, na ordem recebida. */
export function aplicarOrdem<T extends { chave: string }>(itens: T[], ordem: string[]): T[] {
  const porChave = new Map(itens.map((i) => [i.chave, i]));
  const usadas = [...new Set(ordem)].filter((c) => porChave.has(c));
  const faltam = itens.map((i) => i.chave).filter((c) => !usadas.includes(c));
  return [...usadas, ...faltam].map((c) => porChave.get(c)!);
}

/** Lê a ordem gravada (texto JSON). Qualquer coisa fora do formato vira null (ordem padrão). */
export function lerOrdemGravada(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  } catch {
    return null;
  }
}
