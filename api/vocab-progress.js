import { getDb } from '../lib/db.js';
import { getSessionUser } from '../lib/auth.js';

function schedule(prev, quality) {
  const now=Date.now(); let stage=Number(prev?.stage)||0, ease=Number(prev?.ease)||2.5, interval=Number(prev?.interval)||0, reps=Number(prev?.reps)||0, lapses=Number(prev?.lapses)||0;
  if(Number(quality)===0){ stage=Math.max(0,stage-2); lapses++; interval=0; reps=0; }
  else { reps++; if(stage<=0){stage=1;interval=quality>=3?1:0;} else if(stage===1){stage=2;interval=quality>=3?3:1;} else if(stage===2){stage=3;interval=quality>=3?7:3;} else {stage=Math.min(8,stage+1); ease=Math.max(1.3,ease+(0.1-(3-quality)*(0.08+(3-quality)*0.02))); interval=Math.max(1,Math.round(interval*ease*(quality===1?0.8:quality===3?1.3:1)));}}
  return {stage,ease,interval,due_at:new Date(now+(interval<=0?10*60*1000:interval*864e5)),reps,lapses,last_ms:now};
}

export default async function handler(req,res){
  try{
    const user=await getSessionUser(req); if(!user)return res.status(401).json({error:'Unauthorized'});
    const sql=getDb();
    if(req.method==='GET'){
      const rows=await sql`SELECT vocabulary_id,stage,ease,interval,due_at,reps,lapses,last_ms,flash_seen,writing_count,updated_at FROM vocabulary_progress WHERE user_id=${user.id}`;
      return res.status(200).json({items:rows});
    }
    if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):req.body||{}; const list=Array.isArray(body.items)?body.items:[body]; const saved=[];
    for(const e of list){
      const vocabularyId=Number(e.vocabulary_id||e.id); if(!Number.isInteger(vocabularyId)||vocabularyId<1)continue;
      const existing=(await sql`SELECT stage,ease,interval,reps,lapses FROM vocabulary_progress WHERE user_id=${user.id} AND vocabulary_id=${vocabularyId}`)[0]||{};
      const q=e.quality==null?null:Number(e.quality); const next=q==null?schedule(existing,2):schedule(existing,q);
      const writing=Math.max(0,Number(e.writing_count)||0); const flash=Boolean(e.flash_seen);
      const rows=await sql`INSERT INTO vocabulary_progress(user_id,vocabulary_id,stage,ease,interval,due_at,reps,lapses,last_ms,flash_seen,writing_count,updated_at) VALUES(${user.id},${vocabularyId},${next.stage},${next.ease},${next.interval},${next.due_at.toISOString()},${next.reps},${next.lapses},${next.last_ms},${flash},${writing},NOW()) ON CONFLICT(user_id,vocabulary_id) DO UPDATE SET stage=EXCLUDED.stage,ease=EXCLUDED.ease,interval=EXCLUDED.interval,due_at=EXCLUDED.due_at,reps=EXCLUDED.reps,lapses=EXCLUDED.lapses,last_ms=EXCLUDED.last_ms,flash_seen=vocabulary_progress.flash_seen OR EXCLUDED.flash_seen,writing_count=GREATEST(vocabulary_progress.writing_count,EXCLUDED.writing_count),updated_at=NOW() RETURNING *`;
      if(rows[0])saved.push(rows[0]);
    }
    return res.status(200).json({ok:true,saved});
  }catch(err){console.error('VOCAB PROGRESS ERROR',err);return res.status(500).json({error:'Server error'});}
}
