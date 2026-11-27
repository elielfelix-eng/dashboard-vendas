// Cliente do Supabase para o navegador (chave anon, publica). Usado na pagina de definir senha do convite.
import { createBrowserClient } from '@supabase/ssr';

export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
  );
}
