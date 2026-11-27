// Cliente administrativo do Supabase (chave service_role). SO para uso no servidor (ex.: actions.ts).
// A chave vem de variavel de ambiente sem prefixo NEXT_PUBLIC_, entao nunca chega ao navegador.
// Nunca registrar a chave nem o e-mail em logs.
import { createClient } from '@supabase/supabase-js';

export function criarClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error('cadastro: configuracao ausente');
  return createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
}
