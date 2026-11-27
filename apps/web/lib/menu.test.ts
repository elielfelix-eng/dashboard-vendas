import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU, menuVisivel, itemAtivo } from './menu.ts';
import type { Permissao } from './permissoes';

const rotulosDo = (grupos: ReturnType<typeof menuVisivel>, rotulo: string) =>
  grupos.find((g) => g.rotulo === rotulo)?.itens.map((i) => i.href) ?? null;

test('item com permissão só aparece para quem tem a permissão', () => {
  const grupos = menuVisivel(['vendas'] as Permissao[]);
  const principal = rotulosDo(grupos, 'Principal') ?? [];
  assert.ok(principal.includes('/vendas'));
  assert.ok(!principal.includes('/rentabilidade'));
});

test('item sem permissão definida aparece para quem tem pelo menos uma permissão', () => {
  const grupos = menuVisivel(['vendas'] as Permissao[]);
  assert.ok((rotulosDo(grupos, 'Principal') ?? []).includes('/anuncios'));
  assert.deepEqual(menuVisivel([] as Permissao[]), []);
});

test('grupo sem nenhum item visível não aparece', () => {
  const grupos = menuVisivel(['visao_geral'] as Permissao[]);
  assert.equal(rotulosDo(grupos, 'Administração'), null);
  assert.equal(rotulosDo(grupos, 'CRM'), null);
});

test('perfil só com crm_funil vê o funil do CRM, sem as telas de vendas e administração', () => {
  const grupos = menuVisivel(['crm_funil'] as Permissao[]);
  const crm = rotulosDo(grupos, 'CRM') ?? [];
  assert.ok(crm.includes('/crm/funil'));
  assert.ok(!crm.includes('/crm/vendedores'));
  assert.ok(!(rotulosDo(grupos, 'Principal') ?? []).includes('/vendas'));
  assert.equal(rotulosDo(grupos, 'Administração'), null);
});

test('todos os itens têm um ícone', () => {
  for (const grupo of MENU) for (const item of grupo.itens) assert.ok(item.icone, item.href);
});

test('itemAtivo: a raiz só vale na rota exata', () => {
  assert.equal(itemAtivo('/', '/vendas'), false);
  assert.equal(itemAtivo('/', '/'), true);
});

test('itemAtivo: rotas aninhadas valem pelo prefixo exato de segmento', () => {
  assert.equal(itemAtivo('/configuracoes/metas', '/configuracoes/metas'), true);
  assert.equal(itemAtivo('/metas', '/configuracoes/metas'), false);
  assert.equal(itemAtivo('/vendas', '/vendas/detalhe'), true);
});
