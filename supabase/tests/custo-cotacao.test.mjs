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

eq('de-para: SQM148 em 20/08/2026 usa BMS148', await cost('SQM148', '2026-08-20 10:00-03', 10), { price: 2.04, flag: null });
eq('de-para: vale ate 12/11/2026 23h (Brasilia)', await cost('SQM148', '2026-11-12 23:00-03', 10), { price: 2.04, flag: null });
eq('de-para: depois de 12/11/2026 volta a sem_custo', await cost('SQM148', '2026-11-13 08:00-03', 10), { price: 0, flag: 'sem_custo' });
eq('de-para: modelo sem ligacao fica igual', (await db.query(`select analytics.modelo_erp('BLA68', now()) as m`)).rows[0], { m: 'BLA68' });
eq('de-para: sementes gravadas uma vez', (await db.query(`select count(*)::int as n from map.modelo_de_para`)).rows[0], { n: 2 });
eq('de-para: CMT44 -> BOB01 ate 12/11/2026', (await db.query(`select analytics.modelo_erp('CMT44', '2026-08-14 10:00-03') as m`)).rows[0], { m: 'BOB01' });

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
