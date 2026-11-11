import { NextResponse, type NextRequest } from 'next/server';
import { HttpError, ML_API, exchangeCode, fetchJson } from '@dash/connectors';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { ML_OAUTH_COOKIE, mlApp } from '@/lib/mercadolivre';

/** Retorno do ML após o admin autorizar: troca o código por tokens e salva no Vault. */
export async function GET(req: NextRequest) {
  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/configuracoes/conexoes?${q}`, req.url));
    res.cookies.delete({ name: ML_OAUTH_COOKIE, path: '/api/oauth/mercadolivre' });
    return res;
  };

  const ctx = await getCurrentUser();
  if (!ctx || ctx.profile?.role !== 'admin') return NextResponse.redirect(new URL('/', req.url));

  const params = req.nextUrl.searchParams;
  if (params.get('error')) return done('erro=negado');

  let saved: { state: string; verifier: string; uid: string } | null = null;
  try {
    saved = JSON.parse(req.cookies.get(ML_OAUTH_COOKIE)?.value ?? 'null');
  } catch { /* cookie inválido */ }
  const code = params.get('code');
  if (!saved || !code || saved.state !== params.get('state') || saved.uid !== ctx.user.id) return done('erro=state');

  let etapa = 'token';
  try {
    const tokens = await exchangeCode(mlApp(), code, saved.verifier);
    etapa = 'conta';
    const me = await fetchJson<{ id: number; nickname: string }>(`${ML_API}/users/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    etapa = 'banco';
    const sql = db();
    await sql.begin(async (tx) => {
      const [acc] = await tx<{ id: string }[]>`
        insert into core.accounts (channel, external_id, nickname)
        values ('mercadolivre', ${tokens.externalUserId}, ${me.nickname})
        on conflict (channel, external_id) do update set nickname = excluded.nickname, active = true
        returning id`;
      await tx`select core.save_oauth_tokens(${acc.id}, ${tokens.accessToken}, ${tokens.refreshToken}, ${tokens.expiresAt}, ${tokens.scope ?? null})`;
    });
    return done('ok=mercadolivre');
  } catch (err) {
    console.error(`Falha no OAuth do Mercado Livre (etapa ${etapa}):`, (err as Error).message);
    const q = new URLSearchParams({ erro: 'falha', etapa, detalhe: safeDetail(err) });
    return done(q.toString());
  }
}

/** Resumo do erro para exibir na tela, sem tokens/senhas. */
function safeDetail(err: unknown): string {
  let text: string;
  if (err instanceof HttpError) {
    let code = '';
    try {
      const b = JSON.parse(err.body) as { error?: string; message?: string };
      code = [b.error, b.message].filter(Boolean).join(' - ');
    } catch { /* corpo não-JSON */ }
    text = `HTTP ${err.status}${code ? ` ${code}` : ''}`;
  } else {
    const e = err as { code?: string; message?: string };
    text = [e.code, e.message].filter(Boolean).join(' - ');
  }
  // Remove qualquer sequência longa que possa ser token/senha e limita o tamanho
  return text.replace(/[A-Za-z0-9_\-.:/@]{30,}/g, '[oculto]').slice(0, 200);
}
