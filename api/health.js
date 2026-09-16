import { getDb, isDbConfigured } from '../lib/db.js';

/**
 * GET /api/health
 * Diagnostic endpoint — always returns JSON.
 * Reports env status, DB connectivity, and table counts.
 */
export default async function handler(req, res) {
  // CORS (same-origin usually, but useful for debugging)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const result = {
    ok: false,
    timestamp: new Date().toISOString(),
    env: {
      DATABASE_URL: isDbConfigured(),
      JWT_SECRET: Boolean(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16),
      NODE_ENV: process.env.NODE_ENV || null,
      VERCEL: Boolean(process.env.VERCEL),
    },
    db: false,
    vocabulary_entries: null,
    users: null,
    error: null,
  };

  if (!isDbConfigured()) {
    result.error = 'DATABASE_URL is not set in Vercel environment variables.';
    return res.status(200).json(result);
  }

  try {
    const sql = getDb();
    const rows = await sql`SELECT 1 AS ok`;
    result.db = rows[0]?.ok === 1;

    try {
      const v = await sql`SELECT COUNT(*)::int AS c FROM joyo_vocabulary`;
      result.vocabulary_entries = v[0]?.c ?? 0;
    } catch (e) {
      result.vocabulary_entries = null;
      result.error = (result.error ? result.error + ' | ' : '') + 'joyo_vocabulary: ' + (e.message || String(e));
    }

    try {
      const u = await sql`SELECT COUNT(*)::int AS c FROM users`;
      result.users = u[0]?.c ?? 0;
    } catch (e) {
      result.users = null;
      result.error = (result.error ? result.error + ' | ' : '') + 'users: ' + (e.message || String(e));
    }

    result.ok = result.db === true;
    return res.status(200).json(result);
  } catch (err) {
    console.error('HEALTH ERROR:', err);
    result.error = String(err.message || err);
    return res.status(200).json(result);
  }
}
