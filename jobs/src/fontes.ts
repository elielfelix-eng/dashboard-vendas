/** Fontes aceitas em --source. */
export const FONTES_PERMITIDAS = ['all', 'mercadolivre', 'bitrix24', 'shopee'];

export interface Fonte {
  fonte: string;
  rotulo: string;
  /** Devolve o número de falhas da fonte. */
  rodar: () => Promise<number>;
}

/**
 * Roda as fontes pedidas, uma de cada vez. Cada fonte tem o próprio contador:
 * uma falha (devolvida ou lançada) de uma não impede as outras.
 */
export async function rodarFontes(
  source: string,
  fontes: Fonte[],
  logErro: (msg: string) => void = (m) => console.error(m),
): Promise<number> {
  let falhas = 0;
  for (const f of fontes) {
    if (source !== 'all' && source !== f.fonte) continue;
    try {
      falhas += await f.rodar();
    } catch (err) {
      falhas++;
      logErro(`[${f.rotulo}] Falha geral: ${(err as Error).message}`);
    }
  }
  return falhas;
}
