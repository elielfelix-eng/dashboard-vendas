import { exigirPermissao } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';
import { alternarOrigem, desvincular, vincular } from './actions';

type SP = Promise<Record<string, string | string[] | undefined>>;
type OrigemAdmin = { source_id: string; nome: string | null; ativo: boolean };
type Vinculo = { bitrix_id: number; nome: string; email: string | null; ativo: boolean; user_id: string | null; usuario: string | null; tipo: 'automatico' | 'manual' | null };
const inp = 'rounded border border-border bg-surface px-2 py-1';

export default async function VendedoresCrmPage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('configuracoes');
  const sp = await searchParams;
  const supabase = await createClient();
  // O schema crm não é exposto na Data API: tudo vem por funções do schema core.
  const [vinc, perfis, fontes] = await Promise.all([
    supabase.schema('core').rpc('crm_vinculos'),
    supabase.schema('core').from('user_profiles').select('user_id, full_name').order('full_name'),
    supabase.schema('core').rpc('crm_origens_admin'),
  ]);
  const vendedores = (vinc.data ?? []) as Vinculo[];
  const usuarios = (perfis.data ?? []).map((p) => ({
    id: p.user_id as string,
    rotulo: (p.full_name as string | null)?.trim() || `Usuário ${String(p.user_id).slice(0, 8)}`,
  }));
  const origens = (fontes.data ?? []) as OrigemAdmin[];
  const semDados = vendedores.length === 0;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold">Vendedores do CRM</h1>
      <p className="mb-4 text-sm text-muted">
        Ligue cada vendedor do Bitrix ao usuário dele no painel. Quando o e-mail é igual, a ligação é automática.
      </p>
      {typeof sp.ok === 'string' && <p className="mb-3 text-sm text-good">{sp.ok}</p>}
      {typeof sp.erro === 'string' && <p className="mb-3 text-sm text-bad">{sp.erro}</p>}
      {(vinc.error || fontes.error) && <p className="mb-3 text-sm text-bad">Não foi possível carregar os dados agora.</p>}

      <h2 className="mb-2 text-lg font-semibold">Vendedores do Bitrix</h2>
      {semDados ? (
        <p className="mb-6 text-sm text-muted">Ainda não há dados do Bitrix. Rode a sincronização primeiro.</p>
      ) : (
        <div className="mb-8 overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="px-3 py-2 text-left font-medium">Vendedor</th>
                <th className="px-3 py-2 text-left font-medium">E-mail</th>
                <th className="px-3 py-2 text-left font-medium">Ativo</th>
                <th className="px-3 py-2 text-left font-medium">Usuário do painel</th>
                <th className="px-3 py-2 text-left font-medium">Ligar a</th>
              </tr>
            </thead>
            <tbody>
              {vendedores.map((v) => {
                const ligado = v.tipo === 'automatico' || v.tipo === 'manual';
                return (
                  <tr key={String(v.bitrix_id)} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{v.nome}</td>
                    <td className="px-3 py-2 text-muted">{v.email ?? '-'}</td>
                    <td className="px-3 py-2">{v.ativo ? 'Sim' : 'Não'}</td>
                    <td className="px-3 py-2">
                      {ligado ? (
                        <>
                          {v.usuario}{' '}
                          <span className="rounded bg-border px-1.5 py-0.5 text-xs text-muted">
                            {v.tipo === 'automatico' ? 'automático (e-mail)' : 'manual'}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">não ligado</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={vincular} className="flex items-center gap-2">
                          <input type="hidden" name="bitrix_id" value={String(v.bitrix_id)} />
                          <select name="user_id" required defaultValue="" className={inp}>
                            <option value="" disabled>Escolha o usuário</option>
                            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.rotulo}</option>)}
                          </select>
                          <button className="rounded-lg bg-accent px-2.5 py-1 text-white">Ligar</button>
                        </form>
                        {ligado && (
                          <form action={desvincular}>
                            <input type="hidden" name="user_id" value={String(v.user_id)} />
                            <button className="text-xs text-muted hover:text-bad">Desligar</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mb-1 text-lg font-semibold">Origens do Brinde do Bem</h2>
      <p className="mb-2 text-sm text-muted">Só os leads destas origens contam como leads do Brinde do Bem.</p>
      {origens.length === 0 ? (
        <p className="text-sm text-muted">Ainda não há origens. Rode a sincronização primeiro.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="px-3 py-2 text-left font-medium">Origem</th>
                <th className="px-3 py-2 text-left font-medium">Ativa</th>
              </tr>
            </thead>
            <tbody>
              {origens.map((o) => {
                const on = !!o.ativo;
                return (
                  <tr key={o.source_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{o.nome ?? o.source_id}</td>
                    <td className="px-3 py-2">
                      <form action={alternarOrigem} className="flex items-center gap-2">
                        <input type="hidden" name="source_id" value={o.source_id} />
                        <input type="hidden" name="ativo" value={on ? 'false' : 'true'} />
                        <span>{on ? 'Sim' : 'Não'}</span>
                        <button className="text-xs text-accent hover:underline">{on ? 'Desativar' : 'Ativar'}</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
