import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';

export type { Pool, PoolConnection, RowDataPacket };
export type Db = Pool | PoolConnection;

export function createPool(url: string): Pool {
  return mysql.createPool({
    uri: url,
    connectionLimit: 10,
    // DATE/DATETIME come back as strings so calendar dates never shift by timezone.
    dateStrings: true,
    timezone: 'Z',
    supportBigNumbers: true,
  });
}
const commitHooks = new WeakMap<object, (() => void)[]>();
/**
 * Run `fn` once the surrounding transaction has committed (dropped on rollback).
 * Outside withTransaction (a pool, autocommit) it runs immediately.
 */
export function afterCommit(db: Db, fn: () => void) {
  const hooks = commitHooks.get(db);
  if (hooks) hooks.push(fn);
  else fn();
}
export async function withTransaction<T>(pool: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  const hooks: (() => void)[] = [];
  commitHooks.set(conn, hooks);
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    commitHooks.delete(conn);
    for (const hook of hooks) {
      try {
        hook();
      } catch {
        // A failing side effect must not turn a committed transaction into an error.
      }
    }
    return result;
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    commitHooks.delete(conn);
    conn.release();
  }
}
export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await db.query<RowDataPacket[]>(sql, params);
  return result as T[];
}
export async function exec(db: Db, sql: string, params: unknown[] = []) {
  const [result] = await db.query<mysql.ResultSetHeader>(sql, params);
  return result;
}
export const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ER_DUP_ENTRY';

/** Tables every event-driven service needs. */
export const outboxMigration = `CREATE TABLE IF NOT EXISTS outbox (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id CHAR(36) NOT NULL UNIQUE,
  event_type VARCHAR(64) NOT NULL,
  body JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at DATETIME(3) NULL,
  attempts INT NOT NULL DEFAULT 0,
  KEY idx_outbox_pending (published_at, id)
)`;
export const inboxMigration = `CREATE TABLE IF NOT EXISTS processed_events (
  event_id CHAR(36) PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
)`;

/**
 * Ordered, append-only migrations. Each entry runs once; a named lock keeps
 * concurrent replicas from applying the same migration twice.
 */
export async function migrate(pool: Pool, migrations: { name: string; sql: string; params?: unknown[] }[]) {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(128) PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    )`);
    const [[lock]] = await conn.query<RowDataPacket[]>(`SELECT GET_LOCK('schema_migrations', 30) AS ok`);
    if (lock.ok !== 1) throw new Error('Could not acquire migration lock');
    try {
      const applied = new Set(
        (await rows<{ name: string }>(conn, 'SELECT name FROM schema_migrations')).map((r) => r.name),
      );
      for (const m of migrations) {
        if (applied.has(m.name)) continue;
        await conn.query(m.sql, m.params ?? []);
        await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [m.name]);
      }
    } finally {
      await conn.query(`SELECT RELEASE_LOCK('schema_migrations')`);
    }
  } finally {
    conn.release();
  }
}
/** Retry the first DB contact so services can start before MySQL is ready. */
export async function waitForDb(pool: Pool, attempts = 30, delayMs = 1000) {
  for (let i = 1; ; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (i >= attempts) throw error;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Projection upsert that only applies newer versions. `values` must contain
 * the key column and `version`; older or duplicate versions leave the row as is.
 */
export async function upsertIfNewer(db: Db, table: string, key: string, values: Record<string, unknown>) {
  const cols = Object.keys(values);
  const assignments = cols
    .filter((c) => c !== key && c !== 'version')
    .map((c) => `${c} = IF(new.version > ${table}.version, new.${c}, ${table}.${c})`);
  // `version` is assigned last: MySQL evaluates assignments left to right.
  assignments.push(`version = GREATEST(${table}.version, new.version)`);
  await exec(
    db,
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (?) AS new ON DUPLICATE KEY UPDATE ${assignments.join(', ')}`,
    [cols.map((c) => values[c])],
  );
}
