import { getDb } from '../../lib/db.js';
import { getSessionUser } from '../../lib/auth.js';

/**
 * GET  /api/progress/practice → { items: [{ kanji, write_count, set_id }] }
 * POST /api/progress/practice → upsert write counts
 *   body: { kanji, write_count, set_id } or { items: [...] }
 */
export default async function handler(req, res) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const sql = getDb();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT kanji, write_count, set_id, updated_at
        FROM kanji_progress
        WHERE user_id = ${user.id}
      `;
      return res.status(200).json({ items: rows });
    }

    if (req.method === 'POST') {
      const body =
        typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const list = Array.isArray(body.items) ? body.items : body.kanji ? [body] : null;
      if (!list?.length) return res.status(400).json({ error: 'kanji or items[] required' });

      const saved = [];
      for (const entry of list) {
        const kanji = String(entry.kanji || '').trim();
        if (!kanji) continue;
        const writeCount = Math.max(0, Number(entry.write_count) || 0);
        const setId = entry.set_id != null ? Number(entry.set_id) : null;

        const rows = await sql`
          INSERT INTO kanji_progress (user_id, kanji, write_count, set_id, updated_at)
          VALUES (${user.id}, ${kanji}, ${writeCount}, ${setId}, NOW())
          ON CONFLICT (user_id, kanji) DO UPDATE SET
            write_count = GREATEST(kanji_progress.write_count, EXCLUDED.write_count),
            set_id = COALESCE(EXCLUDED.set_id, kanji_progress.set_id),
            updated_at = NOW()
          RETURNING kanji, write_count, set_id
        `;
        if (rows[0]) saved.push(rows[0]);
      }
      return res.status(200).json({ ok: true, saved });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('PRACTICE PROGRESS ERROR:', err);
    return res.status(500).json({ error: 'Server error', detail: String(err.message || err) });
  }
}
