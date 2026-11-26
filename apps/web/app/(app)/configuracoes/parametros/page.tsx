import { requireUser } from '@/lib/auth';
import { brl, dataBr } from '@/lib/formato';
import { exigirPermissao } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';
import { CAMPOS_LIMITES, situacaoVigencias } from '@/lib/ads-limites';
import { CAMPOS_CRESCIMENTO, PARAMETROS_CRESCIMENTO_PADRAO } from '@/lib/crescimento';
import { hojeBrasilia } from '@/lib/periodo';
import {
  adicionarFeriado, excluirFeriado, excluirLimiteReputacao, excluirLimitesAds, excluirParametro, excluirParametrosCrescimento,
  salvarLimiteReputacao, salvarLimitesAds, salvarParametro, salvarParametrosAlertas, salvarParametrosCrescimento,
} from './actions';

type SP = Promise<Record<string, string | string[] | undefined>>;
const CANAL: Record<string, string> = { mercadolivre: 'Mercado Livre', shopee: 'Shopee' };

export default async function ParametrosPage({ searchParams }: { searchParams: SP }) {
  const perms = await exigirPermissao('configuracoes');
  // Os percentuais de crescimento só são lidos com a permissão 'vendas' (RLS da 0022).
  const verCrescimento = perms.has('vendas');
  const { profile } = await requireUser();
  const ehAdmin = profile?.role === 'admin';
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.schema('core').from('parametros_custo')
    .select('id, channel, imposto_pct, embalagem_pedido, embalagem_peca, vigente_desde')
    .order('channel').order('vigente_desde', { ascending: false });
  const linhas = data ?? [];
  const { data: ads } = await supabase.schema('core').from('parametros_ads').select('*')
    .order('channel').order('vigente_desde', { ascending: false });
  const limites = (ads ?? []) as Array<Record<string, string | number>>;
  const { data: cresc } = await supabase.schema('core').from('parametros_crescimento')
    .select('channel, vigente_desde, pct_crescimento, pct_queda')
    .order('channel').order('vigente_desde', { ascending: false });
  const crescimento = (cresc ?? []) as Array<Record<string, string | number>>;
  const hoje = hojeBrasilia();
  const situacao = (lista: Array<Record<string, unknown>>, d: unknown) =>
    situacaoVigencias(lista.map((x) => String(x.vigente_desde)), hoje)[lista.findIndex((x) => x.vigente_desde === d)];
  const rotuloSit = (v?: string) => (v === 'em vigor' ? ' (em vigor)' : v === 'futura' ? ' (futura)' : '');
  const [{ data: pa }, { data: fer }, { data: lim }] = await Promise.all([
    supabase.schema('core').from('parametros_alertas').select('antecedencia_padrao, perto_limite_pct').maybeSingle(),
    supabase.schema('core').from('feriados').select('data, nome').order('data'),
    supabase.schema('core').from('reputacao_limites').select('level_id, indicador, limite_pct').order('level_id').order('indicador'),
  ]);
  const feriados = fer ?? [];
  const limitesRep = lim ?? [];
  const INDIC: Record<string, string> = { reclamacoes: 'Reclamações', cancelamentos: 'Cancelamentos', atrasos: 'Atrasos' };
  const campo = 'rounded border border-border bg-surface px-2 py-1';
  const linhasCanal = (c: string) => linhas.filter((x) => x.channel === c);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-semibold">Parâmetros de custo</h1>
      <p className="mb-4 text-sm text-muted">
        Imposto (% sobre a receita) e embalagem entram na margem de contribuição dos pedidos pagos. Cada venda usa a vigência mais
        recente com data igual ou anterior à data da venda; mudar o valor a partir de uma data não altera os meses anteriores.
        {!ehAdmin && ' Só o administrador pode alterar.'}
      </p>
      {typeof sp.ok === 'string' && <p className="mb-3 text-sm text-good">{sp.ok}</p>}
      {typeof sp.erro === 'string' && <p className="mb-3 text-sm text-bad">{sp.erro}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="px-3 py-2 text-left font-medium">Canal</th>
              <th className="px-3 py-2 text-left font-medium">Vale a partir de</th>
              <th className="px-3 py-2 text-right font-medium">Imposto %</th>
              <th className="px-3 py-2 text-right font-medium">Embalagem por pedido</th>
              <th className="px-3 py-2 text-right font-medium">Embalagem por peça</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">{CANAL[l.channel] ?? l.channel}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{dataBr(l.vigente_desde)}{rotuloSit(situacao(linhasCanal(l.channel), l.vigente_desde))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.imposto_pct).toLocaleString('pt-BR')}%</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{brl(Number(l.embalagem_pedido))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{brl(Number(l.embalagem_peca))}</td>
                <td className="px-3 py-1.5 text-right">
                  {ehAdmin && (
                    <form action={excluirParametro}>
                      <input type="hidden" name="id" value={l.id} />
                      <button className="text-xs text-muted hover:text-bad">Excluir</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ehAdmin && (
        <form action={salvarParametro} className="mt-6 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">+ Nova vigência</h2>
          <label className="flex flex-col gap-1">Canal
            <select name="channel" defaultValue="mercadolivre" className="rounded border border-border bg-surface px-2 py-1">
              <option value="mercadolivre">Mercado Livre</option>
              <option value="shopee">Shopee</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">Vale a partir de
            <input type="date" name="vigente_desde" required className="rounded border border-border bg-surface px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">Imposto (%)
            <input name="imposto_pct" inputMode="decimal" placeholder="0" className="rounded border border-border bg-surface px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">Embalagem por pedido (R$)
            <input name="embalagem_pedido" inputMode="decimal" placeholder="0,00" className="rounded border border-border bg-surface px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">Embalagem por peça (R$)
            <input name="embalagem_peca" inputMode="decimal" placeholder="0,00" className="rounded border border-border bg-surface px-2 py-1" />
          </label>
          <div className="flex items-end">
            <button className="rounded-lg bg-accent px-3 py-1.5 text-white">Salvar vigência</button>
          </div>
          <p className="text-xs text-muted sm:col-span-3">Salvar uma data que já existe para o canal substitui os valores daquela vigência.</p>
        </form>
      )}

      <h2 className="mb-1 mt-10 text-xl font-semibold">Limites de Ads</h2>
      <p className="mb-4 text-sm text-muted">
        Regras usadas nas sugestões de Ads (pausar, revisar, escalar, testar). Cada período usa a vigência mais recente com data igual
        ou anterior ao dia analisado.{!ehAdmin && ' Só o administrador pode alterar.'}
      </p>
      {['mercadolivre', 'shopee'].map((canal) => {
        const hist = limites.filter((l) => l.channel === canal);
        return (
          <div key={canal} className="mb-4 overflow-x-auto rounded-xl border border-border bg-surface">
            <h3 className="px-3 pt-3 text-sm font-semibold">{CANAL[canal]}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="px-3 py-2 text-left font-medium">Vale a partir de</th>
                  {CAMPOS_LIMITES.map((c) => <th key={c.chave} className="px-3 py-2 text-right font-medium">{c.rotulo}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {hist.map((l) => (
                  <tr key={String(l.vigente_desde)} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-1.5">{dataBr(String(l.vigente_desde))}{rotuloSit(situacao(hist, l.vigente_desde))}</td>
                    {CAMPOS_LIMITES.map((c) => (
                      <td key={c.chave} className="px-3 py-1.5 text-right tabular-nums">{Number(l[c.chave]).toLocaleString('pt-BR')}</td>
                    ))}
                    <td className="px-3 py-1.5 text-right">
                      {ehAdmin && (
                        <form action={excluirLimitesAds}>
                          <input type="hidden" name="channel" value={canal} />
                          <input type="hidden" name="vigente_desde" value={String(l.vigente_desde)} />
                          <button className="text-xs text-muted hover:text-bad">Excluir</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {ehAdmin && ['mercadolivre', 'shopee'].map((canal) => {
        const base = limites.find((l) => l.channel === canal && String(l.vigente_desde) <= hoje);
        return (
          <form key={canal} action={salvarLimitesAds} className="mt-6 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-3">
            <h2 className="font-semibold sm:col-span-3">+ Nova vigência de limites de Ads — {CANAL[canal]}</h2>
            <input type="hidden" name="channel" value={canal} />
            <label className="flex flex-col gap-1">Vale a partir de
              <input type="date" name="vigente_desde" required className="rounded border border-border bg-surface px-2 py-1" />
            </label>
            <span className="sm:col-span-2" />
            {CAMPOS_LIMITES.map((c) => (
              <label key={c.chave} className="flex flex-col gap-1">{c.rotulo}
                <input name={c.chave} inputMode="decimal" required
                  defaultValue={String(base?.[c.chave] ?? c.padrao).replace('.', ',')}
                  className="rounded border border-border bg-surface px-2 py-1" />
              </label>
            ))}
            <div className="flex items-end">
              <button className="rounded-lg bg-accent px-3 py-1.5 text-white">Salvar limites</button>
            </div>
            <p className="text-xs text-muted sm:col-span-3">Os campos já vêm com os valores em vigor deste canal. Salvar uma data que já existe para o canal substitui os valores daquela vigência.</p>
          </form>
        );
      })}

      <h2 className="mb-1 mt-10 text-xl font-semibold">Crescimento por canal</h2>
      <p className="mb-4 text-sm text-muted">
        Percentuais da sugestão por canal: investir mais quando as vendas crescem pelo menos o percentual nos comparativos (período
        anterior e mesmo período do ano passado) com a margem depois do Ads positiva e sem cair; reduzir quando caem pelo menos o
        percentual em algum comparativo ou a margem fica negativa. Cada período usa a vigência mais recente com data igual ou anterior
        ao último dia analisado.{!ehAdmin && ' Só o administrador pode alterar.'}
      </p>
      {!verCrescimento && !ehAdmin && (
        <p className="mb-4 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-muted">
          Os percentuais de crescimento aparecem só para perfis com a permissão Vendas. Peça ao administrador para liberar,
          se precisar ver ou conferir estes números.
        </p>
      )}
      {verCrescimento && ['mercadolivre', 'shopee'].map((canal) => {
        const hist = crescimento.filter((l) => l.channel === canal);
        return (
          <div key={canal} className="mb-4 overflow-x-auto rounded-xl border border-border bg-surface">
            <h3 className="px-3 pt-3 text-sm font-semibold">{CANAL[canal]}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="px-3 py-2 text-left font-medium">Vale a partir de</th>
                  {CAMPOS_CRESCIMENTO.map((c) => <th key={c.chave} className="px-3 py-2 text-right font-medium">{c.rotulo}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {hist.map((l) => (
                  <tr key={String(l.vigente_desde)} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-3 py-1.5">{dataBr(String(l.vigente_desde))}{rotuloSit(situacao(hist, l.vigente_desde))}</td>
                    {CAMPOS_CRESCIMENTO.map((c) => (
                      <td key={c.chave} className="px-3 py-1.5 text-right tabular-nums">{Number(l[c.chave]).toLocaleString('pt-BR')}%</td>
                    ))}
                    <td className="px-3 py-1.5 text-right">
                      {ehAdmin && (
                        <form action={excluirParametrosCrescimento}>
                          <input type="hidden" name="channel" value={canal} />
                          <input type="hidden" name="vigente_desde" value={String(l.vigente_desde)} />
                          <button className="text-xs text-muted hover:text-bad">Excluir</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {ehAdmin && ['mercadolivre', 'shopee'].map((canal) => {
        const base = crescimento.find((l) => l.channel === canal && String(l.vigente_desde) <= hoje);
        return (
          <form key={canal} action={salvarParametrosCrescimento} className="mt-6 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-3">
            <h2 className="font-semibold sm:col-span-3">+ Nova vigência de crescimento — {CANAL[canal]}</h2>
            <input type="hidden" name="channel" value={canal} />
            <label className="flex flex-col gap-1">Vale a partir de
              <input type="date" name="vigente_desde" required className="rounded border border-border bg-surface px-2 py-1" />
            </label>
            {CAMPOS_CRESCIMENTO.map((c) => (
              <label key={c.chave} className="flex flex-col gap-1">{c.rotulo}
                <input name={c.chave} inputMode="decimal" required
                  defaultValue={String(base?.[c.chave] ?? PARAMETROS_CRESCIMENTO_PADRAO[c.chave]).replace('.', ',')}
                  className="rounded border border-border bg-surface px-2 py-1" />
              </label>
            ))}
            <div className="flex items-end">
              <button className="rounded-lg bg-accent px-3 py-1.5 text-white">Salvar percentuais</button>
            </div>
            <p className="text-xs text-muted sm:col-span-3">Os campos já vêm com os valores em vigor deste canal. O limite exato conta (10% conta; 9,99% não). Salvar uma data que já existe para o canal substitui os valores daquela vigência.</p>
          </form>
        );
      })}

      <h2 className="mb-1 mt-10 text-xl font-semibold">Alertas e reputação</h2>
      <p className="mb-4 text-sm text-muted">
        Antecedência padrão dos avisos de atraso (para anúncios sem grupo), sensibilidade do aviso de reputação, feriados usados na
        contagem de dias úteis e limites de reputação.{!ehAdmin && ' Só o administrador pode alterar.'}
      </p>
      {ehAdmin ? (
        <form action={salvarParametrosAlertas} className="grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-3">
          <label className="flex flex-col gap-1">Antecedência padrão (dias úteis, 0 a 30)
            <input name="antecedencia_padrao" type="number" min={0} max={30} step={1} required
              defaultValue={Number(pa?.antecedencia_padrao ?? 4)} className={campo} />
          </label>
          <label className="flex flex-col gap-1">Perto do limite (%, 1 a 100)
            <input name="perto_limite_pct" inputMode="decimal" required
              defaultValue={String(pa?.perto_limite_pct ?? 80).replace('.', ',')} className={campo} />
          </label>
          <div className="flex items-end">
            <button className="rounded-lg bg-accent px-3 py-1.5 text-white">Salvar</button>
          </div>
          <p className="text-xs text-muted sm:col-span-3">
            &quot;Perto do limite&quot; avisa quando um indicador de reputação chega a esse percentual do limite cadastrado.
          </p>
        </form>
      ) : (
        <p className="text-sm">Antecedência padrão: {Number(pa?.antecedencia_padrao ?? 4)} dias úteis. Perto do limite: {Number(pa?.perto_limite_pct ?? 80).toLocaleString('pt-BR')}%.</p>
      )}

      <h3 className="mb-2 mt-6 text-sm font-semibold">Feriados</h3>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <tbody>
            {feriados.length === 0 && <tr><td className="px-3 py-3 text-muted">Nenhum feriado cadastrado.</td></tr>}
            {feriados.map((f) => (
              <tr key={f.data} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-3 py-1.5">{dataBr(f.data)}</td>
                <td className="px-3 py-1.5">{f.nome}</td>
                <td className="px-3 py-1.5 text-right">
                  {ehAdmin && (
                    <form action={excluirFeriado}>
                      <input type="hidden" name="data" value={f.data} />
                      <button className="text-xs text-muted hover:text-bad">Excluir</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ehAdmin && (
        <form action={adicionarFeriado} className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
          <label className="flex flex-col gap-1">Data
            <input type="date" name="data" required className={campo} />
          </label>
          <label className="flex flex-col gap-1">Nome
            <input name="nome" required maxLength={80} placeholder="Ex.: feriado municipal" className={`${campo} w-64`} />
          </label>
          <button className="rounded-lg bg-accent px-3 py-1.5 text-white">Adicionar feriado</button>
        </form>
      )}

      <h3 className="mb-2 mt-6 text-sm font-semibold">Limites de reputação (%)</h3>
      <p className="mb-2 text-xs text-muted">
        Esta tabela começa vazia de propósito. Confirme os valores na página oficial do Mercado Livre sobre reputação de vendedores
        antes de cadastrar qualquer limite; sem limite cadastrado, o painel mostra &quot;limite não cadastrado&quot;.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="px-3 py-2 text-left font-medium">Nível (cor)</th>
              <th className="px-3 py-2 text-left font-medium">Indicador</th>
              <th className="px-3 py-2 text-right font-medium">Limite</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {limitesRep.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-muted">Nenhum limite cadastrado.</td></tr>}
            {limitesRep.map((l) => (
              <tr key={`${l.level_id}|${l.indicador}`} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">{l.level_id}</td>
                <td className="px-3 py-1.5">{INDIC[l.indicador] ?? l.indicador}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.limite_pct).toLocaleString('pt-BR')}%</td>
                <td className="px-3 py-1.5 text-right">
                  {ehAdmin && (
                    <form action={excluirLimiteReputacao}>
                      <input type="hidden" name="level_id" value={l.level_id} />
                      <input type="hidden" name="indicador" value={l.indicador} />
                      <button className="text-xs text-muted hover:text-bad">Excluir</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ehAdmin && (
        <form action={salvarLimiteReputacao} className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
          <label className="flex flex-col gap-1">Nível (código do Mercado Livre)
            <input name="level_id" required maxLength={40} className={`${campo} w-48`} />
          </label>
          <label className="flex flex-col gap-1">Indicador
            <select name="indicador" defaultValue="reclamacoes" className={campo}>
              <option value="reclamacoes">Reclamações</option>
              <option value="cancelamentos">Cancelamentos</option>
              <option value="atrasos">Atrasos</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">Limite (%)
            <input name="limite_pct" inputMode="decimal" required className={`${campo} w-24`} />
          </label>
          <button className="rounded-lg bg-accent px-3 py-1.5 text-white">Salvar limite</button>
          <p className="w-full text-xs text-muted">Salvar um nível e indicador que já existem substitui o limite.</p>
        </form>
      )}
    </div>
  );
}
