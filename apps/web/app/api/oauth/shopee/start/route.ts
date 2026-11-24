import { NextResponse, type NextRequest } from 'next/server';
import { createState, shopeeAuthUrl } from '@dash/connectors';
import { getCurrentUser } from '@/lib/auth';
import { SHOPEE_OAUTH_COOKIE, shopeeApp, shopeeConfigProblems } from '@/lib/shopee';

/** Inicia a conexão com a loja da Shopee (somente admin, somente leitura). */
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUser();
  if (!ctx || ctx.profile?.role !== 'admin') return NextResponse.redirect(new URL('/', req.url));

  const problems = shopeeConfigProblems();
  if (problems.length) {
    const url = new URL('/configuracoes/conexoes', req.url);
    url.searchParams.set('erro', 'config-shopee');
    url.searchParams.set('faltando', problems.join(', '));
    return NextResponse.redirect(url);
  }

  // A Shopee não devolve um "state" próprio: ele vai na URL de retorno e é conferido com o cookie.
  const state = createState();
  const redirect = new URL('/api/oauth/shopee/callback', req.url);
  redirect.searchParams.set('state', state);

  const res = NextResponse.redirect(shopeeAuthUrl(shopeeApp(), redirect.toString(), Math.floor(Date.now() / 1000)));
  res.cookies.set(SHOPEE_OAUTH_COOKIE, JSON.stringify({ state, uid: ctx.user.id }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/oauth/shopee',
    maxAge: 600,
  });
  return res;
}
