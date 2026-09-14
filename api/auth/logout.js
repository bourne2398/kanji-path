import { clearSessionCookie } from '../../lib/auth.js';

export const config = { runtime: 'nodejs20.x' };

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Set-Cookie', clearSessionCookie());
  return res.end(JSON.stringify({ ok: true }));
}
