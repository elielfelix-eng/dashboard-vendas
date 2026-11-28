// Menu lateral: grupos, itens, ícones e as regras de visibilidade (data-model.md, Menu).
// As permissões vêm do banco (getPermissoes). Este arquivo só decide o que mostrar com elas.
import type { LucideIcon } from 'lucide-react';
import {
  BellRing,
  Funnel,
  Globe,
  GitCompareArrows,
  LayoutDashboard,
  Link2,
  Megaphone,
  Shapes,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Target,
  TrendingUp,
  Upload,
  UserCog,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';
import type { Permissao } from './permissoes';

export interface ItemMenu {
  href: string;
  rotulo: string;
  icone: LucideIcon;
  pronto: boolean;
  perm?: Permissao;
}

export interface GrupoMenu {
  rotulo: string;
  itens: ItemMenu[];
}

// Mesmas rotas, rótulos, permissões e itens "em breve" de antes. Só o agrupamento e os ícones são novos.
export const MENU: GrupoMenu[] = [
  {
    rotulo: 'Principal',
    itens: [
      { href: '/', rotulo: 'Visão Geral', icone: LayoutDashboard, pronto: true, perm: 'visao_geral' },
      { href: '/vendas', rotulo: 'Vendas', icone: ShoppingBag, pronto: true, perm: 'vendas' },
      { href: '/alertas', rotulo: 'Alertas e Reputação', icone: BellRing, pronto: true, perm: 'operacao' },
      { href: '/rentabilidade', rotulo: 'Rentabilidade', icone: TrendingUp, pronto: true, perm: 'rentabilidade' },
      { href: '/ads', rotulo: 'Ads', icone: Megaphone, pronto: true, perm: 'ads' },
      { href: '/comparativo', rotulo: 'Comparativo', icone: GitCompareArrows, pronto: true, perm: 'vendas' },
      { href: '/metas', rotulo: 'Metas e Projeção', icone: Target, pronto: true, perm: 'metas' },
      { href: '/anuncios', rotulo: 'Anúncios', icone: Tags, pronto: false },
      { href: '/novos-produtos', rotulo: 'Novos Produtos', icone: Sparkles, pronto: false },
    ],
  },
  {
    rotulo: 'CRM',
    itens: [
      { href: '/crm/funil', rotulo: 'Funil', icone: Funnel, pronto: true, perm: 'crm_funil' },
      { href: '/crm/vendedores', rotulo: 'Vendedores', icone: Users, pronto: true, perm: 'crm_vendedores' },
      { href: '/crm/origens', rotulo: 'Origens', icone: Globe, pronto: true, perm: 'crm_origens' },
    ],
  },
  {
    rotulo: 'ERP',
    itens: [
      { href: '/estoque', rotulo: 'Estoque', icone: Warehouse, pronto: false },
      { href: '/financeiro', rotulo: 'Financeiro', icone: Wallet, pronto: false },
    ],
  },
  {
    rotulo: 'Administração',
    itens: [
      { href: '/configuracoes/permissoes', rotulo: 'Permissões', icone: ShieldCheck, pronto: true, perm: 'configuracoes' },
      { href: '/configuracoes/parametros', rotulo: 'Parâmetros de custo', icone: SlidersHorizontal, pronto: true, perm: 'configuracoes' },
      { href: '/configuracoes/grupos-anuncios', rotulo: 'Grupos de anúncios', icone: Shapes, pronto: true, perm: 'editar_grupos' },
      { href: '/configuracoes/metas', rotulo: 'Metas (upload)', icone: Upload, pronto: true, perm: 'editar_metas' },
      { href: '/configuracoes/conexoes', rotulo: 'Conexões', icone: Link2, pronto: true, perm: 'configuracoes' },
      { href: '/configuracoes/vendedores-crm', rotulo: 'Vendedores do CRM', icone: UserCog, pronto: true, perm: 'configuracoes' },
    ],
  },
];

// Item com permissão exige a permissão. Item em desenvolvimento (pronto: false) só aparece
// para administradores (permissão 'configuracoes'). Grupo sem itens visíveis some.
export function menuVisivel(permissoes: Iterable<Permissao>): GrupoMenu[] {
  const perms = new Set(permissoes);
  const visivel = (item: ItemMenu) => {
    if (!item.pronto) return perms.has('configuracoes');
    return item.perm ? perms.has(item.perm) : perms.size > 0;
  };
  return MENU.map((grupo) => ({ ...grupo, itens: grupo.itens.filter(visivel) }))
    .filter((grupo) => grupo.itens.length > 0);
}

// A raiz só fica ativa na rota exata; as demais, por prefixo de segmento.
export function itemAtivo(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
