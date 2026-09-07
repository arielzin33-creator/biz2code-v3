

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const done = new Set(
      (await client.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows
        .map((r) => r.filename),
    );

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    if (!files.length) throw new Error(`No .sql files found in ${MIGRATIONS_DIR}`);

    let applied = 0;
    for (const file of files) {
      if (done.has(file)) {
        console.log(`  skip   ${file}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  apply  ${file}`);
        applied++;
      } catch (e) {
        await client.query('ROLLBACK');

        throw new Error(`${file} failed and was rolled back — ${(e as Error).message}`, { cause: e });
      }
    }

    console.log(applied ? `\n${applied} migration(s) applied.` : '\nSchema already up to date.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e: Error) => {
  console.error(`\nMigration failed: ${e.message}`);
  process.exit(1);
});
