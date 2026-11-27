import { unstable_cache } from 'next/cache';
import { createClient as clienteSupabase, type SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUser } from './auth';
import { CACHE_SEGUNDOS, LIMITE_BYTES_CACHE, TAG_PAINEL, chaveCache, decidirCache } from './cache-chave';
import { getPermissoesComErro } from './permissoes';
import { createClient } from './supabase/server';
import { medir } from './tempo';

// Só no servidor. O pacote 'server-only' não está instalado no projeto: guarda equivalente em tempo de execução
// (e este módulo já depende de next/headers via ./supabase/server, que não compila em componente de cliente).
if (typeof window !== 'undefined') throw new Error('lib/rpc-cache.ts só pode ser usado no servidor');

// Chamada às funções analytics.* do painel com cache por identidade de acesso, data de Brasília e janela de
// 10 minutos do relógio (cache-chave.ts): um resultado nunca é servido depois do fim da janela de 10 minutos
// em que foi calculado. A sessão (cookies) é lida FORA do cache; dentro dele, um cliente Supabase usa só o
// token do usuário (cabeçalho Authorization), então RLS e permissões continuam valendo no banco. O token não
// entra na chave nem no log. Erro do banco é lançado (com a mensagem da tela) e não é guardado no cache.

type Linhas = Record<string, unknown>[];

/** Resultado grande demais para o cache do Next: sai do unstable_cache por exceção (não é guardado). */
class GrandeDemais extends Error {
  constructor(readonly linhas: Linhas) { super('resultado grande demais para o cache'); }
}

/** Token e identidade da requisição atual; null quando não dá para usar o cache com segurança. */
async function acesso(): Promise<{ token: string; identidade: string } | null> {
  const ctx = await getCurrentUser();
  if (!ctx?.profile?.role) return null;
  const [{ permissoes, erro }, supabase] = await Promise.all([getPermissoesComErro(), createClient()]);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const identidade = decidirCache({
    userId: ctx.user.id, role: ctx.profile.role, canais: ctx.profile.channels,
    permissoes, erroPermissoes: erro, token,
  });
  return identidade && token ? { token, identidade } : null;
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
  if (!a) return consultar(await createClient()); // sem perfil/sessão/permissões: como antes, sem cache

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
      const linhas = await consultar(cliente);
      if (Buffer.byteLength(JSON.stringify(linhas), 'utf8') > LIMITE_BYTES_CACHE) throw new GrandeDemais(linhas);
      return linhas;
    },
    [chaveCache(fn, args, a.identidade, new Date())],
    { revalidate: CACHE_SEGUNDOS, tags: [TAG_PAINEL] },
  );
  try {
    const linhas = await cacheado();
    if (!doBanco) console.log(`[tempo] ${fn} cache ${Math.round(performance.now() - inicio)}ms`);
    return linhas;
  } catch (e) {
    if (e instanceof GrandeDemais) {
      console.log(`[tempo] ${fn} grande demais para o cache`);
      return e.linhas;
    }
    throw e;
  }
}
