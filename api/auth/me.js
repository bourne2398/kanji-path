import { getSessionUser, json } from '../../lib/auth.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }
  const user = await getSessionUser(req);
  if (!user) {
    return json({ user: null }, 200);
  }
  return json({ user }, 200);
}
