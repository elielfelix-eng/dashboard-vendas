'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { MENSAGEM_ERRO_GOOGLE } from '@/lib/login-google';
import { criarClienteNavegador } from '@/lib/supabase/browser';
import { login } from './actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  const [erroGoogle, setErroGoogle] = useState(false);
  const [indoGoogle, setIndoGoogle] = useState(false);

  // A volta do Google com erro chega como /login?erro=google.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('erro') === 'google') {
      setErroGoogle(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function entrarComGoogle() {
    setIndoGoogle(true);
    setErroGoogle(false);
    const { error } = await criarClienteNavegador().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      console.error('login-google: nao_iniciou', error.code ?? 'sem_codigo');
      setErroGoogle(true);
      setIndoGoogle(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={action} className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <div className="-mx-8 -mt-8 mb-8 h-1 bg-accent" aria-hidden="true" />

        <div className="flex flex-col items-center">
          <Logo versao="principal" className="w-56" />
          <h1 className="mt-6 text-xl font-bold">Painel de Vendas</h1>
        </div>
        <p className="mt-1 text-center text-sm text-muted">Entre com o acesso fornecido pelo administrador.</p>

        <button type="button" onClick={entrarComGoogle} disabled={indoGoogle}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-bg px-4 py-2 font-semibold hover:bg-accent-soft disabled:opacity-60">
          <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          {indoGoogle ? 'Abrindo o Google…' : 'Entrar com Google'}
        </button>

        {erroGoogle && <p className="mt-4 text-sm text-bad" role="alert">{MENSAGEM_ERRO_GOOGLE}</p>}

        <div className="mt-6 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />ou com e-mail e senha<span className="h-px flex-1 bg-border" />
        </div>

        <label className="mt-4 block text-sm font-semibold" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-brand-2" />

        <label className="mt-4 block text-sm font-semibold" htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-brand-2" />

        {state?.error && <p className="mt-4 text-sm text-bad" role="alert">{state.error}</p>}

        <p className="mt-6 flex justify-between gap-4 text-sm">
          <Link href="/esqueci-senha" className="text-link hover:underline">Esqueci minha senha</Link>
          <Link href="/cadastro" className="text-link hover:underline">Primeiro acesso do vendedor</Link>
        </p>

        <button type="submit" disabled={pending}
          className="mt-6 w-full rounded-lg bg-accent-strong px-4 py-2 font-semibold text-on-accent-strong disabled:opacity-60">
          {pending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
