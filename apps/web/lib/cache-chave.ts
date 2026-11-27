// Chave do cache das consultas do painel (funções analytics.dash_* e analytics.ads_*). Sem dependência do Next,
// para os testes rodarem com node --test.
//
// O que o banco devolve para um usuário nessas funções depende SÓ de:
//   - core.has_perm(p): role_permissions do PERFIL (core.my_role) -> perfil + conjunto de permissões do perfil;
//   - core.can_see_channel / core.my_channels: canais do perfil (core.user_profiles.channels).
// (Conferido nas migrations: nenhuma dessas funções usa auth.uid() direto nem bitrix_user_id; o CRM, que usa,
// fica fora do cache.) Por isso a identidade do cache = perfil + canais ordenados + permissões ordenadas.
// As permissões entram para que uma mudança em Administração > Permissões nunca sirva o resultado antigo.
// O token de acesso NUNCA entra na chave.

/** Tempo do cache em segundos (o dono aceitou até 10 minutos de atraso; os dados mudam nas sincronizações). */
export const CACHE_SEGUNDOS = 600;
/** Tag de todas as consultas em cache do painel (as telas de edição limpam com revalidateTag). */
export const TAG_PAINEL = 'painel';

/** Identidade de acesso (perfil + canais + permissões), independente da ordem. Sem perfil: null (não usa cache). */
export function identidadeCache(role: string | null | undefined, canais: readonly string[] | null | undefined,
  permissoes: Iterable<string> | null | undefined): string | null {
  if (!role) return null;
  const ord = (xs: Iterable<string> | null | undefined) => [...new Set(xs ?? [])].sort();
  return JSON.stringify({ perfil: role, canais: ord(canais), permissoes: ord(permissoes) });
}

/** JSON com as chaves em ordem (o mesmo argumento em outra ordem dá a mesma chave). */
function jsonOrdenado(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonOrdenado).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${jsonOrdenado(o[k])}`).join(',')}}`;
}

/** Chave = nome da função + argumentos + identidade de acesso. */
export function chaveCache(fn: string, args: Record<string, unknown>, identidade: string): string {
  return `rpc:${fn}:${jsonOrdenado(args)}:${identidade}`;
}
