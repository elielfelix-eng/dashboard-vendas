import { unstable_cache } from 'next/cache';
import { createClient as clienteSupabase, type SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUser } from './auth';
import { CACHE_SEGUNDOS, TAG_PAINEL, chaveCache, identidadeCache } from './cache-chave';
import { getPermissoes } from './permissoes';
import { createClient } from './supabase/server';
import { medir } from './tempo';

// Chamada às funções analytics.* do painel com cache de 10 minutos por identidade de acesso (cache-chave.ts).
// A sessão (cookies) é lida FORA do cache; dentro dele, um cliente Supabase usa só o token do usuário
// (cabeçalho Authorization), então RLS e permissões continuam valendo no banco. O token não entra na
// chave nem no log. Erro do banco é lançado (com a mensagem da tela) e não é guardado no cache.

type Linhas = Record<string, unknown>[];

/** Usuário dono do token (campo sub do JWT), para conferir que o token é da mesma sessão do perfil. */
function donoDoToken(token: string): string | null {
  try {
    const sub = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'))?.sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/** Token e identidade da requisição atual; null quando não dá para usar o cache com segurança. */
async function acesso(): Promise<{ token: string; identidade: string } | null> {
  const ctx = await getCurrentUser();
  if (!ctx?.profile?.role) return null;
  const identidade = identidadeCache(ctx.profile.role, ctx.profile.channels, await getPermissoes());
  if (!identidade) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token || donoDoToken(token) !== ctx.user.id) return null;
  return { token, identidade };
}

/**
 * Executa analytics.<fn>(args) com cache. `erro`: prefixo do log e texto do erro da tela (iguais aos de antes).
 * Log: "[tempo] <fn> <ms>ms" quando consulta o banco; "[tempo] <fn> cache <ms>ms" quando vem do cache.
 */
export async function rpcComCache(fn: string, args: Record<string, unknown>,
  erro: { prefixo: string; mensagem: string; logarDetalhe: boolean }): Promise<Linhas> {
  const consultar = async (cliente: SupabaseClient) => {
    const { data, error } = await medir(fn, async () => cliente.schema('analytics').rpc(fn, args));
    if (error) {
      if (erro.logarDetalhe) console.error(`${erro.prefixo} ${fn}:`, error.message);
      else console.error(`${erro.prefixo} ${fn}`);
      throw new Error(erro.mensagem);
    }
    return (data as Linhas | null) ?? [];
  };

  const a = await acesso();
  if (!a) return consultar(await createClient()); // sem perfil/sessão: como antes, sem cache

  const { token } = a;
  let doBanco = false;
  const inicio = performance.now();
  const cacheado = unstable_cache(
    async () => {
      doBanco = true;
      const cliente = clienteSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      return consultar(cliente);
    },
    [chaveCache(fn, args, a.identidade)],
    { revalidate: CACHE_SEGUNDOS, tags: [TAG_PAINEL] },
  );
  const linhas = await cacheado();
  if (!doBanco) console.log(`[tempo] ${fn} cache ${Math.round(performance.now() - inicio)}ms`);
  return linhas;
}
