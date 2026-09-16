import crypto from 'node:crypto';
import { getDb } from '../../lib/db.js';
import { hashPassword } from '../../lib/auth.js';

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const token=String(body.token||''); const password=String(body.password||'');
    if(token.length<40) return res.status(400).json({error:'Invalid or expired reset link.'});
    if(password.length<8) return res.status(400).json({error:'Password must be at least 8 characters.'});
    const hash=crypto.createHash('sha256').update(token).digest('hex');
    const sql=getDb(); const rows=await sql`SELECT id FROM users WHERE reset_token_hash=${hash} AND reset_expires_at>NOW() LIMIT 1`;
    if(!rows[0]) return res.status(400).json({error:'Invalid or expired reset link.'});
    const passwordHash=await hashPassword(password);
    await sql`UPDATE users SET password_hash=${passwordHash}, reset_token_hash=NULL, reset_expires_at=NULL WHERE id=${rows[0].id}`;
    return res.status(200).json({ok:true});
  }catch(err){console.error('RESET ERROR:',err);return res.status(500).json({error:'Unable to reset password.'});}
}
