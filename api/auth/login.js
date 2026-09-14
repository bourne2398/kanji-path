import { getDb } from '../../lib/db.js';
import { verifyPassword, createToken, sessionCookie } from '../../lib/auth.js';

export const config = {
  runtime: 'nodejs18.x'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    const normalizedEmail = String(email)
      .trim()
      .toLowerCase();

    const sql = getDb();

    const users = await sql`
      SELECT
        id,
        email,
        password_hash,
        name,
        role
      FROM users
      WHERE LOWER(email) = ${normalizedEmail}
      LIMIT 1
    `;

    const user = users[0];

    if (!user) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    const validPassword = await verifyPassword(
      String(password),
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        error: 'Invalid email or password'
      });
    }

    await sql`
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = ${user.id}
    `;

    const token = await createToken(user);

    res.setHeader(
      'Set-Cookie',
      sessionCookie(token)
    );

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    console.error('LOGIN ERROR:', error);

    return res.status(500).json({
      error: 'Login server error',
      details: error?.message || String(error)
    });
  }
}
