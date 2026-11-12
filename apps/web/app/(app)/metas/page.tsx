import Link from 'next/link';
import { ErroDados } from '@/components/cartao-indicador';
import { GraficoMetas } from '@/components/grafico-metas';
import { TabelaProjecao } from '@/components/tabela-projecao';
import * as dash from '@/lib/dash';
import { hojeBrasilia } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';
import type { CanalMeta } from '@/lib/metas-planilha';

type SP = Promise<Record<string, string | string[] | undefined>>;

const CANAIS: { chave: CanalMeta | 'consolidado'; rotulo: string }[] = [
  { chave: 'mercadolivre', rotulo: 'Mercado Livre' },
  { chave: 'shopee', rotulo: 'Shopee' },
  { chave: 'brindedobem', rotulo: 'Brinde do Bem' },
  { chave: 'consolidado', rotulo: 'Total' },
];
const SEM_REALIZADO: Record<string, string> = {
  shopee: 'A Shopee ainda não está conectada: aparece só a meta. O realizado e a projeção entram quando a conta for ligada.',
  brindedobem: 'As vendas do Brinde do Bem (ERP) ainda não chegam ao painel: aparece só a meta.',
};

export default async function MetasPage({ searchParams }: { searchParams: SP }) {
  const perms = await exigirPermissao('metas');
  const sp = await searchParams;
  const hoje = hojeBrasilia();
  const c = typeof sp.canal === 'string' ? sp.canal : 'mercadolivre';
  const canal = (CANAIS.some((x) => x.chave === c) ? c : 'mercadolivre') as CanalMeta | 'consolidado';

  const supabase = await createClient();
  const { data: anosMetas } = await supabase.schema('core').from('metas').select('ano');
  const anos = [...new Set((anosMetas ?? []).map((r) => r.ano as number))].sort();
  const anoPadrao = anos.at(-1) ?? Number(hoje.slice(0, 4));
  const anoParam = Number(typeof sp.ano === 'string' ? sp.ano : NaN);
  const ano = Number.isInteger(anoParam) && anoParam >= 2020 && anoParam <= 2100 ? anoParam : anoPadrao;

  let linhas;
  try {
    linhas = await dash.metas(canal, ano);
  } catch (e) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-2xl font-semibold">Metas e Projeção</h1><ErroDados mensagem={(e as Error).message} /></div>;
  }

  const padroes: Record<number, number | null> = {};
  if (canal !== 'consolidado') {
    const { data } = await supabase.schema('core').from('premissas_projecao')
      .select('ano, crescimento_pct').eq('channel', canal).is('mes', null);
    for (const r of data ?? []) padroes[r.ano as number] = Number(r.crescimento_pct);
  }
  const link = (mud: Record<string, string>) => `/metas?${new URLSearchParams({ canal, ano: String(ano), ...mud }).toString()}`;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-2xl font-semibold">Metas e Projeção</h1>
      <p className="mb-4 text-sm text-muted">Realizado (receita dos pedidos pagos), projeção mês a mês até dezembro de {ano} e meta do orçamento.</p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-lg border border-border text-sm">
          {CANAIS.map((x) => (
            <Link key={x.chave} href={link({ canal: x.chave })}
              className={`px-3 py-1.5 ${canal === x.chave ? 'bg-accent text-white' : 'hover:bg-accent-soft'}`}>{x.rotulo}</Link>
          ))}
        </div>
        {anos.length > 1 && (
          <div className="flex overflow-hidden rounded-lg border border-border text-sm">
            {anos.map((a) => (
              <Link key={a} href={link({ ano: String(a) })}
                className={`px-3 py-1.5 ${ano === a ? 'bg-accent text-white' : 'hover:bg-accent-soft'}`}>{a}</Link>
            ))}
          </div>
        )}
        {perms.has('editar_metas') && (
          <Link href="/configuracoes/metas" className="text-sm text-accent hover:underline">Subir planilha de metas</Link>
        )}
      </div>

      {SEM_REALIZADO[canal] && <p className="mb-4 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-muted">{SEM_REALIZADO[canal]}</p>}
      {!anos.length && <p className="mb-4 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-muted">Nenhuma meta cadastrada ainda.</p>}

      <section className="rounded-xl border border-border bg-surface p-4">
        <GraficoMetas linhas={linhas} />
      </section>
      <section className="mt-6">
        <TabelaProjecao linhas={linhas} ano={ano} canal={canal} podeEditar={perms.has('editar_metas')} padroes={padroes} />
      </section>
    </div>
  );
}
