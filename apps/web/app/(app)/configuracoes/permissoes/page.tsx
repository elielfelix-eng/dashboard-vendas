import { MatrizPermissoes } from '@/components/matriz-permissoes';
import { requireUser, ROLE_LABEL, type Role } from '@/lib/auth';
import { exigirPermissao, PERMISSOES } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';

const PERFIS: Role[] = ['admin', 'gestor', 'comercial', 'visualizador', 'vendedor'];

export default async function PermissoesPage() {
  await exigirPermissao('configuracoes');
  const { profile } = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.schema('core').from('role_permissions').select('role, permission, allowed');
  const marcadas = (data ?? []).filter((r) => r.allowed).map((r) => `${r.role}|${r.permission}`);
  const ehAdmin = profile?.role === 'admin';

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-2xl font-semibold">Permissões</h1>
      <p className="mb-4 text-sm text-muted">
        Marque o que cada perfil pode ver. A mudança vale na hora para todos os usuários do perfil, e o banco também respeita:
        sem &quot;Vê custo/margem&quot;, custo e margem não são entregues nem pela API.
        {!ehAdmin && ' Só o administrador pode alterar.'}
      </p>
      <MatrizPermissoes
        perfis={PERFIS.map((r) => ({ role: r, rotulo: ROLE_LABEL[r] }))}
        permissoes={PERMISSOES}
        marcadas={marcadas}
        podeEditar={ehAdmin}
      />
      <p className="mt-3 text-xs text-muted">O perfil Vendedor é usado pelo CRM (Bitrix24), que entra numa próxima fase.</p>
    </div>
  );
}
