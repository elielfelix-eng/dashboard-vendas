// Canais com vendas no painel (Mercado Livre e Shopee) e textos que dependem do canal.
// Sem dependências: testado com node --test.
import type { Canal } from './periodo.ts';

const NOMES: Record<Canal, string> = { consolidado: 'Consolidado', mercadolivre: 'Mercado Livre', shopee: 'Shopee' };
export const nomeCanal = (c: Canal) => NOMES[c];

/** Data 'YYYY-MM-DD' como dd/mm/aaaa. */
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Situação da Shopee no painel: loja conectada, última sincronização bem-sucedida e data da primeira venda guardada. */
export interface CoberturaShopee {
  conectada: boolean;
  ultimoSucesso: string | null;
  /** Primeiro dia (Brasília) com venda da Shopee no banco; nulo sem nenhuma venda. */
  inicio: string | null;
  /** O perfil do usuário vê o canal Shopee (core.can_see_channel): sem isso, nenhum aviso da Shopee aparece. */
  visivel: boolean;
}

/** A Shopee aparece nos filtros quando há loja conectada e ao menos uma sincronização bem-sucedida. */
export function shopeeAtiva(c: Pick<CoberturaShopee, 'conectada' | 'ultimoSucesso'>): boolean {
  return c.conectada && !!c.ultimoSucesso;
}

/**
 * Aviso de período sem dados da Shopee (Review Focus 5: "sem dados", nunca um zero que parece real).
 *  - semDados = true: o canal é a Shopee e o período inteiro fica sem dados (a tela troca os números pelo texto);
 *  - semDados = false: só um aviso acima dos números (período em parte antes dos dados, comparação sem base,
 *    ou consolidado sem a Shopee no período).
 */
export function avisoSemDadosShopee(
  canal: Canal,
  periodo: { de: string; ate: string; anteriorDe: string },
  c: CoberturaShopee,
): { semDados: boolean; texto: string } | null {
  if (canal === 'mercadolivre') return null;
  if (!c.visivel) return canal === 'shopee' ? { semDados: true, texto: 'Sem vendas no período.' } : null;
  const ativa = shopeeAtiva(c) && !!c.inicio;
  if (canal === 'consolidado') {
    if (!c.conectada) return null; // sem loja: o consolidado é só o Mercado Livre
    if (!ativa || periodo.ate < c.inicio!) return { semDados: false, texto: 'Sem dados da Shopee neste período: o consolidado mostra só o Mercado Livre.' };
    return null;
  }
  if (!ativa || periodo.ate < c.inicio!) return { semDados: true, texto: 'Sem dados da Shopee neste período.' };
  if (periodo.de < c.inicio!) {
    return { semDados: false, texto: `A Shopee tem dados a partir de ${br(c.inicio!)}; antes disso o período fica sem dados da Shopee (não é zero).` };
  }
  if (periodo.anteriorDe < c.inicio!) {
    return { semDados: false, texto: `A Shopee tem dados a partir de ${br(c.inicio!)}: a comparação com o período anterior fica sem base.` };
  }
  return null;
}

/** Mesmo dia do ano anterior ('YYYY-MM-DD'); 29/02 vira 28/02, como o "- interval '1 year'" do banco. */
const anoAntes = (iso: string) => {
  const y = Number(iso.slice(0, 4)) - 1;
  const md = iso.slice(5) === '02-29' ? '02-28' : iso.slice(5);
  return `${y}-${md}`;
};

/**
 * Cartões da Shopee: o período anterior começa antes da 1ª venda da Shopee, então a comparação não tem base
 * (a seta vira "—" em vez de comparar com um zero que não é real). Consolidado e Mercado Livre não mudam.
 */
export function semBaseAnteriorShopee(canal: Canal, periodo: { anteriorDe: string }, c: CoberturaShopee): boolean {
  return canal === 'shopee' && c.visivel && !!c.inicio && periodo.anteriorDe < c.inicio;
}

/**
 * Crescimento da Shopee com base real: comparação cujo período começa antes da 1ª venda da Shopee (`inicio`)
 * vira nula (período anterior, com a margem anterior; mesmo período do ano passado). A sugestão então segue a
 * regra do dono: sem ano passado usa só o anterior; sem anterior, sem_historico. Mercado Livre não muda.
 */
export function crescimentoComBase<T extends {
  canal: string; vendas_anterior: number | null; vendas_ano_passado: number | null; margem_pos_ads_anterior: number | null;
}>(linha: T, periodo: { de: string; anteriorDe: string }, inicio: string | null): T {
  if (linha.canal !== 'shopee') return linha;
  const semAnterior = !inicio || periodo.anteriorDe < inicio;
  const semAno = !inicio || anoAntes(periodo.de) < inicio;
  return {
    ...linha,
    vendas_anterior: semAnterior ? null : linha.vendas_anterior,
    margem_pos_ads_anterior: semAnterior ? null : linha.margem_pos_ads_anterior,
    vendas_ano_passado: semAno ? null : linha.vendas_ano_passado,
  };
}

type Sinc = Record<string, { ultimoSucesso: string | null } | undefined>;

/** "Atualizado em" do filtro: a do canal; no consolidado com a Shopee, a mais antiga das duas. */
export function atualizadoEmCanal(canal: Canal, sinc: Sinc, comShopee: boolean): string | null {
  const ml = sinc.mercadolivre?.ultimoSucesso ?? null;
  const sh = sinc.shopee?.ultimoSucesso ?? null;
  if (canal === 'mercadolivre') return ml;
  if (canal === 'shopee') return sh;
  if (!comShopee || !sh) return ml;
  if (!ml) return sh;
  return new Date(ml).getTime() <= new Date(sh).getTime() ? ml : sh;
}

/** A última sincronização da Shopee falhou por autorização (vencida ou recusada): pedir para reconectar. */
export function precisaReconectarShopee(s: { status: string; erro: string | null } | undefined): boolean {
  return s?.status === 'error' && /autoriza[cç][aã]o da shopee|reconecte/i.test(s.erro ?? '');
}

/** Canais cuja meta entra no cartão "Mês atual: realizado × meta" da Visão Geral. */
export function canaisDaMeta(canal: Canal, comShopee: boolean): Canal[] {
  if (canal !== 'consolidado') return [canal];
  return comShopee ? ['mercadolivre', 'shopee'] : ['mercadolivre'];
}

/** Soma realizado e meta do mês só dos canais que têm meta (o realizado de canal sem meta não entra). */
export function metaDoMes(linhas: { realizado: number | null; meta: number | null }[]): { realizado: number; meta: number } | null {
  const com = linhas.filter((l) => l.meta != null);
  if (!com.length) return null;
  return {
    realizado: Math.round(com.reduce((s, l) => s + (l.realizado ?? 0), 0) * 100) / 100,
    meta: Math.round(com.reduce((s, l) => s + (l.meta ?? 0), 0) * 100) / 100,
  };
}

/** Textos dos pedidos com tarifas estimadas (Rentabilidade). `atencao` vem logo depois do número de pedidos. */
export function textosEstimados(canal: Canal): { titulo: string; detalhe: string; ajuda: string; atencao: string } {
  if (canal === 'mercadolivre') {
    return {
      titulo: 'Aguardando a fatura do ML',
      detalhe: 'frete e comissão estimados; acertam sozinhos quando a fatura chegar',
      ajuda: 'Pedidos pagos que ainda não aparecem na fatura do Mercado Livre. Até lá, o frete e a comissão vêm do próprio pedido. Pedidos de meses já fechados sem fatura usam o frete que o ML descontou na própria venda e não entram aqui.',
      atencao: ' pedido(s) do período ainda não aparecem na fatura do Mercado Livre: o frete e a comissão deles foram estimados pelo próprio pedido e serão trocados pelos valores faturados nas próximas atualizações. Pedidos de meses já fechados sem fatura já usam o valor que o ML descontou na venda e não são contados.',
    };
  }
  if (canal === 'shopee') {
    return {
      titulo: 'Aguardando o pagamento da Shopee',
      detalhe: 'tarifas estimadas; acertam sozinhas quando a Shopee liberar o pagamento',
      ajuda: 'Pedidos pagos cujo detalhe de pagamento a Shopee ainda não liberou. Até lá, as tarifas usam a média dos pedidos da Shopee dos 90 dias anteriores.',
      atencao: ' pedido(s) do período ainda não têm o detalhe de pagamento da Shopee: as tarifas deles foram estimadas pela média dos 90 dias anteriores e serão trocadas pelos valores reais nas próximas atualizações.',
    };
  }
  return {
    titulo: 'Tarifas estimadas',
    detalhe: 'acertam sozinhas quando a fatura do ML ou o pagamento da Shopee chegar',
    ajuda: 'Mercado Livre: pedidos pagos que ainda não aparecem na fatura (frete e comissão vêm do próprio pedido). Shopee: pedidos pagos sem o detalhe de pagamento (tarifas pela média dos 90 dias anteriores).',
    atencao: ' pedido(s) do período ainda têm tarifas estimadas (Mercado Livre: aguardando a fatura; Shopee: aguardando o detalhe de pagamento) e serão trocados pelos valores reais nas próximas atualizações.',
  };
}

/** Texto do link do anúncio conforme o endereço. */
export const rotuloLinkAnuncio = (link: string) =>
  /(^|\.|\/\/)shopee\./i.test(link) ? 'Ver anúncio na Shopee ↗' : 'Ver anúncio no Mercado Livre ↗';
