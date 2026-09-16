export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = new URL(req.url || '/', 'https://kanji-path.local');
  const q = (url.searchParams.get('q') || '').trim();
  const everydayOnly = url.searchParams.get('everyday') !== '0';
  const requestedLevel = (url.searchParams.get('level') || 'ALL').toUpperCase();
  const levelOnly = /^N[1-5]$/.test(requestedLevel) ? requestedLevel : null;
  const kanji = (url.searchParams.get('kanji') || '').trim();
  const category = (url.searchParams.get('category') || '').trim();
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
  const offset = page * limit;

  try {
    const sql = getDb();
    const everydayClause = everydayOnly ? sql` AND everyday = TRUE` : sql``;
    const levelClause = levelOnly ? sql` AND jlpt_level = ${levelOnly}` : sql``;
    const categoryClause = category ? sql` AND category = ${category}` : sql``;
    let rows;
    let total;

    if (kanji) {
      rows = await sql`
        SELECT id, word, reading, meaning, kanji, everyday, jlpt_level, category
        FROM joyo_vocabulary
        WHERE (kanji LIKE ${'%' + kanji + '%'} OR word LIKE ${'%' + kanji + '%'})${everydayClause}${levelClause}${categoryClause}
        ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
      const countRows = await sql`
        SELECT COUNT(*)::int AS c FROM joyo_vocabulary
        WHERE (kanji LIKE ${'%' + kanji + '%'} OR word LIKE ${'%' + kanji + '%'})${everydayClause}${levelClause}${categoryClause}`;
      total = countRows[0]?.c ?? rows.length;
    } else if (q) {
      const like = '%' + q + '%';
      rows = await sql`
        SELECT id, word, reading, meaning, kanji, everyday, jlpt_level, category
        FROM joyo_vocabulary
        WHERE (word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like})${everydayClause}${levelClause}${categoryClause}
        ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
      const countRows = await sql`
        SELECT COUNT(*)::int AS c FROM joyo_vocabulary
        WHERE (word ILIKE ${like} OR reading ILIKE ${like} OR meaning ILIKE ${like})${everydayClause}${levelClause}${categoryClause}`;
      total = countRows[0]?.c ?? rows.length;
    } else {
      rows = await sql`
        SELECT id, word, reading, meaning, kanji, everyday, jlpt_level, category
        FROM joyo_vocabulary
        WHERE TRUE${everydayClause}${levelClause}${categoryClause}
        ORDER BY id LIMIT ${limit} OFFSET ${offset}`;
      const countRows = await sql`
        SELECT COUNT(*)::int AS c FROM joyo_vocabulary WHERE TRUE${everydayClause}${levelClause}${categoryClause}`;
      total = countRows[0]?.c ?? 0;
    }

    return res.status(200).json({ items: rows, page, limit, total, hasMore: offset + rows.length < total });
  } catch (err) {
    console.error('VOCAB ERROR:', err);
    return res.status(500).json({ error: 'Failed to query vocabulary. Has the SQL schema been loaded?' });
  }
}
