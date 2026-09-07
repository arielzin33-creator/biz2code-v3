

import { pool } from './pool';


export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}


export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}


export async function transaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scoped = async <R>(sql: string, params: unknown[] = []): Promise<R[]> =>
      (await client.query(sql, params)).rows as R[];
    const out = await fn(scoped as typeof query);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
