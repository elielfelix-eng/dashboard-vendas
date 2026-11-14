import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPOS_DEAL, CAMPOS_LEAD, domingoEmBrasilia, mapDeal, mapHistorico, mapLead, mapStage, mapUser,
  mapaAreas, origensNovas, paraFiltroBitrix, semantica, separarNegocios, type LinhaDeal,
} from './mapear.ts';

test('mapear: mapDeal converte tipos, vazio vira null e a área vira o rótulo', () => {
  const r = mapDeal({
    ID: '5', CATEGORY_ID: '10', STAGE_ID: 'C10:WON', STAGE_SEMANTIC_ID: 'S', SOURCE_ID: '19',
    ASSIGNED_BY_ID: '77', LEAD_ID: '', CONTACT_ID: '12', COMPANY_ID: null, OPPORTUNITY: '1500.50',
    CURRENCY_ID: 'BRL', DATE_CREATE: '2026-11-01T02:30:00+03:00', DATE_MODIFY: '2026-11-02T10:00:00+03:00',
    CLOSEDATE: '2026-11-03T00:00:00+03:00', CLOSED: 'Y', UF_CRM_1740402485: '301',
  }, new Map([['301', 'Pedido Online']]));
  assert.deepEqual(r, {
    id: 5, category_id: 10, stage_id: 'C10:WON', stage_semantic_id: 'S', source_id: '19',
    assigned_by_id: 77, lead_id: null, contact_id: 12, company_id: null, opportunity: 1500.5,
    currency_id: 'BRL', date_create: '2026-11-01T02:30:00+03:00', date_modify: '2026-11-02T10:00:00+03:00',
    closedate: '2026-11-03T00:00:00-03:00', closed: true, area: 'Pedido Online',
  });
});

test('mapear: CLOSEDATE é só data (fuso do portal) e vira o mesmo dia em Brasília', () => {
  const m = new Map<string, string>();
  assert.equal(mapDeal({ ID: '9', CLOSEDATE: '2026-11-01T03:00:00+03:00' }, m).closedate, '2026-11-01T00:00:00-03:00');
  assert.equal(mapDeal({ ID: '9', CLOSEDATE: '2026-11-01' }, m).closedate, '2026-11-01T00:00:00-03:00');
  assert.equal(mapDeal({ ID: '9', CLOSEDATE: '' }, m).closedate, null);
  assert.equal(mapDeal({ ID: '9' }, m).closedate, null);
  // as outras datas ficam como vieram
  assert.equal(mapDeal({ ID: '9', DATE_CREATE: '2026-11-01T03:00:00+03:00' }, m).date_create, '2026-11-01T03:00:00+03:00');
});

test('mapear: mapDeal com CLOSED N, área desconhecida ou vazia e área em lista', () => {
  const areas = new Map([['300', 'Brinde do Bem']]);
  const a = mapDeal({ ID: '6', CATEGORY_ID: '10', CLOSED: 'N', OPPORTUNITY: '0', UF_CRM_1740402485: '999' }, areas);
  assert.equal(a.closed, false);
  assert.equal(a.opportunity, 0);
  assert.equal(a.area, null);
  assert.equal(a.date_create, null);
  assert.equal(mapDeal({ ID: '7', UF_CRM_1740402485: '' }, areas).area, null);
  assert.equal(mapDeal({ ID: '8', UF_CRM_1740402485: ['300'] }, areas).area, 'Brinde do Bem');
});

test('mapear: mapLead sem título, e-mail nem telefone', () => {
  const r = mapLead({
    ID: '9', STATUS_ID: 'NEW', SOURCE_ID: '10|WHATSAPP', ASSIGNED_BY_ID: '3', DATE_CREATE: '2026-11-01T02:30:00+03:00',
    DATE_MODIFY: '2026-11-01T03:00:00+03:00', DATE_CLOSED: '', CONTACT_ID: null, COMPANY_ID: '0', OPPORTUNITY: '',
    TITLE: 'Fulano', EMAIL: 'x@y.z', PHONE: '119999',
  });
  assert.deepEqual(r, {
    id: 9, status_id: 'NEW', source_id: '10|WHATSAPP', assigned_by_id: 3, date_create: '2026-11-01T02:30:00+03:00',
    date_modify: '2026-11-01T03:00:00+03:00', date_closed: null, contact_id: null, company_id: 0, opportunity: null,
  });
  for (const k of ['title', 'email', 'phone']) assert.ok(!(k in r), k);
});

test('mapear: listas de campos não pedem dados pessoais nem UF_* extras', () => {
  for (const c of ['TITLE', 'EMAIL', 'PHONE', 'NAME', 'LAST_NAME', '*', 'UF_*']) assert.ok(!CAMPOS_LEAD.includes(c), c);
  assert.ok(CAMPOS_LEAD.includes('SOURCE_ID'));
  assert.deepEqual(CAMPOS_DEAL.filter((c) => c.startsWith('UF_')), ['UF_CRM_1740402485']);
  assert.ok(!CAMPOS_DEAL.includes('*'));
});

test('mapear: semantica S/F/resto', () => {
  assert.equal(semantica({ SEMANTICS: 'S' }), 'ganho');
  assert.equal(semantica({ SEMANTICS: 'F' }), 'perdido');
  assert.equal(semantica({ SEMANTICS: null }), 'andamento');
  assert.equal(semantica({ SEMANTICS: 'P' }), 'andamento');
  assert.equal(semantica({}), 'andamento');
});

test('mapear: mapStage de lead e de negócio (C10: mantido)', () => {
  assert.deepEqual(mapStage({ ENTITY_ID: 'STATUS', STATUS_ID: 'CONVERTED', NAME: 'Convertido', SORT: '60', SEMANTICS: 'S' }), {
    entity: 'lead', status_id: 'CONVERTED', category_id: null, nome: 'Convertido', ordem: 60, semantica: 'ganho',
  });
  assert.deepEqual(mapStage({ ENTITY_ID: 'DEAL_STAGE_10', STATUS_ID: 'C10:LOSE', NAME: 'Perdido', SORT: '70', SEMANTICS: 'F', CATEGORY_ID: '10' }), {
    entity: 'deal', status_id: 'C10:LOSE', category_id: 10, nome: 'Perdido', ordem: 70, semantica: 'perdido',
  });
});

test('mapear: mapHistorico e mapUser', () => {
  assert.deepEqual(mapHistorico({ ID: 44, OWNER_ID: '5', STAGE_ID: 'C10:NEW', CREATED_TIME: '2026-11-01T02:30:00+03:00' }), {
    id: 44, deal_id: 5, stage_id: 'C10:NEW', entrou_em: '2026-11-01T02:30:00+03:00',
  });
  assert.deepEqual(mapUser({ ID: '3', NAME: 'Ana', LAST_NAME: 'Silva', EMAIL: 'Ana@X.com ', ACTIVE: true }), {
    bitrix_id: 3, nome: 'Ana Silva', email: 'Ana@X.com ', ativo: true,
  });
  assert.deepEqual(mapUser({ ID: '4', NAME: 'Bia', LAST_NAME: '', EMAIL: '', ACTIVE: false }), {
    bitrix_id: 4, nome: 'Bia', email: null, ativo: false,
  });
});

test('mapear: mapaAreas lê os itens do campo de Área de Negócio', () => {
  const m = mapaAreas({ UF_CRM_1740402485: { type: 'enumeration', items: [{ ID: '300', VALUE: 'Brinde do Bem' }, { ID: '301', VALUE: 'Pedido Online' }] } });
  assert.equal(m.get('301'), 'Pedido Online');
  assert.equal(mapaAreas({}).size, 0);
});

test('mapear: separarNegocios mantém o funil 10 e remove quem saiu dele', () => {
  const linhas = [{ id: 1, category_id: 10 }, { id: 2, category_id: 33 }] as LinhaDeal[];
  const r = separarNegocios(linhas);
  assert.deepEqual(r.manter.map((d) => d.id), [1]);
  assert.equal(r.manter[0], linhas[0]);
  assert.deepEqual(r.remover, [2]);
});

test('mapear: domingo é o dia em Brasília', () => {
  assert.equal(domingoEmBrasilia(new Date('2026-11-15T02:00:00Z')), false); // sáb 23h BRT
  assert.equal(domingoEmBrasilia(new Date('2026-11-15T04:00:00Z')), true);  // dom 01h BRT
  assert.equal(domingoEmBrasilia(new Date('2026-11-16T02:59:00Z')), true);  // dom 23h59 BRT
  assert.equal(domingoEmBrasilia(new Date('2026-11-16T03:00:00Z')), false); // seg 00h BRT
});

test('mapear: origensNovas devolve as origens ativadas desde a última execução', () => {
  assert.deepEqual(origensNovas(['19', '23'], ['19']), ['23']);
  assert.deepEqual(origensNovas(['19'], ['19', '23']), []);
  assert.deepEqual(origensNovas(['19'], null), ['19']);
});

test('mapear: data para o filtro do Bitrix com fuso explícito', () => {
  assert.equal(paraFiltroBitrix(new Date('2026-11-14T10:05:07.123Z')), '2026-11-14T10:05:07+00:00');
});
