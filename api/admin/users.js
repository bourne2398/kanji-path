import { getDb } from '../../lib/db.js';
import { getSessionUser, hashPassword, json } from '../../lib/auth.js';


async function requireAdmin(req) {
  const user = await getSessionUser(req);
  if (!user || user.role !== 'admin') {
    return null;
  }
  return user;
}

export default async function handler(req, res) {
  // Vercel Node.js runtime style
  const request =
    req instanceof Request
      ? req
      : new Request(`https://local${req.url}`, {
          method: req.method,
          headers: req.headers,
          body: ['POST', 'PUT', 'PATCH'].includes(req.method)
            ? JSON.stringify(req.body)
            : undefined,
        });

  const admin = await requireAdmin(request);
  if (!admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const sql = getDb();

  if (req.method === 'GET') {
    try {
      const users = await sql`
        SELECT id, email, name, role, created_at, last_login_at
        FROM users
        ORDER BY id ASC
      `;
      return res.status(200).json({ users });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = body.name ? String(body.name).trim() : null;
      const role = body.role === 'admin' ? 'admin' : 'student';

      if (!email || !password || password.length < 8) {
        return res.status(400).json({ error: 'Email and password (min 8 chars) required' });
      }

      const password_hash = await hashPassword(password);
      const rows = await sql`
        INSERT INTO users (email, password_hash, name, role)
        VALUES (${email}, ${password_hash}, ${name}, ${role})
        RETURNING id, email, name, role, created_at
      `;
      return res.status(201).json({ user: rows[0] });
    } catch (err) {
      if (String(err.message || '').includes('unique') || err.code === '23505') {
        return res.status(409).json({ error: 'Email already registered' });
      }
      console.error(err);
      return res.status(500).json({ error: 'Failed to create user' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
