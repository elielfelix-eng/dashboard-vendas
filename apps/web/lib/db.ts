import postgres from 'postgres';

/**
 * Conexão direta com o banco — SOMENTE para rotas de servidor que precisam
 * mexer em tokens (Vault). Nunca importar em componentes de cliente.
 * Ignora o RLS: toda rota que usa isto precisa checar o perfil antes.
 */
const g = globalThis as unknown as { __sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!g.__sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não configurado');
    g.__sql = postgres(url, { ssl: 'require', prepare: false, max: 2 });
  }
  return g.__sql;
}
