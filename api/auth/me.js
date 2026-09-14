import { getSessionUser } from '../../lib/auth.js';

export const config = { runtime: 'nodejs20.x' };

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  try {
    const user = await getSessionUser(req);
    res.statusCode = 200;
    return res.end(JSON.stringify({ user }));
  } catch (err) {
    console.error('me error:', err);
    res.statusCode = 200;
    return res.end(JSON.stringify({ user: null }));
  }
}
