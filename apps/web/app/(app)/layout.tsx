import { Sidebar } from '@/components/sidebar';
import { AvisoSincronizacao } from '@/components/aviso-sincronizacao';
import { contarAlertas } from '@/lib/alertas';
import { requireUser } from '@/lib/auth';
import { getPermissoes } from '@/lib/permissoes';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  const permissoes = await getPermissoes();
  let alertas = 0;
  if (permissoes.has('operacao')) {
    try { alertas = await contarAlertas(); } catch { alertas = 0; }
  }
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar role={profile?.role} name={profile?.full_name ?? user.email ?? ''} permissoes={[...permissoes]} alertas={alertas} />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <AvisoSincronizacao />
        {children}
      </main>
    </div>
  );
}
