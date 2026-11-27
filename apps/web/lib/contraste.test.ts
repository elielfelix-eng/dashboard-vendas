import { test } from 'node:test';
import assert from 'node:assert/strict';
import { razaoContraste } from './contraste.ts';
import { TEMA_CLARO, TEMA_ESCURO } from './tema-cores.ts';

test('razão de contraste de referência (WCAG 2.x)', () => {
  assert.ok(Math.abs(razaoContraste('#363630', '#FFFFFF') - 12.16) < 0.05);
  assert.ok(Math.abs(razaoContraste('#B8D341', '#FFFFFF') - 1.69) < 0.05);
  assert.ok(Math.abs(razaoContraste('#000000', '#FFFFFF') - 21) < 0.001);
  assert.ok(Math.abs(razaoContraste('#ffffff', '#FFFFFF') - 1) < 0.001);
});

const PAPEIS_DE_TEXTO = ['text', 'muted', 'link', 'good', 'bad'] as const;
const FUNDOS = ['surface', 'bg'] as const;

for (const [nome, tema] of [
  ['claro', TEMA_CLARO],
  ['escuro', TEMA_ESCURO],
] as const) {
  for (const papel of PAPEIS_DE_TEXTO) {
    for (const fundo of FUNDOS) {
      test(`modo ${nome}: ${papel} sobre ${fundo} tem ao menos 4,5:1`, () => {
        const razao = razaoContraste(tema[papel], tema[fundo]);
        assert.ok(razao >= 4.5, `${papel} ${tema[papel]} sobre ${fundo} ${tema[fundo]} = ${razao.toFixed(2)}`);
      });
    }
  }
  test(`modo ${nome}: texto sobre o botão primário tem ao menos 4,5:1`, () => {
    const razao = razaoContraste(tema.onAccentStrong, tema.accentStrong);
    assert.ok(razao >= 4.5, `${razao.toFixed(2)}`);
  });
}
