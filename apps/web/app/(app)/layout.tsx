import { AvisoSincronizacao } from '@/components/aviso-sincronizacao';
import { ShellPainel } from '@/components/shell-painel';
import { contarAlertas } from '@/lib/alertas';
import { requireUser, ROLE_LABEL } from '@/lib/auth';
import { getPermissoes } from '@/lib/permissoes';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  const permissoes = await getPermissoes();
  let alertas = 0;
  if (permissoes.has('operacao')) {
    try { alertas = await contarAlertas(); } catch { alertas = 0; }
  }
  return (
    <ShellPainel
      nome={profile?.full_name ?? user.email ?? ''}
      perfil={profile?.role ? ROLE_LABEL[profile.role] : 'sem perfil'}
      permissoes={[...permissoes]}
      alertas={alertas}
    >
      <AvisoSincronizacao />
      {children}
    </ShellPainel>
  );
}
