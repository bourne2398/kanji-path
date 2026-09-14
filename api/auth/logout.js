import { clearSessionCookie, json } from '../../lib/auth.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }
  return json(
    { ok: true },
    200,
    { 'Set-Cookie': clearSessionCookie() }
  );
}
