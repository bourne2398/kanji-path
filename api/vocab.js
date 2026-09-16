import { getDb } from '../lib/db.js';

/**
 * GET /api/vocab
 * Query params:
 *   q       – search text
 *   kanji   – filter by kanji contained in word
 *   everyday=0 to include non-everyday entries
 *   page    – 0-based page
 *   limit   – 1–200 (default 50)
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=60');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = new URL(req.url || '/', 'https://kanji-path.local');
  const q = (url.searchParams.get('q') || '').trim();
  const everydayParam = url.searchParams.get('everyday');
  const everydayOnly = everydayParam !== '0';
  const kanji = (url.searchParams.get('kanji') || '').trim();
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = page * limit;

  try {
    const sql = getDb();
    let rows;
    let total;

    // everydayOnly=true → only everyday = TRUE
    // everydayOnly=false → all rows
    if (kanji) {
      const pattern = '%' + kanji + '%';
      if (everydayOnly) {
        rows = await sql`
          SELECT id, word, reading, meaning, kanji, everyday
          FROM joyo_vocabulary
          WHERE (kanji LIKE ${pattern} OR word LIKE ${pattern}) AND everyday = TRUE
          ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
        const countRows = await sql`
          SELECT COUNT(*)::int AS c FROM joyo_vocabulary
          WHERE (kanji LIKE ${pattern} OR word LIKE ${pattern}) AND everyday = TRUE`;
        total = countRows[0]?.c ?? rows.length;
      } else {
        rows = await sql`
          SELECT id, word, reading, meaning, kanji, everyday
          FROM joyo_vocabulary
          WHERE kanji LIKE ${pattern} OR word LIKE ${pattern}
          ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
        const countRows = await sql`
          SELECT COUNT(*)::int AS c FROM joyo_vocabulary
          WHERE kanji LIKE ${pattern} OR word LIKE ${pattern}`;
        total = countRows[0]?.c ?? rows.length;
      }
    } else if (q) {
      const like = '%' + q + '%';
      if (everydayOnly) {
        rows = await sql`
          SELECT id, word, reading, meaning, kanji, everyday
          FROM joyo_vocabulary
          WHERE (word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like})
            AND everyday = TRUE
          ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
        const countRows = await sql`
          SELECT COUNT(*)::int AS c FROM joyo_vocabulary
          WHERE (word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like})
            AND everyday = TRUE`;
        total = countRows[0]?.c ?? rows.length;
      } else {
        rows = await sql`
          SELECT id, word, reading, meaning, kanji, everyday
          FROM joyo_vocabulary
          WHERE word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like}
          ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
        const countRows = await sql`
          SELECT COUNT(*)::int AS c FROM joyo_vocabulary
          WHERE word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like}`;
        total = countRows[0]?.c ?? rows.length;
      }
    } else {
      if (everydayOnly) {
        rows = await sql`
          SELECT id, word, reading, meaning, kanji, everyday
          FROM joyo_vocabulary
          WHERE everyday = TRUE
          ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
        const countRows = await sql`
          SELECT COUNT(*)::int AS c FROM joyo_vocabulary WHERE everyday = TRUE`;
        total = countRows[0]?.c ?? 0;
      } else {
        rows = await sql`
          SELECT id, word, reading, meaning, kanji, everyday
          FROM joyo_vocabulary
          ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
        const countRows = await sql`
          SELECT COUNT(*)::int AS c FROM joyo_vocabulary`;
        total = countRows[0]?.c ?? 0;
      }
    }

    return res.status(200).json({
      items: rows,
      page,
      limit,
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (err) {
    console.error('VOCAB ERROR:', err);
    return res.status(500).json({
      error: 'Failed to query vocabulary. Has the schema and seed been applied?',
      detail: String(err.message || err),
    });
  }
}
