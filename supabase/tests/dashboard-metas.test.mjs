import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Metas e projecao mensal (migration 0010).
const repo = fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
let fails = 0;
const eq = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(exp)})`}`);
};
const mig = (f) => readFileSync(`${repo}/supabase/migrations/${f}`, 'utf8');
await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0006_custo_por_cotacao.sql', '0007_de_para_modelo.sql',
  '0008_dashboard_admin.sql', '0009_dashboard_funcoes.sql', '0010_dashboard_metas.sql', '0010_dashboard_metas.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002..0010 aplicadas (0010 x2)');
await db.exec(`create or replace function core.my_role() returns core.app_role language sql as $$ select coalesce(nullif(current_setting('teste.perfil', true), ''), 'admin')::core.app_role $$`);

await db.exec(`
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw) values
 ('mercadolivre','O1','paid','2026-10-15 13:00+00','2026-10-15 13:00+00', 1000, '{}'),
 ('mercadolivre','N1','paid','2026-11-05 13:00+00','2026-11-05 13:00+00', 300, '{}'),
 ('mercadolivre','N2','cancelled','2026-11-06 13:00+00','2026-11-06 13:00+00', 500, '{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','O1',1,'X','AAA1-AZU','x',1,1000,0), ('mercadolivre','N1',1,'X','AAA1-AZU','x',1,300,0),
 ('mercadolivre','N2',1,'X','AAA1-AZU','x',1,500,0);
insert into core.metas (channel, ano, mes, valor) values ('mercadolivre', 2027, 1, 26711), ('shopee', 2027, 1, 29000);
insert into core.premissas_projecao (channel, ano, mes, crescimento_pct) values
 ('mercadolivre', 2027, null, 10), ('mercadolivre', 2026, null, 0), ('mercadolivre', 2027, 1, 5);
`);

const metas = async (canal) => (await db.query(`select mes::text, situacao, realizado::float, crescimento_pct::float, crescimento_editado,
  projecao::float, meta::float from analytics.dash_metas($1, 2027, '2026-11-12')`, [canal])).rows;
const ml = await metas('mercadolivre');
const mes = (m) => ml.find((x) => x.mes === m);
eq('26 meses (nov/2025 a dez/2027)', [ml.length, ml[0].mes, ml.at(-1).mes], [26, '2025-11-01', '2027-12-01']);
eq('out/2026 realizado', mes('2026-10-01'),
  { mes: '2026-10-01', situacao: 'realizado', realizado: 1000, crescimento_pct: null, crescimento_editado: null, projecao: null, meta: null });
eq('nov/2026 em andamento (parcial so referencia; cancelado nao conta)', mes('2026-11-01'),
  { mes: '2026-11-01', situacao: 'em_andamento', realizado: 300, crescimento_pct: 0, crescimento_editado: false, projecao: 1000, meta: null });
eq('dez/2026', [mes('2026-12-01').situacao, mes('2026-12-01').realizado, mes('2026-12-01').projecao], ['projetado', null, 1000]);
eq('jan/2027 com crescimento editado', mes('2027-01-01'),
  { mes: '2027-01-01', situacao: 'projetado', realizado: null, crescimento_pct: 5, crescimento_editado: true, projecao: 1050, meta: 26711 });
eq('fev/2027 com o padrao do ano', [mes('2027-02-01').crescimento_pct, mes('2027-02-01').crescimento_editado, mes('2027-02-01').projecao], [10, false, 1155]);
eq('mes sem venda realizado = 0', mes('2025-11-01').realizado, 0);

const tot = await metas('consolidado');
eq('total: meta soma os canais', tot.find((x) => x.mes === '2027-01-01').meta, 55711);
eq('total: projecao soma os canais', tot.find((x) => x.mes === '2027-01-01').projecao, 1050);
eq('shopee: so meta', (await metas('shopee')).find((x) => x.mes === '2027-01-01').meta, 29000);

await db.exec(`set teste.perfil = 'visualizador'`);
eq('sem permissao de metas: nada', (await metas('mercadolivre')).length, 0);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
