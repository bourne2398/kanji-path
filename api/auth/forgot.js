import crypto from 'node:crypto';
import { getDb } from '../../lib/db.js';

function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/,'');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

async function sendResetEmail(to, url) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method:'POST', headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:process.env.RESEND_FROM,to:[to],subject:'Reset your Kanji Path password',html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>Kanji Path password reset</h2><p>We received a request to reset your password.</p><p><a href="${url}" style="display:inline-block;padding:12px 18px;background:#7c5cff;color:white;text-decoration:none;border-radius:10px">Reset password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p></div>`})
  });
  return r.ok;
}

export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const email=String(body.email||'').trim().toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Enter a valid email address.'});
    const sql=getDb();
    const rows=await sql`SELECT id,email FROM users WHERE LOWER(email)=${email} LIMIT 1`;
    // Always return the same message to avoid account enumeration.
    if(rows[0]){
      const raw=crypto.randomBytes(32).toString('hex');
      const hash=crypto.createHash('sha256').update(raw).digest('hex');
      await sql`UPDATE users SET reset_token_hash=${hash}, reset_expires_at=NOW()+INTERVAL '30 minutes' WHERE id=${rows[0].id}`;
      const url=`${baseUrl(req)}/?reset=${encodeURIComponent(raw)}`;
      const sent=await sendResetEmail(rows[0].email,url);
      if(!sent && process.env.NODE_ENV!=='production') console.log('DEV RESET URL:',url);
      if(!sent && process.env.NODE_ENV==='production') console.warn('Password reset email not sent: configure RESEND_API_KEY and RESEND_FROM');
    }
    return res.status(200).json({ok:true,message:'If an account exists for that email, a password reset link has been sent.'});
  }catch(err){console.error('FORGOT ERROR:',err);return res.status(500).json({error:'Unable to process password reset request.'});}
}
