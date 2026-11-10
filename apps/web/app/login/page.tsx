'use client';

import { useActionState } from 'react';
import { login } from './actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={action} className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Painel de Vendas</h1>
        <p className="mt-1 text-sm text-muted">Entre com o acesso fornecido pelo administrador.</p>

        <label className="mt-6 block text-sm font-medium" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-accent" />

        <label className="mt-4 block text-sm font-medium" htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-accent" />

        {state?.error && <p className="mt-4 text-sm text-bad" role="alert">{state.error}</p>}

        <button type="submit" disabled={pending}
          className="mt-6 w-full rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-60">
          {pending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}
