import { getDb } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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

    const filter = !everydayOnly;
    if (kanji) {
      rows = await sql`
        SELECT id, word, reading, meaning, kanji, everyday
        FROM joyo_vocabulary
        WHERE (kanji LIKE ${'%' + kanji + '%'} OR word LIKE ${'%' + kanji + '%'}) AND (${filter} OR everyday = TRUE)
        ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
      const countRows = await sql`SELECT COUNT(*)::int AS c FROM joyo_vocabulary WHERE (kanji LIKE ${'%' + kanji + '%'} OR word LIKE ${'%' + kanji + '%'}) AND (${filter} OR everyday = TRUE)`;
      total = countRows[0]?.c ?? rows.length;
    } else if (q) {
      const like = '%' + q + '%';
      rows = await sql`
        SELECT id, word, reading, meaning, kanji, everyday
        FROM joyo_vocabulary
        WHERE (word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like}) AND (${filter} OR everyday = TRUE)
        ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
      const countRows = await sql`SELECT COUNT(*)::int AS c FROM joyo_vocabulary WHERE (word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like}) AND (${filter} OR everyday = TRUE)`;
      total = countRows[0]?.c ?? rows.length;
    } else {
      rows = await sql`SELECT id, word, reading, meaning, kanji, everyday FROM joyo_vocabulary WHERE 1=1 AND (${filter} OR everyday = TRUE) ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
      const countRows = await sql`SELECT COUNT(*)::int AS c FROM joyo_vocabulary WHERE 1=1 AND (${filter} OR everyday = TRUE)`;
      total = countRows[0]?.c ?? 0;
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
    return res.status(500).json({ error: 'Failed to query vocabulary. Has the SQL been loaded?' });
  }
}
