// D1-compatible adapter: the same domain engine runs on Vercel, Sites and locally.
export function adaptClient(client) {
  function prepare(sql) {
    return { bind(...args) {
      const statement = { sql, args };
      return {
        statement,
        async all() { const r = await client.execute(statement); return { results: r.rows.map(row => ({ ...row })) }; },
        async first() { const r = await client.execute(statement); return r.rows[0] ? { ...r.rows[0] } : null; },
        async run() { const r = await client.execute(statement); return { meta: { changes: r.rowsAffected } }; }
      };
    } };
  }
  return { prepare, async batch(items) { const r = await client.batch(items.map(x => x.statement), 'write'); return r.map(x => ({ meta: { changes: x.rowsAffected } })); }, client };
}
let database;
export async function getDatabase() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('CONFIG_MISSING');
  if (!database) {
    const { createClient } = await import('@libsql/client/web');
    database = adaptClient(createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' }));
  }
  return database;
}
