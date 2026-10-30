import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { config } from './config';

/** Forward-only SQL migrations tracked in schema_migrations. Works from src/ and dist/. */
export async function migrate(): Promise<string[]> {
  const dir = path.resolve(__dirname, '..', 'migrations');
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  const applied: string[] = [];
  try {
    await conn.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    const [rows] = await conn.query('SELECT name FROM schema_migrations');
    const done = new Set((rows as any[]).map((r) => r.name));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await conn.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      applied.push(file);
      console.log(`applied ${file}`);
    }
    if (!applied.length) console.log('database is up to date');
  } finally {
    await conn.end();
  }
  return applied;
}

if (require.main === module) {
  migrate().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
