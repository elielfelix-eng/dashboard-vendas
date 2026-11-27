'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { criarClienteNavegador } from '@/lib/supabase/browser';

export default function DefinirSenhaPage() {
  const [temSessao, setTemSessao] = useState<boolean | null>(null);
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  // O link do convite entrega a sessao pela URL; o cliente do navegador a le sozinho.
  useEffect(() => {
    const supabase = criarClienteNavegador();
    async function iniciar() {
      // Formato PKCE: o link traz ?code=... e precisa ser trocado por sessao.
      const codigo = new URLSearchParams(window.location.search).get('code');
      if (codigo) {
        const { error } = await supabase.auth.exchangeCodeForSession(codigo);
        if (error) console.error('definir-senha: falha_troca_codigo', error.code ?? 'sem_codigo');
        window.history.replaceState(null, '', window.location.pathname);
      }
      // Formato implicito: o link traz #access_token=... e o cliente le sozinho.
      const { data } = await supabase.auth.getSession();
      setTemSessao(!!data.session);
    }
    iniciar();
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.');
    if (senha !== confirmacao) return setErro('As senhas não conferem.');
    setEnviando(true);
    const { error } = await criarClienteNavegador().auth.updateUser({ password: senha });
    setEnviando(false);
    if (error) return setErro('Não foi possível salvar a senha. Peça um novo link.');
    setPronto(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <div className="-mx-8 -mt-8 mb-8 h-1 bg-accent" aria-hidden="true" />

        <div className="flex flex-col items-center">
          <Logo versao="principal" className="w-56" />
          <h1 className="mt-6 text-xl font-bold">Criar senha</h1>
        </div>

        {temSessao === null && <p className="mt-6 text-center text-sm text-muted">Verificando o link…</p>}

        {temSessao === false && (
          <>
            <p className="mt-6 text-center text-sm text-muted" role="alert">
              Este link não é válido ou expirou. Peça um novo em "Primeiro acesso".
            </p>
            <p className="mt-6 text-center text-sm">
              <Link href="/cadastro" className="text-link hover:underline">Pedir novo link</Link>
            </p>
          </>
        )}

        {temSessao && !pronto && (
          <form onSubmit={salvar}>
            <label className="mt-6 block text-sm font-semibold" htmlFor="senha">Nova senha</label>
            <input id="senha" type="password" autoComplete="new-password" required minLength={8} value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-brand-2" />

            <label className="mt-4 block text-sm font-semibold" htmlFor="confirmacao">Repita a senha</label>
            <input id="confirmacao" type="password" autoComplete="new-password" required minLength={8} value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-brand-2" />

            {erro && <p className="mt-4 text-sm text-bad" role="alert">{erro}</p>}

            <button type="submit" disabled={enviando}
              className="mt-6 w-full rounded-lg bg-accent-strong px-4 py-2 font-semibold text-on-accent-strong disabled:opacity-60">
              {enviando ? 'Salvando…' : 'Salvar senha'}
            </button>
          </form>
        )}

        {pronto && (
          <>
            <p className="mt-6 text-center text-sm text-muted" role="status">Senha criada. Já pode entrar no painel.</p>
            <p className="mt-6 text-center text-sm">
              <Link href="/" className="text-link hover:underline">Ir para o painel</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
