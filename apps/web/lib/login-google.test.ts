import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinoCallback, MENSAGEM_ERRO_GOOGLE } from './login-google.ts';

test('com código válido segue para o painel', () => {
  assert.equal(destinoCallback(new URLSearchParams('code=abc')), null);
});

test('sem código vai para o login com aviso', () => {
  assert.equal(destinoCallback(new URLSearchParams('')), '/login?erro=google');
});

test('e-mail sem conta (cadastro desligado no Supabase) vai para o login com aviso', () => {
  const params = new URLSearchParams('error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed');
  assert.equal(destinoCallback(params), '/login?erro=google');
});

test('mensagem não revela detalhes', () => {
  assert.match(MENSAGEM_ERRO_GOOGLE, /administrador/);
});
