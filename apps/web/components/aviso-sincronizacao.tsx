import { sincronizacoes } from '@/lib/dash';

const NOMES: Record<string, string> = { mercadolivre: 'Mercado Livre', erp: 'ERP (custos)' };

/** Faixa de aviso quando a última atualização do Mercado Livre ou do ERP falhou. */
export async function AvisoSincronizacao() {
  let falhas: string[] = [];
  try {
    const s = await sincronizacoes();
    falhas = Object.keys(NOMES).filter((k) => s[k]?.status === 'error');
  } catch {
    return null;
  }
  if (!falhas.length) return null;
  return (
    <div className="mb-4 rounded-lg border border-bad/40 bg-surface px-4 py-2 text-sm text-bad">
      A última atualização de {falhas.map((f) => NOMES[f]).join(' e ')} falhou. Os números podem estar desatualizados.
    </div>
  );
}
