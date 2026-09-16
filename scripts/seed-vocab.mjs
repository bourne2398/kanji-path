/**
 * Load the 40,000-entry Jōyō vocabulary SQL dump into Neon.
 *
 * Usage:
 *   export DATABASE_URL="postgresql://..."
 *   node scripts/seed-vocab.mjs
 *
 * The dump is large (~4 MB). This script streams it in chunks so it works
 * over typical Neon connection limits.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, 'joyo-vocabulary.sql');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL to your Neon connection string.');
  process.exit(1);
}

if (!fs.existsSync(SQL_PATH)) {
  console.error('Missing scripts/joyo-vocabulary.sql');
  process.exit(1);
}

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // Large multi-value INSERT statements
    statement_timeout: 300000,
  });
  await client.connect();
  console.log('Connected. Loading vocabulary from', SQL_PATH);

  // Ensure table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS joyo_vocabulary (
      id      INTEGER PRIMARY KEY,
      word    TEXT NOT NULL,
      reading TEXT,
      meaning TEXT,
      kanji   TEXT,
      everyday BOOLEAN NOT NULL DEFAULT TRUE
    );
    ALTER TABLE joyo_vocabulary ADD COLUMN IF NOT EXISTS everyday BOOLEAN NOT NULL DEFAULT TRUE;
    CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_word ON joyo_vocabulary(word);
    CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_kanji ON joyo_vocabulary(kanji);
  `);

  // Optional: clear previous data for a clean reload
  if (process.env.RESET_VOCAB === '1') {
    console.log('RESET_VOCAB=1 → truncating joyo_vocabulary…');
    await client.query('TRUNCATE joyo_vocabulary');
  }

  const stream = fs.createReadStream(SQL_PATH, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let buffer = '';
  let statements = 0;
  let rowsApprox = 0;

  async function flush() {
    const sql = buffer.trim();
    buffer = '';
    if (!sql) return;
    // Skip pure comments
    if (sql.startsWith('--') && !sql.includes('INSERT')) return;
    try {
      await client.query(sql);
      statements += 1;
      if (sql.includes('INSERT')) {
        const matches = sql.match(/\),\s*\(/g);
        rowsApprox += (matches ? matches.length + 1 : 1);
      }
      if (statements % 5 === 0) {
        process.stdout.write(`\r  statements: ${statements}  ~rows: ${rowsApprox.toLocaleString()}   `);
      }
    } catch (err) {
      // Ignore "already exists" noise for CREATE/INDEX
      if (String(err.message).includes('already exists')) return;
      console.error('\nFailed statement (first 200 chars):\n', sql.slice(0, 200));
      throw err;
    }
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    buffer += line + '\n';
    // Execute when we hit end of a statement
    if (trimmed.endsWith(';')) {
      await flush();
    }
  }
  await flush();

  await client.query(`ALTER TABLE joyo_vocabulary ADD COLUMN IF NOT EXISTS everyday BOOLEAN NOT NULL DEFAULT TRUE;
    UPDATE joyo_vocabulary SET everyday = CASE
      WHEN length(word) > 14 THEN FALSE
      WHEN meaning ~* '(physics|chemistry|biology|botany|zoology|anatomy|surgery|medical|medicine|legal|law|linguistics|military|weapon|finance|financial|stock market|economics|geology|astronomy|engineering|mathematics|computer science|software|programming|religion|buddh|shinto|historical|archaeology|political|politics|government|taxation|criminal|disease|pathology|psychiatry|pharmac|agriculture|technical|telecommunication|algorithm|database|game development|adult|porn|sexual)' THEN FALSE
      WHEN meaning ~* '(loan shark|point-blank|first graduates|research student|student movement|scholarship|terror|suicide|murder|protest|weapon)' THEN FALSE
      WHEN word ~ '[＠※○〇×\\[\\]（）(){}<>]' THEN FALSE
      ELSE TRUE END;`);

  const count = await client.query('SELECT COUNT(*)::int AS c FROM joyo_vocabulary');
  console.log(`\nDone. joyo_vocabulary has ${count.rows[0].c.toLocaleString()} rows.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

