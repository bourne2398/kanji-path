import { getDb } from '../lib/db.js';
import { json } from '../lib/auth.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const kanji = (url.searchParams.get('kanji') || '').trim();
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = page * limit;

  try {
    const sql = getDb();
    let rows;
    let total;

    if (kanji) {
      rows = await sql`
        SELECT id, word, reading, meaning, kanji
        FROM joyo_vocabulary
        WHERE kanji LIKE ${'%' + kanji + '%'} OR word LIKE ${'%' + kanji + '%'}
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countRows = await sql`
        SELECT COUNT(*)::int AS c FROM joyo_vocabulary
        WHERE kanji LIKE ${'%' + kanji + '%'} OR word LIKE ${'%' + kanji + '%'}
      `;
      total = countRows[0]?.c ?? rows.length;
    } else if (q) {
      const like = '%' + q + '%';
      rows = await sql`
        SELECT id, word, reading, meaning, kanji
        FROM joyo_vocabulary
        WHERE word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like}
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countRows = await sql`
        SELECT COUNT(*)::int AS c FROM joyo_vocabulary
        WHERE word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like}
      `;
      total = countRows[0]?.c ?? rows.length;
    } else {
      rows = await sql`
        SELECT id, word, reading, meaning, kanji
        FROM joyo_vocabulary
        ORDER BY id
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countRows = await sql`SELECT COUNT(*)::int AS c FROM joyo_vocabulary`;
      total = countRows[0]?.c ?? 0;
    }

    return json({
      items: rows,
      page,
      limit,
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (err) {
    console.error('vocab error', err);
    return json({ error: 'Failed to query vocabulary. Has the SQL been loaded?' }, 500);
  }
}
