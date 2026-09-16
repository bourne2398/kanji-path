import { neon } from '@neondatabase/serverless';

let sql = null;

/**
 * Returns a Neon serverless SQL client.
 * Throws a clear error if DATABASE_URL is missing.
 */
export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Add your Neon connection string in Vercel → Project → Settings → Environment Variables.'
    );
  }
  if (!sql) {
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

/**
 * Safe check whether the database is configured (does not throw).
 */
export function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.length > 10);
}

/**
 * Run a one-off tagged template query.
 */
export async function query(strings, ...values) {
  const db = getDb();
  return db(strings, ...values);
}
