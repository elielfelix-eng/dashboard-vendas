import { NextResponse, type NextRequest } from 'next/server';
import { destinoCallback } from '@/lib/login-google';
import { createClient } from '@/lib/supabase/server';

// Volta do login com Google: troca o código pela sessão (gravada em cookie) e abre o painel.
// E-mail sem conta no Supabase volta com erro (cadastro aberto desligado) e cai no login com aviso.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const destino = destinoCallback(params);
  if (destino) {
    if (params.get('error_code')) console.error('login-google: recusado', params.get('error_code'));
    return NextResponse.redirect(new URL(destino, request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(params.get('code')!);
  if (error) {
    console.error('login-google: falha_troca_codigo', error.code ?? 'sem_codigo');
    return NextResponse.redirect(new URL('/login?erro=google', request.url));
  }
  return NextResponse.redirect(new URL('/', request.url));
}
