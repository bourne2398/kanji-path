import { getDb } from '../lib/db.js';
import { getSessionUser } from '../lib/auth.js';

/**
 * Unified progress API (Hobby plan – fewer serverless functions)
 *
 * GET  /api/progress?type=path|practice
 * POST /api/progress?type=path|practice
 *   body: single entry or { items: [...] }
 *
 * Also accepts POST body.type = 'path' | 'practice'
 */
export default async function handler(req, res) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const url = new URL(req.url || '/', 'https://kanji-path.local');
    let type = (url.searchParams.get('type') || '').toLowerCase();

    const body =
      req.method === 'GET'
        ? null
        : typeof req.body === 'string'
          ? JSON.parse(req.body || '{}')
          : req.body || {};

    if (!type && body?.type) type = String(body.type).toLowerCase();
    if (!type) type = 'path';

    if (type === 'path') return handlePath(req, res, user, body);
    if (type === 'practice') return handlePractice(req, res, user, body);

    return res.status(400).json({ error: 'type must be path or practice' });
  } catch (err) {
    console.error('PROGRESS ERROR:', err);
    return res.status(500).json({ error: 'Server error', detail: String(err.message || err) });
  }
}

async function handlePath(req, res, user, body) {
  const sql = getDb();

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT kanji, jlpt, stage, ease, interval,
             due_at, reps, lapses, last_ms, updated_at
      FROM path_progress
      WHERE user_id = ${user.id}
      ORDER BY updated_at DESC
    `;
    const items = rows.map((r) => ({
      kanji: r.kanji,
      jlpt: r.jlpt,
      stage: r.stage,
      ease: r.ease,
      interval: r.interval,
      due: r.due_at ? new Date(r.due_at).getTime() : null,
      due_at: r.due_at,
      reps: r.reps,
      lapses: r.lapses,
      last: r.last_ms,
      updated_at: r.updated_at,
    }));
    return res.status(200).json({ items, count: items.length });
  }

  if (req.method === 'POST') {
    const list = Array.isArray(body?.items)
      ? body.items
      : body?.kanji
        ? [body]
        : null;
    if (!list?.length) return res.status(400).json({ error: 'kanji or items[] required' });

    const saved = [];
    for (const entry of list) {
      const kanji = String(entry.kanji || '').trim();
      if (!kanji) continue;
      const stage = Number(entry.stage) || 0;
      const ease = entry.ease != null ? Number(entry.ease) : 2.5;
      const interval = Number(entry.interval) || 0;
      const reps = Number(entry.reps) || 0;
      const lapses = Number(entry.lapses) || 0;
      const lastMs =
        entry.last != null
          ? Number(entry.last)
          : entry.last_ms != null
            ? Number(entry.last_ms)
            : Date.now();
      let dueAt = null;
      if (entry.due_at) dueAt = new Date(entry.due_at);
      else if (entry.due != null) dueAt = new Date(Number(entry.due));
      const jlpt =
        entry.jlpt && ['N5', 'N4', 'N3', 'N2', 'N1'].includes(entry.jlpt)
          ? entry.jlpt
          : null;

      const rows = await sql`
        INSERT INTO path_progress (
          user_id, kanji, jlpt, stage, ease, interval, due_at, reps, lapses, last_ms, updated_at
        ) VALUES (
          ${user.id}, ${kanji}, ${jlpt}, ${stage}, ${ease}, ${interval},
          ${dueAt ? dueAt.toISOString() : null}, ${reps}, ${lapses}, ${lastMs}, NOW()
        )
        ON CONFLICT (user_id, kanji) DO UPDATE SET
          jlpt = COALESCE(EXCLUDED.jlpt, path_progress.jlpt),
          stage = EXCLUDED.stage,
          ease = EXCLUDED.ease,
          interval = EXCLUDED.interval,
          due_at = EXCLUDED.due_at,
          reps = EXCLUDED.reps,
          lapses = EXCLUDED.lapses,
          last_ms = EXCLUDED.last_ms,
          updated_at = NOW()
        RETURNING kanji, jlpt, stage, ease, interval, due_at, reps, lapses, last_ms
      `;
      if (rows[0]) saved.push(rows[0]);
    }

    const countRows = await sql`
      SELECT COUNT(*)::int AS c FROM path_progress
      WHERE user_id = ${user.id} AND stage > 0
    `;
    const kanjiLearned = countRows[0]?.c ?? 0;
    await sql`
      INSERT INTO user_progress (user_id, kanji_learned, updated_at)
      VALUES (${user.id}, ${kanjiLearned}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        kanji_learned = ${kanjiLearned},
        updated_at = NOW()
    `;
    return res.status(200).json({ ok: true, saved, kanji_learned: kanjiLearned });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handlePractice(req, res, user, body) {
  const sql = getDb();

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT kanji, write_count, set_id, updated_at
      FROM kanji_progress WHERE user_id = ${user.id}
    `;
    return res.status(200).json({ items: rows });
  }

  if (req.method === 'POST') {
    const list = Array.isArray(body?.items) ? body.items : body?.kanji ? [body] : null;
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
}
