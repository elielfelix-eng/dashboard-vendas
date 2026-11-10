import postgres from 'postgres';

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ${name} não configurada`);
  return v;
}

export type Sql = postgres.Sql;

/** Conexão direta com o Postgres do Supabase (pooler, porta 6543). */
export function connect(): Sql {
  return postgres(requireEnv('DATABASE_URL'), {
    ssl: 'require',
    prepare: false, // obrigatório no pooler em modo "transaction"
    max: 3,
    onnotice: () => {},
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** INSERT ... ON CONFLICT DO UPDATE em lotes. Nomes de tabela/coluna vêm só do código. */
export async function upsert(sql: Sql, table: string, rows: Row[], conflict: string[], batch = 500) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const updates = cols
    .filter((c) => !conflict.includes(c))
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(', ');
  for (let i = 0; i < rows.length; i += batch) {
    const part = rows.slice(i, i + batch);
    await sql`
      insert into ${sql(table)} ${sql(part as Row[], cols)}
      on conflict (${sql(conflict)})
      do ${updates ? sql.unsafe(`update set ${updates}`) : sql.unsafe('nothing')}
    `;
  }
  return rows.length;
}
