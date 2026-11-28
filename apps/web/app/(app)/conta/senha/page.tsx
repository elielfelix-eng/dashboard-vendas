'use client';

import { useActionState } from 'react';
import { alterarSenha } from './actions';

const campo = 'mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-brand-2';

export default function AlterarSenhaPage() {
  const [estado, acao, pendente] = useActionState(alterarSenha, undefined);

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold">Alterar senha</h1>
      <p className="mt-1 text-sm text-muted">Informe a senha atual e escolha uma nova, com pelo menos 8 caracteres.</p>

      {estado?.ok ? (
        <p className="mt-6 rounded-xl border border-border bg-surface p-6 text-sm" role="status">
          Senha alterada. Use a nova senha no próximo acesso.
        </p>
      ) : (
        <form action={acao} className="mt-6 rounded-xl border border-border bg-surface p-6">
          <label className="block text-sm font-semibold" htmlFor="atual">Senha atual</label>
          <input id="atual" name="atual" type="password" autoComplete="current-password" required className={campo} />

          <label className="mt-4 block text-sm font-semibold" htmlFor="nova">Nova senha</label>
          <input id="nova" name="nova" type="password" autoComplete="new-password" required minLength={8} className={campo} />

          <label className="mt-4 block text-sm font-semibold" htmlFor="confirmacao">Repita a nova senha</label>
          <input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" required minLength={8} className={campo} />

          {estado?.erro && <p className="mt-4 text-sm text-bad" role="alert">{estado.erro}</p>}

          <button type="submit" disabled={pendente}
            className="mt-6 w-full rounded-lg bg-accent-strong px-4 py-2 font-semibold text-on-accent-strong disabled:opacity-60">
            {pendente ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </form>
      )}
    </div>
  );
}
