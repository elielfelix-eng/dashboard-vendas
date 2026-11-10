import { NextResponse, type NextRequest } from 'next/server';
import { buildAuthorizeUrl, createPkcePair, createState } from '@dash/connectors';
import { getCurrentUser } from '@/lib/auth';
import { ML_OAUTH_COOKIE, mlApp } from '@/lib/mercadolivre';

/** Inicia a conexão com o ML (somente admin). */
export async function GET(req: NextRequest) {
  const ctx = await getCurrentUser();
  if (!ctx || ctx.profile?.role !== 'admin') return NextResponse.redirect(new URL('/', req.url));

  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const res = NextResponse.redirect(buildAuthorizeUrl(mlApp(), state, challenge));
  res.cookies.set(ML_OAUTH_COOKIE, JSON.stringify({ state, verifier, uid: ctx.user.id }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/oauth/mercadolivre',
    maxAge: 600,
  });
  return res;
}
