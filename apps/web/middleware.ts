import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { CookieToSet } from '@/lib/supabase/server';

const PUBLIC_PATHS = ['/login'];

/** Página simples explicando o que falta configurar (mostra só NOMES, nunca valores). */
function configError(problems: string[]) {
  const items = problems.map((p) => `<li>${p}</li>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Configuração incompleta</title>
<body style="font-family:system-ui;max-width:640px;margin:48px auto;padding:0 16px;line-height:1.5">
<h1>Configuração incompleta</h1>
<p>O site não consegue falar com o Supabase. Na Vercel, abra <b>Settings &gt; Environment Variables</b> e corrija:</p>
<ul>${items}</ul>
<p>Depois publique de novo: <b>Deployments &gt; ⋯ &gt; Redeploy</b>. Variáveis que começam com <code>NEXT_PUBLIC_</code> só passam a valer depois de um novo deploy.</p>
</body></html>`;
  return new NextResponse(html, { status: 500, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function checkEnv(): string[] {
  const problems: string[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) problems.push('<code>NEXT_PUBLIC_SUPABASE_URL</code> não está cadastrada.');
  else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url.trim()))
    problems.push('<code>NEXT_PUBLIC_SUPABASE_URL</code> deve ter o formato <code>https://xxxx.supabase.co</code> (sem nada depois de .co).');
  if (!key) problems.push('<code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> não está cadastrada.');
  return problems;
}

/** Renova a sessão em toda requisição e manda quem não está logado para /login. */
export async function middleware(request: NextRequest) {
  const problems = checkEnv();
  if (problems.length) return configError(problems);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: CookieToSet[]) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  let user = null;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch (err) {
    console.error('Middleware: falha ao consultar a sessão no Supabase:', (err as Error).message);
  }

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
