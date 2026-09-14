import { neon } from '@neondatabase/serverless';

let sql = null;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add your Neon connection string in Vercel env vars.');
  }
  if (!sql) {
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

/** Run a one-off query with the serverless driver */
export async function query(strings, ...values) {
  const db = getDb();
  return db(strings, ...values);
}
