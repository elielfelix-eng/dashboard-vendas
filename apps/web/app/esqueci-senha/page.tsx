'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Logo } from '@/components/logo';
import { pedirNovaSenha } from './actions';

export default function EsqueciSenhaPage() {
  const [estado, acao, pendente] = useActionState(pedirNovaSenha, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={acao} className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <div className="-mx-8 -mt-8 mb-8 h-1 bg-accent" aria-hidden="true" />

        <div className="flex flex-col items-center">
          <Logo versao="principal" className="w-56" />
          <h1 className="mt-6 text-xl font-bold">Esqueci minha senha</h1>
        </div>
        <p className="mt-1 text-center text-sm text-muted">
          Informe o e-mail de acesso ao painel. Você receberá um link para criar uma nova senha.
        </p>

        <label className="mt-6 block text-sm font-semibold" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-brand-2" />

        {estado?.mensagem && <p className="mt-4 text-sm text-muted" role="status">{estado.mensagem}</p>}

        <button type="submit" disabled={pendente}
          className="mt-6 w-full rounded-lg bg-accent-strong px-4 py-2 font-semibold text-on-accent-strong disabled:opacity-60">
          {pendente ? 'Enviando…' : 'Receber o link'}
        </button>

        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="text-link hover:underline">Voltar para o login</Link>
        </p>
      </form>
    </main>
  );
}
