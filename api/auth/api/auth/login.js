import { getDb } from '../../lib/db.js';
import {
  verifyPassword,
  createToken,
  sessionCookie,
  json,
} from '../../lib/auth.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email || !password) {
    return json({ error: 'Email and password are required' }, 400);
  }

  try {
    const sql = getDb();
    const rows = await sql`
      SELECT id, email, password_hash, name, role
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;
    const user = rows[0];
    if (!user) {
      return json({ error: 'Invalid email or password' }, 401);
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return json({ error: 'Invalid email or password' }, 401);
    }

    await sql`
      UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}
    `;

    const token = await createToken(user);
    return json(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
      200,
      { 'Set-Cookie': sessionCookie(token) }
    );
  } catch (err) {
    console.error('login error', err);
    return json({ error: 'Server error during login' }, 500);
  }
}
