import { getDb } from '../../lib/db.js';
import { verifyPassword, createToken, sessionCookie } from '../../lib/auth.js';

export const config = { runtime: 'nodejs20.x' };

function send(res, data, status = 200, headers = {}) {
  res.statusCode = status;
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return send(res, { error: 'Method not allowed' }, 405);
  }

  const body = readBody(req);
  if (!body) return send(res, { error: 'Invalid JSON body' }, 400);

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) {
    return send(res, { error: 'Email and password are required' }, 400);
  }

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, email, password_hash, name, role
      FROM users
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    const user = rows[0];
    if (!user) return send(res, { error: 'Invalid email or password' }, 401);

    if (!user.password_hash) {
      console.error('login error: user has no password_hash');
      return send(res, { error: 'Account is not configured correctly. Contact the administrator.' }, 500);
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return send(res, { error: 'Invalid email or password' }, 401);

    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`;
    const token = await createToken(user);

    return send(res, {
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    }, 200, { 'Set-Cookie': sessionCookie(token) });
  } catch (err) {
    console.error('login error:', err);
    const message = String(err?.message || err || 'Unknown server error');

    if (/DATABASE_URL|database is not configured/i.test(message)) {
      return send(res, { error: 'Database is not configured. Check DATABASE_URL in Vercel and redeploy.' }, 500);
    }
    if (/relation .*users.*does not exist|users.*does not exist/i.test(message)) {
      return send(res, { error: 'The users table is missing in Neon. Run the database schema/seed script once.' }, 500);
    }
    if (/column .*password_hash.*does not exist|column .*role.*does not exist/i.test(message)) {
      return send(res, { error: 'The users table has an outdated schema. Run the latest schema.sql in Neon.' }, 500);
    }
    return send(res, { error: 'Server error during login. Check Vercel Function Logs.' }, 500);
  }
}
