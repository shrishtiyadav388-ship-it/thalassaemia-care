import webpush from 'web-push';
import { createHash, randomBytes, createECDH } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fail, dayInZone } from './domain.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function validateSubscription(input) {
  let endpoint;
  try { endpoint=new URL(input?.endpoint); } catch { fail('This browser returned an invalid notification address.'); }
  const host=endpoint.hostname;
  const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host==='web.push.apple.com'||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com');
  if(!allowed||endpoint.protocol!=='https:'||endpoint.username||endpoint.password||(endpoint.port&&endpoint.port!=='443')||endpoint.hash||endpoint.href.length>2048)fail('This browser notification service is not supported.');
  const p256dh=input?.keys?.p256dh,auth=input?.keys?.auth;
  if(typeof p256dh!=='string'||typeof auth!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(p256dh)||!/^[A-Za-z0-9_-]+={0,2}$/.test(auth)||Buffer.from(p256dh,'base64url').length!==65||Buffer.from(p256dh,'base64url')[0]!==4||Buffer.from(auth,'base64url').length!==16)fail('Invalid browser subscription keys.');
  return {endpoint:endpoint.href,keys:{p256dh,auth}};
}
function localClock(now,timeZone) {
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 return `${parts.find(p=>p.type==='hour').value}:${parts.find(p=>p.type==='minute').value}`;
}
// Discover due slots over a short catch-up window. DST repeated hours share a slot key.
export function dueReminders(records,now=new Date()) {
 const zone=records.find(r=>r.type==='profile')?.data.timeZone||'Asia/Kolkata';
 const result=new Map(),clock=now.getTime();
 for(const r of records){
  if(r.type==='appointment'&&r.data.status==='scheduled')for(const minutes of [1440,60]){
   const dueAt=Date.parse(r.data.at)-minutes*60000;
   if(clock>=dueAt&&clock<dueAt+15*60000)result.set(`${r.id}:${r.revision}:${minutes}`,{key:`${r.id}:${r.revision}:${minutes}`,dueAt,expires:Math.min(dueAt+15*60000,Date.parse(r.data.at))});
  }
 }
 for(let minutes=0;minutes<15;minutes++){
  const instant=new Date(clock-minutes*60000),day=dayInZone(instant,zone),time=localClock(instant,zone),dueAt=instant.getTime()-instant.getUTCSeconds()*1000-instant.getUTCMilliseconds();
  for(const r of records){
   if(r.type==='medication'&&r.data.active&&r.data.startDate<=day&&(!r.data.endDate||r.data.endDate>=day)&&r.data.times.includes(time)&&!records.some(d=>d.type==='dose'&&d.data.medicationId===r.id&&d.data.day===day&&d.data.time===time)){
    const key=`${r.id}:${day}:${time}`;if(!result.has(key))result.set(key,{key,dueAt,expires:dueAt+15*60000});
   }
   if(r.type==='care'&&r.data.status==='active'&&r.data.dueDate===day&&time==='09:00'){
    const key=`${r.id}:${r.revision}:${day}:care`;if(!result.has(key))result.set(key,{key,dueAt,expires:dueAt+15*60000});
   }
  }
 }
 return [...result.values()].filter(r=>r.expires>clock);
}
export function createReminders({db,directory,production,seal,unseal,records,options={}}) {
 db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_hash TEXT NOT NULL,endpoint_hash TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
 CREATE TABLE IF NOT EXISTS push_jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,payload TEXT NOT NULL,due_at INTEGER NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,receipt_hash TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS idx_push_jobs_pending ON push_jobs(status,next_at);
 CREATE INDEX IF NOT EXISTS idx_push_jobs_user ON push_jobs(user_id);`);
 let publicKey=options.publicKey??process.env.VAPID_PUBLIC_KEY,privateKey=options.privateKey??process.env.VAPID_PRIVATE_KEY;
 const subject=options.subject??process.env.VAPID_SUBJECT??(!production?'https://example.invalid/thalassaemia-care':undefined);
 if(!production&&!publicKey&&!privateKey){const f=path.join(directory,'development-vapid.json');if(!existsSync(f))writeFileSync(f,JSON.stringify(webpush.generateVAPIDKeys()),{mode:0o600,flag:'wx'});const keys=JSON.parse(readFileSync(f,'utf8'));publicKey=keys.publicKey;privateKey=keys.privateKey;}
 const enabled=Boolean(publicKey&&privateKey&&subject);
 if(production&&!enabled)throw new Error('Production browser reminders require VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.');
 if(enabled){try{const pair=createECDH('prime256v1');pair.setPrivateKey(Buffer.from(privateKey,'base64url'));if(pair.getPublicKey().toString('base64url')!==publicKey.replace(/=+$/,''))throw Error();const contact=new URL(subject);if(!['mailto:','https:'].includes(contact.protocol))throw Error();}catch{throw new Error('Invalid browser reminder key pair or contact configuration.');}}
 const send=options.send??((sub,payload,sendOptions)=>webpush.sendNotification(sub,payload,sendOptions));
 let running=false,lastTick=null,lastError=false;
 function subscribe(uid,sessionHash,input){if(!enabled)fail('Browser reminders are not configured on this server.',503);const sub=validateSubscription(input),endpointHash=digest(sub.endpoint),existing=db.prepare('SELECT * FROM push_subscriptions WHERE endpoint_hash=?').get(endpointHash);
  if(existing&&existing.user_id!==uid)fail('This browser has reminders for another account. Sign out of that account and disable its reminders first.',409);
  if(!existing&&db.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id=?').get(uid).n>=5)fail('Five browsers are already connected. Disable an old browser first.');
  const id=existing?.id??randomBytes(16).toString('hex');db.prepare('INSERT INTO push_subscriptions(id,user_id,session_hash,endpoint_hash,payload,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET session_hash=excluded.session_hash,payload=excluded.payload').run(id,uid,sessionHash,endpointHash,seal(sub,`push:${uid}:${id}`),Date.now());return {enabled:true};
 }
 function unsubscribe(uid,endpoint){db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint_hash=?').run(uid,digest(String(endpoint)));return {enabled:false};}
 function status(uid){return {configured:enabled,browsers:db.prepare('SELECT count(*) AS n FROM push_subscriptions WHERE user_id=?').get(uid).n,lastTick,lastError,recent:db.prepare('SELECT status,count(*) AS count FROM push_jobs WHERE user_id=? AND due_at>? GROUP BY status').all(uid,Date.now()-86400000)};}
 function enqueue(uid,sub,event){const id=digest(`${sub.id}:${event.key}`);db.prepare('INSERT OR IGNORE INTO push_jobs(id,user_id,subscription_id,payload,due_at,expires,status,next_at) VALUES(?,?,?,?,?,?,?,?)').run(id,uid,sub.id,seal({key:event.key},`job:${uid}:${id}`),event.dueAt,event.expires,'pending',event.dueAt);}
 async function dispatch(job,now,eventStillDue=true){
  const sub=db.prepare('SELECT * FROM push_subscriptions WHERE id=? AND user_id=?').get(job.subscription_id,job.user_id);
  if(!sub||!eventStillDue||job.expires<=now){db.prepare('UPDATE push_jobs SET status=? WHERE id=?').run('cancelled',job.id);return;}
  const receipt=randomBytes(24).toString('hex');db.prepare('UPDATE push_jobs SET status=?,attempts=attempts+1,lease_until=?,receipt_hash=? WHERE id=?').run('sending',now+60000,digest(receipt),job.id);
  try {
   await send(unseal(sub.payload,`push:${sub.user_id}:${sub.id}`),JSON.stringify({title:'Care reminder',body:'You have a care reminder. Open your care space to check the details.',id:job.id,receipt}),{vapidDetails:{subject,publicKey,privateKey},TTL:Math.max(1,Math.floor((job.expires-now)/1000)),timeout:10000,urgency:'normal',topic:job.id.slice(0,32)});
   db.prepare('UPDATE push_jobs SET status=? WHERE id=? AND status=?').run('accepted',job.id,'sending');
  }catch(error){
   if([404,410].includes(error.statusCode)){db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(sub.id);return;}
   const retry=!error.statusCode||error.statusCode===429||error.statusCode>=500;
   db.prepare('UPDATE push_jobs SET status=?,next_at=? WHERE id=?').run(retry&&job.attempts<4?'pending':'failed',now+Math.min(5,2**job.attempts)*60000,job.id);
  }
 }
 async function tick(now=new Date()){
  if(running||!enabled)return;running=true;
  try{
   const ms=now.getTime();db.prepare('UPDATE push_jobs SET status=? WHERE status=? AND lease_until<?').run('pending','sending',ms);db.prepare('UPDATE push_jobs SET status=? WHERE status=? AND expires<=?').run('expired','pending',ms);
   db.prepare('DELETE FROM push_jobs WHERE expires<?').run(ms-7*86400000);
   const subs=db.prepare('SELECT * FROM push_subscriptions').all(),dueByUser=new Map();
   for(const sub of subs){if(!dueByUser.has(sub.user_id))dueByUser.set(sub.user_id,dueReminders(records(sub.user_id),now));for(const event of dueByUser.get(sub.user_id))enqueue(sub.user_id,sub,event);}
   for(const job of db.prepare('SELECT * FROM push_jobs WHERE status=? AND next_at<=? ORDER BY due_at LIMIT 50').all('pending',ms)){
    const event=unseal(job.payload,`job:${job.user_id}:${job.id}`);
    const stillDue=event.key.startsWith('test:')||dueReminders(records(job.user_id),now).some(x=>x.key===event.key);
    await dispatch(job,ms,stillDue);
   }
   lastTick=new Date().toISOString();lastError=false;
  }catch{lastError=true;console.error('Reminder scheduler needs attention. No patient details logged.');}finally{running=false;}
 }
 async function test(uid,endpoint){const sub=db.prepare('SELECT * FROM push_subscriptions WHERE user_id=? AND endpoint_hash=?').get(uid,digest(String(endpoint)));if(!sub)fail('Enable this browser first.',404);const now=Date.now(),event={key:`test:${randomBytes(8).toString('hex')}`,dueAt:now,expires:now+5*60000};enqueue(uid,sub,event);const job=db.prepare('SELECT * FROM push_jobs WHERE id=?').get(digest(`${sub.id}:${event.key}`));await dispatch(job,now);const result=db.prepare('SELECT status FROM push_jobs WHERE id=?').get(job.id);return {status:result?.status??'subscription-expired'};}
 function acknowledge(id,receipt){if(typeof id!=='string'||typeof receipt!=='string'||!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{48}$/.test(receipt))return;db.prepare('UPDATE push_jobs SET status=? WHERE id=? AND receipt_hash=? AND status IN (?,?)').run('displayed',id,digest(receipt),'sending','accepted');}
 const timer=options.startScheduler===false?null:setInterval(()=>tick(),30000);timer?.unref();
 return {publicKey:enabled?publicKey:null,enabled,subscribe,unsubscribe,status,tick,test,acknowledge,stop:async()=>{if(timer)clearInterval(timer);while(running)await new Promise(r=>setTimeout(r,50));}};
}
