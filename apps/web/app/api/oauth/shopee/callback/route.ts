import { NextResponse, type NextRequest } from 'next/server';
import { exchangeShopeeCode } from '@dash/connectors';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { SHOPEE_OAUTH_COOKIE, shopeeApp } from '@/lib/shopee';

/**
 * Retorno da Shopee após o admin autorizar a loja: troca o código por tokens e salva no Vault.
 * O código de autorização e os tokens nunca vão para o log nem para a tela.
 */
export async function GET(req: NextRequest) {
  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(`/configuracoes/conexoes?${q}`, req.url));
    res.cookies.delete({ name: SHOPEE_OAUTH_COOKIE, path: '/api/oauth/shopee' });
    return res;
  };

  const ctx = await getCurrentUser();
  if (!ctx || ctx.profile?.role !== 'admin') return NextResponse.redirect(new URL('/', req.url));

  const params = req.nextUrl.searchParams;
  let saved: { state: string; uid: string } | null = null;
  try {
    saved = JSON.parse(req.cookies.get(SHOPEE_OAUTH_COOKIE)?.value ?? 'null');
  } catch { /* cookie inválido */ }
  if (!saved || saved.state !== params.get('state') || saved.uid !== ctx.user.id) return done('erro=state');

  const code = params.get('code');
  const shopId = params.get('shop_id') ?? '';
  if (!code || !/^\d+$/.test(shopId)) return done('erro=negado-shopee');

  let etapa = 'shopee-token';
  try {
    const tokens = await exchangeShopeeCode(shopeeApp(), code, Number(shopId));

    etapa = 'shopee-banco';
    const sql = db();
    await sql.begin(async (tx) => {
      // external_id = shop_id da loja (no ML é o user_id do vendedor)
      const [acc] = await tx<{ id: string }[]>`
        insert into core.accounts (channel, external_id)
        values ('shopee', ${shopId})
        on conflict (channel, external_id) do update set active = true
        returning id`;
      await tx`select core.save_oauth_tokens(${acc.id}, ${tokens.accessToken}, ${tokens.refreshToken}, ${tokens.expiresAt}, ${tokens.scope ?? null})`;
    });
    return done('ok=shopee');
  } catch (err) {
    const detalhe = safeDetail(err);
    console.error(`Falha na conexão da Shopee (etapa ${etapa}):`, detalhe);
    return done(new URLSearchParams({ erro: 'falha', etapa, detalhe }).toString());
  }
}

/** Resumo do erro para log e tela, sem tokens/códigos/senhas. */
function safeDetail(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const text = [e.code, e.message].filter(Boolean).join(' - ');
  return text.replace(/[A-Za-z0-9_\-.:/@]{30,}/g, '[oculto]').slice(0, 200);
}
