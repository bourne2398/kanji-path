import { getDb } from '../lib/db.js';
import { json } from '../lib/auth.js';

export const config = { runtime: 'edge' };

export default async function handler() {
  try {
    const sql = getDb();
    const rows = await sql`SELECT 1 AS ok`;
    let vocabCount = 0;
    let userCount = 0;
    try {
      const v = await sql`SELECT COUNT(*)::int AS c FROM joyo_vocabulary`;
      vocabCount = v[0]?.c ?? 0;
    } catch (_) {}
    try {
      const u = await sql`SELECT COUNT(*)::int AS c FROM users`;
      userCount = u[0]?.c ?? 0;
    } catch (_) {}
    return json({
      ok: true,
      db: rows[0]?.ok === 1,
      vocabulary_entries: vocabCount,
      users: userCount,
    });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) }, 500);
  }
}
