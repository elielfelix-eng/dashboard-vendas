// Ícone de cada cartão de indicador, escolhido pelo título (research.md R5).
// Assim nenhuma tela precisa passar o ícone: todos os cartões existentes ganham o seu.
import type { LucideIcon } from 'lucide-react';
import {
  Calculator,
  ChartNoAxesColumn,
  Clock,
  Coins,
  Funnel,
  Globe,
  Megaphone,
  Package,
  Percent,
  Receipt,
  ShoppingBag,
  Target,
  Ticket,
  Trophy,
  Users,
  XCircle,
} from 'lucide-react';

// Regras em ordem: a primeira que casar vence. Palavras comparadas inteiras (sem acento e em minúsculas),
// para que "Leads" não case com "ads".
const REGRAS: { palavras: string[]; icone: LucideIcon }[] = [
  { palavras: ['cancelados', 'cancelado', 'cancelada', 'canceladas', 'devolvidos', 'devolvidas', 'devolvido', 'devolvida'], icone: XCircle },
  { palavras: ['margem'], icone: Percent },
  { palavras: ['ads', 'investimento', 'campanhas', 'campanha', 'roas', 'acos', 'tacos'], icone: Megaphone },
  { palavras: ['lead', 'leads', 'funil', 'etapa', 'etapas', 'negocio', 'negocios'], icone: Funnel },
  { palavras: ['ganho', 'ganha', 'ganhos'], icone: Trophy },
  { palavras: ['ticket'], icone: Ticket },
  { palavras: ['ciclo'], icone: Clock },
  { palavras: ['ranking', 'vendedor', 'vendedores'], icone: Users },
  { palavras: ['origem', 'origens'], icone: Globe },
  { palavras: ['meta', 'metas'], icone: Target },
  { palavras: ['custo', 'custos'], icone: Calculator },
  { palavras: ['unidade', 'unidades'], icone: Package },
  { palavras: ['preco'], icone: Coins },
  { palavras: ['pedido', 'pedidos', 'quantidade'], icone: Receipt },
  { palavras: ['venda', 'vendas', 'receita', 'faturamento'], icone: ShoppingBag },
];

const ICONE_DE_RESERVA = ChartNoAxesColumn;

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function iconeDoCartao(titulo: string): LucideIcon {
  const palavras = new Set(semAcento(titulo).split(/[^a-z0-9%]+/).filter(Boolean));
  const regra = REGRAS.find((r) => r.palavras.some((p) => palavras.has(p)));
  return regra?.icone ?? ICONE_DE_RESERVA;
}
