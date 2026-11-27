import { exigirPermissao } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';
import { atribuirAnuncios, criarGrupo, editarGrupo, excluirGrupo } from './actions';

type SP = Promise<Record<string, string | string[] | undefined>>;
const LIMITE_LINHAS = 200;
const campo = 'rounded border border-border bg-surface px-2 py-1';

export default async function GruposAnunciosPage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('editar_grupos');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const filtrou = typeof sp.f === 'string';
  const semGrupo = filtrou ? sp.sem === '1' : true;

  const supabase = await createClient();
  const [{ data: gruposRaw }, { data: vinculosRaw }, { data: param }] = await Promise.all([
    supabase.schema('core').from('grupos_anuncio').select('id, nome, antecedencia_dias').order('nome'),
    supabase.schema('core').from('grupo_anuncio_itens').select('item_id, grupo_id').eq('channel', 'mercadolivre').range(0, 49999),
    supabase.schema('core').from('parametros_alertas').select('antecedencia_padrao').maybeSingle(),
  ]);
  const grupos = gruposRaw ?? [];
  const padrao = Number(param?.antecedencia_padrao ?? 4);
  const grupoDoItem = new Map<string, number>((vinculosRaw ?? []).map((v) => [String(v.item_id), Number(v.grupo_id)]));
  const qtd = new Map<number, number>();
  for (const g of grupoDoItem.values()) qtd.set(g, (qtd.get(g) ?? 0) + 1);
  const nomeGrupo = new Map(grupos.map((g) => [Number(g.id), String(g.nome)]));

  let consulta = supabase.schema('mkt').from('items').select('item_id, title')
    .eq('channel', 'mercadolivre').eq('status', 'active').order('title').range(0, 9999);
  if (q) consulta = consulta.ilike('title', `%${q.replace(/[%_,()]/g, ' ')}%`);
  const { data: itensRaw } = await consulta;
  const filtrados = (itensRaw ?? []).filter((i) => !semGrupo || !grupoDoItem.has(String(i.item_id)));
  const itens = filtrados.slice(0, LIMITE_LINHAS);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Grupos de anúncios</h1>
      <p className="mb-4 text-sm text-muted">
        Cada grupo tem a sua antecedência (dias úteis antes do prazo de despacho para avisar o atraso). Um anúncio fica em no máximo
        um grupo; quem está sem grupo usa o padrão de {padrao} dias úteis (definido em Parâmetros).
      </p>
      {typeof sp.ok === 'string' && <p className="mb-3 text-sm text-good">{sp.ok}</p>}
      {typeof sp.erro === 'string' && <p className="mb-3 text-sm text-bad">{sp.erro}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="px-3 py-2 text-left font-medium">Grupo e antecedência (dias úteis)</th>
              <th className="px-3 py-2 text-right font-medium">Anúncios</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grupos.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-3 text-muted">Nenhum grupo ainda. Crie o primeiro abaixo.</td></tr>
            )}
            {grupos.map((g) => (
              <tr key={g.id} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">
                  <form action={editarGrupo} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={g.id} />
                    <input name="nome" defaultValue={g.nome} required maxLength={60} className={`${campo} w-56`} />
                    <input name="antecedencia" type="number" min={0} max={30} step={1} defaultValue={g.antecedencia_dias} required className={`${campo} w-20`} />
                    <button className="rounded-lg bg-accent-strong px-3 py-1 text-xs text-on-accent-strong">Salvar</button>
                  </form>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{qtd.get(Number(g.id)) ?? 0}</td>
                <td className="px-3 py-1.5 text-right">
                  <form action={excluirGrupo}>
                    <input type="hidden" name="id" value={g.id} />
                    <button className="text-xs text-muted hover:text-bad">Excluir</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={criarGrupo} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
        <h2 className="w-full font-semibold">+ Novo grupo</h2>
        <label className="flex flex-col gap-1">Nome
          <input name="nome" required maxLength={60} className={`${campo} w-56`} />
        </label>
        <label className="flex flex-col gap-1">Antecedência (dias úteis)
          <input name="antecedencia" type="number" min={0} max={30} step={1} defaultValue={padrao} required className={`${campo} w-24`} />
        </label>
        <button className="rounded-lg bg-accent-strong px-3 py-1.5 text-on-accent-strong">Criar grupo</button>
      </form>

      <h2 className="mb-2 mt-10 text-xl font-semibold">Anúncios ativos do Mercado Livre</h2>
      <form method="get" className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <input type="hidden" name="f" value="1" />
        <input name="q" defaultValue={q} placeholder="Buscar por título" className={`${campo} w-64`} />
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="sem" value="1" defaultChecked={semGrupo} /> Sem grupo
        </label>
        <button className="rounded-lg border border-border px-3 py-1">Filtrar</button>
      </form>
      {semGrupo && <p className="mb-2 text-xs text-muted">Sem grupo: usando o padrão de {padrao} dias úteis.</p>}

      <form action={atribuirAnuncios}>
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
          <label htmlFor="grupo_id">Mover selecionados para:</label>
          <select id="grupo_id" name="grupo_id" defaultValue="" className={campo}>
            <option value="">Sem grupo (usar o padrão)</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome} ({g.antecedencia_dias} dias)</option>)}
          </select>
          <button className="rounded-lg bg-accent-strong px-3 py-1 text-on-accent-strong">Aplicar</button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 text-left font-medium">Anúncio</th>
                <th className="px-3 py-2 text-left font-medium">Grupo atual</th>
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 && (
                <tr><td colSpan={3} className="px-3 py-3 text-muted">Nenhum anúncio encontrado com esse filtro.</td></tr>
              )}
              {itens.map((i) => {
                const g = grupoDoItem.get(String(i.item_id));
                return (
                  <tr key={i.item_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5"><input type="checkbox" name="item_id" value={i.item_id} aria-label={`Selecionar ${i.title ?? i.item_id}`} /></td>
                    <td className="px-3 py-1.5">{i.title ?? i.item_id}</td>
                    <td className="px-3 py-1.5 text-muted">{g !== undefined ? nomeGrupo.get(g) ?? '—' : `Sem grupo (padrão ${padrao} dias)`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtrados.length > LIMITE_LINHAS && (
          <p className="mt-2 text-xs text-muted">Mostrando {LIMITE_LINHAS} de {filtrados.length}. Use a busca para refinar.</p>
        )}
      </form>
    </div>
  );
}
