import Link from 'next/link';
import { logout } from '@/app/login/actions';
import { ROLE_LABEL, type Role } from '@/lib/auth';

interface NavItem { href: string; label: string; ready: boolean; roles?: Role[] }

const COST_ROLES: Role[] = ['admin', 'gestor'];

const NAV: { section: string; items: NavItem[] }[] = [
  { section: 'Marketplaces', items: [
    { href: '/', label: 'Visão Geral', ready: true },
    { href: '/vendas', label: 'Vendas', ready: false },
    { href: '/rentabilidade', label: 'Rentabilidade', ready: false, roles: COST_ROLES },
    { href: '/anuncios', label: 'Anúncios', ready: false },
    { href: '/ads', label: 'Ads', ready: false },
    { href: '/novos-produtos', label: 'Novos Produtos', ready: false },
  ]},
  { section: 'CRM', items: [
    { href: '/crm/funil', label: 'Funil', ready: false },
    { href: '/crm/vendedores', label: 'Vendedores', ready: false },
    { href: '/crm/origens', label: 'Origens', ready: false },
  ]},
  { section: 'ERP', items: [
    { href: '/estoque', label: 'Estoque', ready: false },
    { href: '/financeiro', label: 'Financeiro', ready: false, roles: COST_ROLES },
  ]},
  { section: 'Administração', items: [
    { href: '/configuracoes/conexoes', label: 'Conexões', ready: true, roles: ['admin'] },
  ]},
];

export function Sidebar({ role, name }: { role: Role | undefined; name: string }) {
  return (
    <aside className="flex w-full flex-col border-b border-border bg-surface md:min-h-screen md:w-60 md:border-r md:border-b-0">
      <div className="px-5 py-5">
        <p className="text-lg font-semibold">Painel de Vendas</p>
        <p className="text-xs text-muted">{name} · {role ? ROLE_LABEL[role] : 'sem perfil'}</p>
      </div>
      <nav className="flex-1 overflow-x-auto px-3 pb-4">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.roles || (role && i.roles.includes(role)));
          if (!items.length) return null;
          return (
            <div key={group.section} className="mb-4">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.section}</p>
              {items.map((i) => i.ready ? (
                <Link key={i.href} href={i.href} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-accent-soft">{i.label}</Link>
              ) : (
                <span key={i.href} className="flex items-center justify-between px-2 py-1.5 text-sm text-muted" title="Disponível em uma próxima fase">
                  {i.label}<span className="rounded bg-bg px-1.5 text-[10px]">em breve</span>
                </span>
              ))}
            </div>
          );
        })}
      </nav>
      <form action={logout} className="px-5 pb-5">
        <button className="text-sm text-muted hover:text-text">Sair</button>
      </form>
    </aside>
  );
}
