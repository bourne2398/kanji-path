import { getDb } from '../../lib/db.js';
import { hashPassword, createToken, sessionCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Method not allowed'}); }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const name = String(body.name || '').trim().slice(0,100);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Enter a valid email address.'});
    if (password.length < 8) return res.status(400).json({error:'Password must be at least 8 characters.'});
    const sql = getDb();
    const exists = await sql`SELECT id FROM users WHERE LOWER(email)=${email} LIMIT 1`;
    if (exists[0]) return res.status(409).json({error:'An account with that email already exists.'});
    const passwordHash = await hashPassword(password);
    const rows = await sql`
      INSERT INTO users (email,password_hash,name,role) VALUES (${email},${passwordHash},${name || null},'student')
      RETURNING id,email,name,role
    `;
    const user = rows[0];
    const token = await createToken(user);
    res.setHeader('Set-Cookie', sessionCookie(token));
    return res.status(201).json({ok:true,user});
  } catch (err) { console.error('REGISTER ERROR:',err); return res.status(500).json({error:'Server error during registration'}); }
}
