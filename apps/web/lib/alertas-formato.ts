// Textos e cores da tela de alertas (sem dependências, testável).

const plural = (n: number) => (n === 1 ? 'dia útil' : 'dias úteis');

/** Quanto falta para o prazo, em dias úteis (negativo = atrasada). */
export function textoFaltam(faltam: number | null, situacao: string): string {
  if (situacao === 'atrasada') return faltam != null && faltam < 0 ? `atrasada há ${-faltam} ${plural(-faltam)}` : 'atrasada';
  if (situacao === 'prazo_desconhecido' || faltam == null) return 'prazo desconhecido';
  if (faltam < 0) return `atrasada há ${-faltam} ${plural(-faltam)}`;
  if (faltam === 0) return 'vence hoje';
  return `${faltam} ${plural(faltam)}`;
}

/** Separa da lista de despacho os pedidos 'em_producao' (fora da antecedência), ordenados pelo prazo. */
export function separarProducao<T extends { situacao: string; prazo: string | null }>(linhas: T[]): { riscos: T[]; emProducao: T[] } {
  const emProducao = linhas.filter((l) => l.situacao === 'em_producao')
    .sort((a, b) => (a.prazo ?? '9999-12-31').localeCompare(b.prazo ?? '9999-12-31'));
  return { riscos: linhas.filter((l) => l.situacao !== 'em_producao'), emProducao };
}

const STATUS_ENVIO: Record<string, string> = {
  pending: 'Pendente', handling: 'Em preparação', ready_to_ship: 'Pronto para envio', shipped: 'A caminho',
  delivered: 'Entregue', not_delivered: 'Não entregue', cancelled: 'Cancelado',
};
// ready_to_ship já postado ou coletado (o Mercado Livre mostra "A caminho"; o painel conta como despachado).
const SUBSTATUS_PRONTO: Record<string, string> = {
  dropped_off: 'Postado', picked_up: 'Coletado', in_hub: 'No centro de distribuição',
};

/** Rótulo do status do envio; em ready_to_ship usa o substatus quando já foi postado ou coletado. */
export function rotuloStatusEnvio(status: string | null, substatus: string | null): string {
  if (!status) return '—';
  if (status === 'ready_to_ship' && substatus && SUBSTATUS_PRONTO[substatus]) return SUBSTATUS_PRONTO[substatus];
  return STATUS_ENVIO[status] ?? status;
}

const ORIGENS: Record<string, string> = { producao: 'Terminar produto', envio: 'Despacho', estimado: 'Estimado' };

/** Rótulo da origem do prazo na lista de despacho ('—' quando não há). */
export function rotuloOrigem(origem: string | null): string {
  return (origem && ORIGENS[origem]) || '—';
}

const NIVEIS: Record<string, { nome: string; classe: string }> = {
  '5_green': { nome: 'Verde', classe: 'bg-green-600 text-white' },
  '4_light_green': { nome: 'Verde-claro', classe: 'bg-lime-500 text-white' },
  '3_yellow': { nome: 'Amarelo', classe: 'bg-yellow-400 text-black' },
  '2_orange': { nome: 'Laranja', classe: 'bg-orange-500 text-white' },
  '1_red': { nome: 'Vermelho', classe: 'bg-red-600 text-white' },
};

/** Nome e classe de cor do nível de reputação do Mercado Livre. */
export function corDoNivel(levelId: string | null): { nome: string; classe: string } {
  return (levelId && NIVEIS[levelId]) || { nome: 'Sem reputação', classe: 'bg-bg text-muted border border-border' };
}
