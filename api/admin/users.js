import { getDb } from '../../lib/db.js';
import { getSessionUser, hashPassword } from '../../lib/auth.js';

export const config = { runtime: 'nodejs20.x' };

async function requireAdmin(req) {
  const user = await getSessionUser(req);
  return user && user.role === 'admin' ? user : null;
}

function send(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) return send(res, { error: 'Admin access required' }, 403);

    const sql = getDb();

    if (req.method === 'GET') {
      const users = await sql`
        SELECT id, email, name, role, created_at, last_login_at
        FROM users ORDER BY id ASC
      `;
      return send(res, { users });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = body.name ? String(body.name).trim() : null;
      const role = body.role === 'admin' ? 'admin' : 'student';

      if (!email || !password || password.length < 8) {
        return send(res, { error: 'Email and password (min 8 chars) required' }, 400);
      }

      const password_hash = await hashPassword(password);
      const rows = await sql`
        INSERT INTO users (email, password_hash, name, role)
        VALUES (${email}, ${password_hash}, ${name}, ${role})
        RETURNING id, email, name, role, created_at
      `;
      return send(res, { user: rows[0] }, 201);
    }

    return send(res, { error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('admin users error:', err);
    if (err?.code === '23505' || /unique/i.test(String(err?.message || ''))) {
      return send(res, { error: 'Email already registered' }, 409);
    }
    return send(res, { error: 'Server error' }, 500);
  }
}
