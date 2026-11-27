'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Logo } from '@/components/logo';
import { login } from './actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={action} className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <div className="-mx-8 -mt-8 mb-8 h-1 bg-accent" aria-hidden="true" />

        <div className="flex flex-col items-center">
          <Logo versao="principal" className="w-56" />
          <h1 className="mt-6 text-xl font-bold">Painel de Vendas</h1>
        </div>
        <p className="mt-1 text-center text-sm text-muted">Entre com o acesso fornecido pelo administrador.</p>

        <label className="mt-6 block text-sm font-semibold" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-brand-2" />

        <label className="mt-4 block text-sm font-semibold" htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-brand-2" />

        {state?.error && <p className="mt-4 text-sm text-bad" role="alert">{state.error}</p>}

        <p className="mt-6 text-center text-sm">
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
