/**
 * Create schema + bootstrap admin user on Neon.
 *
 * Usage:
 *   export DATABASE_URL="postgresql://..."
 *   export ADMIN_EMAIL="admin@example.com"
 *   export ADMIN_PASSWORD="YourStrongPassword"
 *   export ADMIN_NAME="Admin"
 *   node scripts/seed-admin.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL to your Neon connection string.');
  process.exit(1);
}

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@kanjipath.local').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMeStrongPassword123!';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Admin';

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected to Neon.');

  const schemaPath = path.join(__dirname, '..', 'lib', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await client.query(schema);
  console.log('Schema applied.');

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const result = await client.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           role = 'admin'
     RETURNING id, email, role`,
    [ADMIN_EMAIL, hash, ADMIN_NAME]
  );

  const user = result.rows[0];
  console.log('Admin user ready:');
  console.log('  id:   ', user.id);
  console.log('  email:', user.email);
  console.log('  role: ', user.role);
  console.log('  password: (the value of ADMIN_PASSWORD)');
  console.log('');
  console.log('Login at /admin.html after deploy, or via POST /api/auth/login');

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
