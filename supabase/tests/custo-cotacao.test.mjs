import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Regra de custo pela cotacao de compra (migration 0006), com cotacoes reais do BLA68.
const repo = fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
let fails = 0;
const eq = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(exp)})`}`);
};

await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
await db.exec(readFileSync(`${repo}/supabase/migrations/0002_marketplaces.sql`, 'utf8'));
await db.exec(readFileSync(`${repo}/supabase/migrations/0003_regras_v1.sql`, 'utf8'));
await db.exec(readFileSync(`${repo}/supabase/migrations/0006_custo_por_cotacao.sql`, 'utf8'));
await db.exec(readFileSync(`${repo}/supabase/migrations/0006_custo_por_cotacao.sql`, 'utf8')); // reexecutavel
await db.exec(readFileSync(`${repo}/supabase/migrations/0007_de_para_modelo.sql`, 'utf8'));
await db.exec(readFileSync(`${repo}/supabase/migrations/0007_de_para_modelo.sql`, 'utf8')); // reexecutavel
console.log('Migrations 0002 + 0003 + 0006 + 0007 aplicadas');

// Datas no horario de Brasilia (-03), como vem do ERP.
await db.exec(`
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, source) values
 -- BLA68: trecho real da tabela Cotacoes (fornecedor padrao)
 ('BLA68',    1,   254, 4.90, '2026-02-12 23:59:59-03', 'erp'),
 ('BLA68',  255,  1049, 4.80, '2026-02-12 23:59:59-03', 'erp'),
 ('BLA68', 1050,  2549, 4.66, '2026-02-12 23:59:59-03', 'erp'),
 ('BLA68', 2550, 99999, 4.60, '2026-02-12 23:59:59-03', 'erp'),
 ('BLA68',   10,    10, 4.94, '2025-07-01 14:37:01-03', 'erp'),
 ('BLA68',   30,    30, 4.94, '2025-06-04 17:27:48-03', 'erp'),
 ('BLA68',   10,    10, 4.18, '2026-08-17 11:36:52-03', 'erp'),
 ('BLA68',    1,    10, 4.18, '2026-08-19 00:00:00-03', 'erp'),
 ('BLA68',   11,  2549, 4.14, '2026-08-19 00:00:00-03', 'erp'),
 ('BLA68', 2550, 20000, 4.04, '2026-08-19 00:00:00-03', 'erp'),
 ('BLA68',   10,    10, 4.18, '2026-08-21 15:21:28-03', 'erp'),
 ('BLA68',   15,    15, 4.14, '2026-08-24 11:23:00-03', 'erp'),
 ('BLA68',   20,    20, 4.14, '2026-10-09 09:43:22-03', 'erp'),
 ('BLA68',   50,    50, 4.14, '2026-10-09 09:46:02-03', 'erp'),
 -- PT1: so cotacoes pontuais
 ('PT1',  50,  50, 5.00, '2026-01-10 10:00-03', 'erp'),
 ('PT1', 100, 100, 4.50, '2026-02-01 10:00-03', 'erp'),
 ('PT1',  50,  50, 6.00, '2026-04-01 10:00-03', 'erp'),
 ('PT1', 200, 200, 5.00, '2026-04-01 11:00-03', 'erp'),
 -- TZ1: cotacao as 22h de Brasilia (01h UTC do dia seguinte)
 ('TZ1', 1, 100, 3.00, '2026-05-01 22:00-03', 'erp'),
 -- TIE1: duas faixas iguais no mesmo horario
 ('TIE1', 1, 100, 1.20, '2026-03-01 10:00-03', 'erp'),
 ('TIE1', 1, 100, 1.50, '2026-03-01 10:00-03', 'erp'),
 -- NUL1: qty_end vazio = sem limite
 ('NUL1', 5, null, 2.00, '2026-03-01 10:00-03', 'erp'),
 -- EXP1: expired_at preenchido nao corta a cotacao
 ('EXP1', 1, 100, 7.00, '2026-01-01 10:00-03', 'erp'),
 -- BMS148: destino do de-para SQM148 -> BMS148 (ate 12/11/2026)
 ('BMS148', 1, 1000, 2.04, '2026-01-01 10:00-03', 'erp');
update erp.cost_tiers set expired_at = '2026-02-01' where product_id = 'EXP1';
`);

const cost = async (m, d, u) =>
  (await db.query(`select price::float as price, flag from analytics.resolve_unit_cost($1, $2::timestamptz, $3)`, [m, d, u])).rows[0];

eq('BLA68 12 pecas em 15/10/2026 -> tabela 19/08 (11-2549)', await cost('BLA68', '2026-10-15 10:00-03', 12), { price: 4.14, flag: null });
eq('BLA68 10 pecas em 15/10/2026 -> pontual 21/08', await cost('BLA68', '2026-10-15 10:00-03', 10), { price: 4.18, flag: null });
eq('BLA68 20 pecas em 09/10/2026 08h -> pontual do mesmo dia (09h43)', await cost('BLA68', '2026-10-09 08:00-03', 20), { price: 4.14, flag: null });
eq('BLA68 30 pecas em 01/03/2026 -> tabela 12/02 (1-254)', await cost('BLA68', '2026-03-01 10:00-03', 30), { price: 4.9, flag: null });
eq('BLA68 10 pecas em 01/08/2025 -> pontual 01/07/2025', await cost('BLA68', '2025-08-01 10:00-03', 10), { price: 4.94, flag: null });
eq('BLA68 3000 pecas em 01/09/2026 -> tabela 19/08 (2550-20000)', await cost('BLA68', '2026-09-01 10:00-03', 3000), { price: 4.04, flag: null });

eq('nenhuma faixa contem N -> cotacao mais recente', await cost('PT1', '2026-03-01 10:00-03', 20), { price: 4.5, flag: null });
eq('mesmo dia, faixa mais proxima (120 -> 50, nao 200)', await cost('PT1', '2026-04-05 10:00-03', 120), { price: 6, flag: null });
eq('antes da primeira cotacao -> primeira depois (faixa_atual)', await cost('PT1', '2025-12-01 10:00-03', 50), { price: 5, flag: 'faixa_atual' });
eq('modelo sem cotacao -> sem_custo', await cost('XXX', '2026-03-01 10:00-03', 5), { price: 0, flag: 'sem_custo' });
eq('modelo nulo -> sem_custo', await cost(null, '2026-03-01 10:00-03', 5), { price: 0, flag: 'sem_custo' });
eq('data em Brasilia: cotacao 22h vale para venda 15h do mesmo dia', await cost('TZ1', '2026-05-01 15:00-03', 5), { price: 3, flag: null });
eq('empate no mesmo horario -> maior preco', await cost('TIE1', '2026-03-10 10:00-03', 5), { price: 1.5, flag: null });
eq('qty_end vazio = sem limite', await cost('NUL1', '2026-03-10 10:00-03', 500), { price: 2, flag: null });
eq('expired_at ignorado', await cost('EXP1', '2026-06-01 10:00-03', 5), { price: 7, flag: null });

// ---------------- De-para de referencia (0007) ----------------
const ref = async (sku, d) =>
  (await db.query(`select * from analytics.ref_erp($1::text, split_part($1::text,'-',1), nullif(split_part($1::text,'-',2),''), $2::timestamptz)`, [sku, d])).rows[0];
eq('ref: SQM148 troca so o modelo', await ref('SQM148-AZU-K0010-V1', '2026-08-20 10:00-03'), { sku: 'BMS148-AZU-K0010-V1', modelo: 'BMS148', cor: 'AZU' });
eq('ref: SQM148 so modelo-cor', await ref('SQM148-AZU', '2026-11-12 23:00-03'), { sku: 'BMS148-AZU', modelo: 'BMS148', cor: 'AZU' });
eq('ref: depois de 12/11/2026 fica o original', await ref('SQM148-AZU', '2026-11-13 08:00-03'), { sku: 'SQM148-AZU', modelo: 'SQM148', cor: 'AZU' });
eq('ref: CMT44-CDE-69 -> BOB01-PDR', await ref('CMT44-CDE-69', '2026-08-14 10:00-03'), { sku: 'BOB01-PDR', modelo: 'BOB01', cor: 'PDR' });
eq('ref: CMT44 de outra cor nao muda', await ref('CMT44-AZU-70', '2026-08-14 10:00-03'), { sku: 'CMT44-AZU-70', modelo: 'CMT44', cor: 'AZU' });
eq('ref: sem ligacao fica igual', await ref('BLA68-AMA-K0010-V1', '2026-08-14 10:00-03'), { sku: 'BLA68-AMA-K0010-V1', modelo: 'BLA68', cor: 'AMA' });
eq('ref: sku nulo', await ref(null, '2026-08-14 10:00-03'), { sku: null, modelo: null, cor: null });

// Atualizacao a partir da versao anterior da 0007 (linha CMT44 sem cor) e reexecucao
await db.exec(`insert into map.modelo_de_para (modelo_anuncio, modelo_erp, ate) values ('CMT44', 'BOB01', '2026-11-12')`);
await db.exec(readFileSync(`${repo}/supabase/migrations/0007_de_para_modelo.sql`, 'utf8'));
eq('de-para: 2 ligacoes apos reexecutar', (await db.query(`select modelo_anuncio, cor_anuncio, sku_erp from map.modelo_de_para order by 1`)).rows,
  [{ modelo_anuncio: 'CMT44', cor_anuncio: 'CDE', sku_erp: 'BOB01-PDR' }, { modelo_anuncio: 'SQM148', cor_anuncio: null, sku_erp: null }]);

// Views: o dashboard mostra a referencia do ERP e custeia por ela
await db.exec(`
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, source) values
 ('BOB01', 1, 1000, 25.96, '2026-11-12 00:00-03', 'erp');
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw) values
 ('mercadolivre','S1','paid','2026-08-20 13:00+00','2026-08-20 13:00+00', 50, '{}'),
 ('mercadolivre','C1','paid','2026-08-14 13:00+00','2026-08-14 13:00+00', 90, '{}'),
 ('mercadolivre','S2','paid','2026-11-13 13:00+00','2026-11-13 13:00+00', 50, '{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','S1',1,'MLB9','SQM148-AZU-K0010-V1','x',1,50,0),
 ('mercadolivre','C1',1,'MLB8','CMT44-CDE-67','y',2,45,0),
 ('mercadolivre','S2',1,'MLB9','SQM148-AZU-K0010-V1','x',1,50,0);
`);
const ped = async (id) => (await db.query(
  `select sku, sku_anuncio, modelo, cor, custo_unitario::float, custo_produto::float, alerta_custo from analytics.ml_pedidos where order_id = $1`, [id])).rows[0];
eq('view: SQM148 aparece como BMS148', await ped('S1'),
  { sku: 'BMS148-AZU-K0010-V1', sku_anuncio: 'SQM148-AZU-K0010-V1', modelo: 'BMS148', cor: 'AZU', custo_unitario: 2.04, custo_produto: 20.4, alerta_custo: null });
eq('view: CMT44-CDE-67 aparece como BOB01-PDR (cotacao posterior)', await ped('C1'),
  { sku: 'BOB01-PDR', sku_anuncio: 'CMT44-CDE-67', modelo: 'BOB01', cor: 'PDR', custo_unitario: 25.96, custo_produto: 51.92, alerta_custo: 'faixa_atual' });
eq('view: venda depois do limite fica com o SKU do anuncio', (await ped('S2')).modelo, 'SQM148');
eq('alertas usam a referencia do ERP', (await db.query(`select tipo, codigo from analytics.ml_alertas order by codigo`)).rows,
  [{ tipo: 'faixa_atual', codigo: 'BOB01' }, { tipo: 'sem_custo', codigo: 'SQM148' }]);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
