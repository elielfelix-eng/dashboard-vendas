import { NextResponse, type NextRequest } from 'next/server';
import { ML_API, exchangeCode, fetchJson } from '@dash/connectors';
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

  try {
    const tokens = await exchangeCode(mlApp(), code, saved.verifier);
    const me = await fetchJson<{ id: number; nickname: string }>(`${ML_API}/users/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

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
    console.error('Falha no OAuth do Mercado Livre:', (err as Error).message);
    return done('erro=falha');
  }
}
