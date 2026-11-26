import Link from 'next/link';
import { precisaReconectarShopee } from '@/lib/canais';
import { sincronizacoes } from '@/lib/dash';

const NOMES: Record<string, string> = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', erp: 'ERP (custos)' };

/**
 * Faixa de aviso quando a última atualização do Mercado Livre, da Shopee ou do ERP falhou.
 * Shopee com autorização vencida ou recusada: pede para reconectar a loja (Review Focus 2).
 */
export async function AvisoSincronizacao() {
  let falhas: string[] = [];
  let reconectar = false;
  try {
    const s = await sincronizacoes();
    reconectar = precisaReconectarShopee(s.shopee);
    falhas = Object.keys(NOMES).filter((k) => s[k]?.status === 'error' && !(k === 'shopee' && reconectar));
  } catch {
    return null;
  }
  if (!falhas.length && !reconectar) return null;
  return (
    <>
      {reconectar && (
        <div role="alert" className="mb-4 rounded-lg border border-bad/40 bg-surface px-4 py-2 text-sm text-bad">
          A Shopee pediu uma nova autorização e os dados dela pararam de atualizar: reconecte a Shopee em{' '}
          <Link href="/configuracoes/conexoes" className="underline">Configurações › Conexões</Link> (só o administrador).
        </div>
      )}
      {falhas.length > 0 && (
        <div className="mb-4 rounded-lg border border-bad/40 bg-surface px-4 py-2 text-sm text-bad">
          A última atualização de {falhas.map((f) => NOMES[f]).join(' e ')} falhou. Os números podem estar desatualizados.
        </div>
      )}
    </>
  );
}
