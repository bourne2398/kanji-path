import { getDb } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    return res.status(200).json({
      ok: true,
      db: rows[0]?.ok === 1,
      vocabulary_entries: vocabCount,
      users: userCount,
    });
  } catch (err) {
    console.error('HEALTH ERROR:', err);
    return res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}
