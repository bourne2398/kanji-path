import { getSessionUser } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getSessionUser(req);
    return res.status(200).json({ user: user || null });
  } catch (err) {
    console.error('ME ERROR:', err);
    return res.status(200).json({ user: null });
  }
}
