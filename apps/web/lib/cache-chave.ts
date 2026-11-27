// Chave do cache das consultas do painel (funções analytics.dash_* e analytics.ads_*). Sem dependência do Next,
// para os testes rodarem com node --test.
//
// O que o banco devolve para um usuário nessas funções depende SÓ de:
//   - core.has_perm(p): role_permissions do PERFIL (core.my_role) -> perfil + conjunto de permissões do perfil;
//   - core.can_see_channel / core.my_channels: canais do perfil (core.user_profiles.channels);
//   - a data de hoje em Brasília (dash_metas, frete_estimado do ML da 0036, ads_orcamento da 0019 usam now()).
// (Conferido nas migrations: nenhuma dessas funções usa auth.uid() direto nem bitrix_user_id; o CRM, que usa,
// fica fora do cache.) Por isso a chave = função + argumentos + perfil + canais + permissões + data de Brasília
// + janela de 10 minutos. As permissões entram para que uma mudança em Administração > Permissões nunca sirva o
// resultado antigo. O token de acesso NUNCA entra na chave.
//
// Janela de 10 minutos: o unstable_cache do Next devolve uma entrada vencida e só atualiza em segundo plano
// (stale-while-revalidate), o que deixaria o primeiro acesso depois de um tempo parado ver dados de horas atrás.
// Com a janela (Math.floor(agora / 10 min)) na chave, cada janela de relógio (hh:00, hh:10, ...) tem entradas
// próprias: um resultado nunca é servido depois do fim da janela em que foi calculado (no máximo 10 minutos
// depois de calculado; entrada de outra janela nunca é reaproveitada).

/** Janela e validade do cache em segundos: um resultado vale só até o fim da janela de 10 minutos em que foi
 *  calculado (o dono aceitou até 10 minutos de atraso; os dados mudam nas sincronizações). */
export const CACHE_SEGUNDOS = 600;
/** Tag de todas as consultas em cache do painel (as telas de edição limpam com revalidateTag). */
export const TAG_PAINEL = 'painel';
/** Resultado maior que isto (JSON, bytes) não vai para o cache (limite do Next: 2 MB por item). */
export const LIMITE_BYTES_CACHE = 1_900_000;

/** Identidade de acesso (perfil + canais + permissões), independente da ordem. Sem perfil: null (não usa cache). */
export function identidadeCache(role: string | null | undefined, canais: readonly string[] | null | undefined,
  permissoes: Iterable<string> | null | undefined): string | null {
  if (!role) return null;
  const ord = (xs: Iterable<string> | null | undefined) => [...new Set(xs ?? [])].sort();
  return JSON.stringify({ perfil: role, canais: ord(canais), permissoes: ord(permissoes) });
}

/** Usuário dono do token (campo sub do JWT), sem validar a assinatura (só para conferir a sessão). */
export function donoDoToken(token: string | null | undefined): string | null {
  try {
    const sub = JSON.parse(Buffer.from((token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8'))?.sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

export interface EntradaDecisao {
  /** Usuário validado por auth.getUser() (null = sem login). */
  userId: string | null | undefined;
  role: string | null | undefined;
  canais: readonly string[] | null | undefined;
  /** Permissões do perfil; `erroPermissoes` = a consulta a role_permissions falhou. */
  permissoes: Iterable<string> | null | undefined;
  erroPermissoes: boolean;
  /** Token de acesso da sessão (cookies). */
  token: string | null | undefined;
}

/**
 * Decide se a consulta pode usar o cache: devolve a identidade de acesso, ou null para consultar o banco
 * direto (sem login, sem perfil, erro ao ler as permissões, sem token ou token de outro usuário).
 */
export function decidirCache(e: EntradaDecisao): string | null {
  if (!e.userId || !e.role || e.erroPermissoes || !e.token) return null;
  if (donoDoToken(e.token) !== e.userId) return null;
  return identidadeCache(e.role, e.canais, e.permissoes);
}

/** Data (YYYY-MM-DD) de um instante em Brasília. */
export function dataBrasilia(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** Janela de 10 minutos do relógio (número da janela desde 1970). */
export function janelaCache(agora: Date): number {
  return Math.floor(agora.getTime() / (CACHE_SEGUNDOS * 1000));
}

/** JSON com as chaves em ordem (o mesmo argumento em outra ordem dá a mesma chave). */
function jsonOrdenado(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonOrdenado).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${jsonOrdenado(o[k])}`).join(',')}}`;
}

/** Chave = nome da função + argumentos + identidade de acesso + data de Brasília + janela de 10 minutos. */
export function chaveCache(fn: string, args: Record<string, unknown>, identidade: string, agora: Date): string {
  return `rpc:${fn}:${jsonOrdenado(args)}:${identidade}:${dataBrasilia(agora)}:${janelaCache(agora)}`;
}
