import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const MESSAGES: Record<string, { text: string; ok: boolean }> = {
  mercadolivre: { text: 'Conta do Mercado Livre conectada com sucesso.', ok: true },
  state: { text: 'A conexão expirou ou foi adulterada. Tente novamente.', ok: false },
  negado: { text: 'A autorização foi cancelada no Mercado Livre.', ok: false },
  falha: { text: 'Não foi possível concluir a conexão. Tente novamente.', ok: false },
};

const ETAPAS: Record<string, string> = {
  token: 'troca da autorização por tokens no Mercado Livre (confira ML_CLIENT_ID, ML_CLIENT_SECRET, Redirect URI e PKCE no app do ML)',
  conta: 'leitura dos dados da conta no Mercado Livre',
  banco: 'gravação no banco de dados (confira a DATABASE_URL na Vercel)',
};

export default async function ConexoesPage({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string; faltando?: string; etapa?: string; detalhe?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const msg = params.erro === 'falha' && params.etapa
    ? {
        text: `Não foi possível concluir a conexão. Etapa: ${ETAPAS[params.etapa] ?? params.etapa}. Detalhe: ${params.detalhe ?? '—'}`,
        ok: false,
      }
    : params.erro === 'config'
    ? {
        text: `Configuração do Mercado Livre incompleta na Vercel: ${(params.faltando ?? '').replace(/[^A-Z_, ()a-z]/g, '')}. ` +
          'Corrija em Settings > Environment Variables e faça Redeploy. O ML_REDIRECT_URI deve terminar em /api/oauth/mercadolivre/callback.',
        ok: false,
      }
    : MESSAGES[params.ok ?? params.erro ?? ''];

  const supabase = await createClient();
  const { data: accounts } = await supabase
    .schema('core')
    .from('accounts')
    .select('id, channel, nickname, external_id, active, created_at')
    .order('created_at');

  const ml = (accounts ?? []).filter((a) => a.channel === 'mercadolivre');

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Conexões</h1>
      <p className="mt-1 text-sm text-muted">
        Os tokens de acesso ficam criptografados no banco e nunca aparecem nesta tela.
      </p>

      {msg && (
        <p className={`mt-4 rounded-lg border px-4 py-3 text-sm ${msg.ok ? 'border-good text-good' : 'border-bad text-bad'}`}>{msg.text}</p>
      )}

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Mercado Livre</h2>
            <p className="text-sm text-muted">
              {ml.length ? ml.map((a) => `${a.nickname ?? a.external_id}${a.active ? '' : ' (inativa)'}`).join(', ') : 'Nenhuma conta conectada'}
            </p>
          </div>
          {/* Link comum (GET) para iniciar o OAuth — precisa sair do site */}
          <a href="/api/oauth/mercadolivre/start" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white">
            {ml.length ? 'Reconectar' : 'Conectar Mercado Livre'}
          </a>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-5 opacity-70">
        <h2 className="font-semibold">Shopee</h2>
        <p className="text-sm text-muted">Disponível após a aprovação no Shopee Open Platform (Fase 6).</p>
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-5 opacity-70">
        <h2 className="font-semibold">Bitrix24</h2>
        <p className="text-sm text-muted">Conexão via webhook somente leitura (Fase 5).</p>
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-5 opacity-70">
        <h2 className="font-semibold">ERP (SQL Server)</h2>
        <p className="text-sm text-muted">Via gateway instalado em uma máquina da rede (Fase 3).</p>
      </section>
    </div>
  );
}
