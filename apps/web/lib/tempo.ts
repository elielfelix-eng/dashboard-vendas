/**
 * Mede quanto uma etapa do servidor demora e registra no log da Vercel só o rótulo e os milissegundos
 * (nunca parâmetros nem dados). Serve para achar as consultas lentas do painel.
 */
export async function medir<T>(rotulo: string, fn: () => Promise<T>): Promise<T> {
  const inicio = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[tempo] ${rotulo} ${Math.round(performance.now() - inicio)}ms`);
  }
}
