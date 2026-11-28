// Cliente do Supabase com a chave anon, sem guardar sessão em cookie. Só no servidor.
// Usado para conferir a senha atual sem mexer na sessão do usuário e para pedir o link de recuperação.
// Fluxo implícito: o link do e-mail chega com #access_token, e funciona aberto em qualquer aparelho
// (o PKCE exigiria abrir no mesmo navegador que pediu o link).
import { createClient } from '@supabase/supabase-js';

export function criarClienteAvulso() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' } },
  );
}
