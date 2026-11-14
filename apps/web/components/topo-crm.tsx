import { FiltroTopo } from '@/components/filtro-topo';
import { SeletoresCrm } from '@/components/seletores-crm';
import type { FiltrosCrm, LinhaOpcao } from '@/lib/crm';

export const AVISO_SEM_VINCULO = 'Seu usuário ainda não está ligado ao Bitrix — fale com o administrador.';

/** Perfil vendedor sem ligação com o Bitrix: a crm_opcoes não traz nenhum vendedor. */
export const semVinculo = (role: string | undefined, opcoes: LinhaOpcao[]) =>
  role === 'vendedor' && !opcoes.some((o) => o.tipo === 'vendedor');

interface Props {
  filtros: FiltrosCrm;
  opcoes: LinhaOpcao[];
  ehVendedor: boolean;
  atualizadoEm: string | null;
}

/** Barra de filtros comum às telas do CRM (período + área, vendedor e origem). */
export function TopoCrm({ filtros, opcoes, ehVendedor, atualizadoEm }: Props) {
  return (
    <FiltroTopo canal="consolidado" chave={filtros.chave} periodo={filtros.periodo} atualizadoEm={atualizadoEm} mostrarCanal={false}>
      <SeletoresCrm opcoes={opcoes} area={filtros.area} vendedor={filtros.vendedor} origem={filtros.origem} travarVendedor={ehVendedor} />
    </FiltroTopo>
  );
}
