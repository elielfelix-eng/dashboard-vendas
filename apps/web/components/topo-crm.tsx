import { FiltroTopo } from '@/components/filtro-topo';
import { SeletoresCrm } from '@/components/seletores-crm';
import type { FiltrosCrm, LinhaOpcao } from '@/lib/crm';

export const AVISO_SEM_VINCULO = 'Seu usuário ainda não está ligado ao Bitrix — fale com o administrador.';

/** Perfil vendedor sem ligação com o Bitrix (core.my_bitrix_id() nulo). */
export const semVinculo = (role: string | undefined, meuBitrixId: number | null) =>
  role === 'vendedor' && meuBitrixId === null;

/** Última sincronização do Bitrix (de dash.sincronizacoes()). */
interface SincBitrix { status: string; quando: string | null; ultimoSucesso: string | null }

interface Props {
  filtros: FiltrosCrm;
  opcoes: LinhaOpcao[];
  ehVendedor: boolean;
  sinc: SincBitrix | undefined;
}

const dataHora = (iso: string) =>
  new Date(iso)
    .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .replace(',', '');

/** Barra de filtros comum às telas do CRM (período + área, vendedor e origem) e o aviso de falha do Bitrix. */
export function TopoCrm({ filtros, opcoes, ehVendedor, sinc }: Props) {
  const falhou = sinc?.status === 'error';
  return (
    <>
      {falhou && (
        <div className="mb-4 rounded-lg border border-bad/40 bg-surface px-4 py-2 text-sm text-bad">
          A última atualização do Bitrix falhou{sinc.quando ? ` em ${dataHora(sinc.quando)}` : ''}. Os números podem estar desatualizados.
        </div>
      )}
      <FiltroTopo canal="consolidado" chave={filtros.chave} periodo={filtros.periodo} atualizadoEm={sinc?.ultimoSucesso ?? null} mostrarCanal={false}>
        <SeletoresCrm opcoes={opcoes} area={filtros.area} vendedor={filtros.vendedor} origem={filtros.origem} travarVendedor={ehVendedor} />
      </FiltroTopo>
    </>
  );
}
