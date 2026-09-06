import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, fail, validateRecord, dayInZone, appointmentCalendar } from './lib/domain.mjs';
import { createReminders } from './lib/reminders.mjs';
const hashPassword = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const safeEqual = (a,b) => { const x=Buffer.from(a), y=Buffer.from(b); return x.length === y.length && timingSafeEqual(x,y); };
const root = path.dirname(fileURLToPath(import.meta.url));

export function createApplication(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = options.origin ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:4317';
  const invite = options.invite ?? process.env.REGISTRATION_INVITE ?? '';
  const privacyContact=options.privacyContact??process.env.PRIVACY_CONTACT??'';
  const directory = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? path.join(root,'data'));
  let secret = options.key ?? process.env.DATA_KEY;
  if (production && (!origin.startsWith('https://') || !secret || !invite)) throw new Error('Production requires HTTPS APP_ORIGIN, DATA_KEY and REGISTRATION_INVITE.');
  if(production&&(!privacyContact||process.env.PATIENT_RELEASE_REVIEWED!=='true'))throw new Error('Production requires PRIVACY_CONTACT and an operator-approved PATIENT_RELEASE_REVIEWED=true after the release checklist is complete.');
  if(new URL(origin).origin!==origin)throw new Error('APP_ORIGIN must be an exact origin with no path or trailing slash.');
  mkdirSync(directory,{recursive:true,mode:0o700});
  if (!secret) {
    const keyFile=path.join(directory,'development.key');
    if (!existsSync(keyFile)) writeFileSync(keyFile,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
    secret=readFileSync(keyFile,'utf8').trim();
  }
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('DATA_KEY must be 64 hexadecimal characters.');
  const key=Buffer.from(secret,'hex');
  const db=new DatabaseSync(path.join(directory,'care.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,type TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS meta(name TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_codes(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS consent_records(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,notice_version TEXT NOT NULL,accepted_at INTEGER NOT NULL,adult_declared INTEGER NOT NULL);`);
  if(!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='last_seen'))db.exec('ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0');
  db.exec('PRAGMA user_version=2');
  function seal(value,aad) { const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv); cipher.setAAD(Buffer.from(aad)); const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64'); }
  function unseal(value,aad) { const bytes=Buffer.from(value,'base64'),dec=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));dec.setAAD(Buffer.from(aad));dec.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([dec.update(bytes.subarray(28)),dec.final()]).toString('utf8')); }
  const check=db.prepare('SELECT value FROM meta WHERE name=?').get('key-check');
  try { if (check) unseal(check.value,'key-check'); else db.prepare('INSERT INTO meta(name,value) VALUES(?,?)').run('key-check',seal({ok:true},'key-check')); }
  catch { db.close(); throw new Error('Database encryption key does not match. Restore the correct key; do not create a replacement.'); }
  function decode(row) {return {id:row.id,type:row.type,revision:row.revision,data:unseal(row.payload,`${row.user_id}:${row.id}:${row.type}`)};}
  function owned(uid,id) {const row=db.prepare('SELECT * FROM records WHERE user_id=? AND id=?').get(uid,id);if(!row)fail('Record not found.',404);return decode(row);}
  function records(uid) {return db.prepare('SELECT * FROM records WHERE user_id=?').all(uid).map(decode);}
  const reminders=createReminders({db,directory,production,seal,unseal,records,options:options.reminders||{}});
  function add(uid,type,data,id=randomUUID()) {db.prepare('INSERT INTO records(id,user_id,type,payload) VALUES(?,?,?,?)').run(id,uid,type,seal(data,`${uid}:${id}:${type}`));return owned(uid,id);}
  const limits=new Map();
  function rateLimit(bucket,max=20) {const now=Date.now();for(const [k,v] of limits)if(v.until<now)limits.delete(k);const entry=limits.get(bucket)||{count:0,until:now+15*60000};entry.count++;limits.set(bucket,entry);if(entry.count>max)fail('Too many attempts. Try again in 15 minutes.',429);}
  function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  async function body(req) {let size=0, chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24000)fail('Request is too large.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('Invalid JSON.');}}
  function authenticate(req) {const match=(req.headers.cookie||'').match(/(?:^|;\s*)care_session=([a-f0-9]{64})(?:;|$)/);if(!match)fail('Please sign in.',401);const row=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>? AND last_seen>?').get(hash(match[1]),Date.now(),Date.now()-30*60000);if(!row)fail('Please sign in again.',401);if(req.headers['x-user-active']==='1'||req.method!=='GET')db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(Date.now(),row.token_hash);return row;}
  const cookieFlags=`; HttpOnly; SameSite=Strict; Path=/${production?'; Secure':''}`;
  async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
    try {
      const url=new URL(req.url,origin), route=url.pathname;
      const mutation=['POST','PUT','DELETE'].includes(req.method);
      if(mutation){if(req.headers.origin!==origin)fail('Request origin is not allowed.',403);if(req.method!=='DELETE' && !String(req.headers['content-type']||'').startsWith('application/json'))fail('Use JSON requests.',415);}
      if(req.method==='GET' && route==='/api/config') return json(res,200,{development:!production,inviteRequired:Boolean(invite),privacyContact,noticeVersion:'2026-09-v1'});
      if(req.method==='GET' && route==='/health') return json(res,200,{ok:true});
      if(req.method==='POST'&&route==='/api/push/receipt'){const data=await body(req);reminders.acknowledge(data.id,data.receipt);return json(res,200,{ok:true});}
      if(req.method==='POST'&&route==='/api/recover'){
        rateLimit(`recover:${req.socket.remoteAddress}`,5);const data=await body(req);
        if(typeof data.username!=='string'||typeof data.code!=='string'||typeof data.password!=='string'||data.password.length<12||data.password.length>128)fail('Check your username, recovery code, and new password.');
        const user=db.prepare('SELECT u.* FROM users u JOIN recovery_codes r ON u.id=r.user_id WHERE u.username=? AND r.code_hash=?').get(data.username.trim().toLowerCase(),hash(data.code.trim()));
        if(!user)fail('Recovery details are incorrect.',401);
        const salt=randomBytes(16).toString('hex'),passwordHash=(await hashPassword(data.password,salt,64)).toString('hex'),replacement=randomBytes(24).toString('hex');
        db.exec('BEGIN');try{db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(salt,passwordHash,user.id);db.prepare('UPDATE recovery_codes SET code_hash=? WHERE user_id=?').run(hash(replacement),user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(user.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        return json(res,200,{recoveryCode:replacement});
      }
      if(req.method==='POST' && ['/api/register','/api/login'].includes(route)) {
        rateLimit(`auth-ip:${req.socket.remoteAddress}`);
        const data=await body(req),username=typeof data.username==='string'?data.username.trim().toLowerCase():'';
        if(!/^[a-z0-9_.-]{3,40}$/.test(username))fail('Use a username of 3–40 letters, numbers, dots, dashes or underscores.');
        rateLimit(`auth-user:${username}`,12);
        if(typeof data.password!=='string'||data.password.length<12||data.password.length>128)fail('Use a password between 12 and 128 characters.');
        let user,recoveryCode;
        if(route==='/api/register') {
          if(invite && (typeof data.invite!=='string'||!safeEqual(data.invite,invite)))fail('Registration invitation is not valid.',403);
          if(data.adultConfirmed!==true||data.consentAccepted!==true)fail('This first release is for adults managing their own care. Confirm that you are 18 or older and have read the privacy notice.');
          const profile=validateRecord('profile',{displayName:data.displayName,timeZone:data.timeZone});
          if(db.prepare('SELECT id FROM users WHERE username=?').get(username))fail('That username is unavailable.',409);
          const salt=randomBytes(16).toString('hex'),digest=(await hashPassword(data.password,salt,64)).toString('hex');
          user={id:randomUUID(),username};db.exec('BEGIN');
          try {db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(user.id,username,salt,digest);add(user.id,'profile',profile);recoveryCode=randomBytes(24).toString('hex');db.prepare('INSERT INTO recovery_codes(user_id,code_hash) VALUES(?,?)').run(user.id,hash(recoveryCode));db.prepare('INSERT INTO consent_records(user_id,notice_version,accepted_at,adult_declared) VALUES(?,?,?,?)').run(user.id,'2026-09-v1',Date.now(),1);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
        } else {
          user=db.prepare('SELECT * FROM users WHERE username=?').get(username);
          const digest=(await hashPassword(data.password,user?.salt||'invalid-user-fixed-salt',64)).toString('hex');
          if(!user || !safeEqual(digest,user.password_hash))fail('Username or password is incorrect.',401);
        }
        const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
        db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires,last_seen) VALUES(?,?,?,?,?)').run(hash(token),user.id,csrf,Date.now()+8*3600000,Date.now());
        res.setHeader('Set-Cookie',`care_session=${token}; Max-Age=28800${cookieFlags}`);
        return json(res,200,{csrf,records:records(user.id),...(recoveryCode?{recoveryCode}:{})});
      }
      if(route.startsWith('/api/')) {
        const session=authenticate(req),uid=session.user_id;
        if(mutation && !safeEqual(String(req.headers['x-csrf-token']||''),session.csrf))fail('Session verification failed. Refresh and try again.',403);
        if(req.method==='GET' && route==='/api/state')return json(res,200,{csrf:session.csrf,records:records(uid)});
        if(req.method==='POST' && ['/api/logout','/api/lock'].includes(route)){if(route==='/api/logout')db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND session_hash=?').run(uid,session.token_hash);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);res.setHeader('Set-Cookie',`care_session=; Max-Age=0${cookieFlags}`);return json(res,200,{ok:true});}
        if(req.method==='GET'&&route==='/api/push/status')return json(res,200,{...reminders.status(uid),endpointHashes:db.prepare('SELECT endpoint_hash FROM push_subscriptions WHERE user_id=?').all(uid).map(r=>r.endpoint_hash)});
        if(req.method==='GET'&&route==='/api/push/key')return json(res,200,{publicKey:reminders.publicKey});
        if(req.method==='POST'&&route==='/api/push/subscribe')return json(res,200,reminders.subscribe(uid,session.token_hash,await body(req)));
        if(req.method==='POST'&&route==='/api/push/unsubscribe')return json(res,200,reminders.unsubscribe(uid,(await body(req)).endpoint));
        if(req.method==='POST'&&route==='/api/push/test'){rateLimit(`push-test:${uid}`,5);return json(res,200,await reminders.test(uid,(await body(req)).endpoint));}
        if(req.method==='POST'&&route==='/api/password'){
          rateLimit(`password:${uid}`,5);const input=await body(req),user=db.prepare('SELECT * FROM users WHERE id=?').get(uid);
          if(typeof input.currentPassword!=='string'||input.currentPassword.length>128||typeof input.newPassword!=='string'||input.newPassword.length<12||input.newPassword.length>128)fail('Use a new password of 12–128 characters and enter your current password.');
          if(!safeEqual((await hashPassword(input.currentPassword,user.salt,64)).toString('hex'),user.password_hash))fail('Current password is incorrect.',403);
          const salt=randomBytes(16).toString('hex'),digest=(await hashPassword(input.newPassword,salt,64)).toString('hex'),recoveryCode=randomBytes(24).toString('hex');
          db.exec('BEGIN');try{db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(salt,digest,uid);db.prepare('INSERT INTO recovery_codes(user_id,code_hash) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash').run(uid,hash(recoveryCode));db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(uid,session.token_hash);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
          return json(res,200,{recoveryCode});
        }
        if(req.method==='GET' && route==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="care-records.json"');return json(res,200,{format:'thalassaemia-care-v1',exportedAt:new Date().toISOString(),records:records(uid)});}
        if(req.method==='DELETE' && route==='/api/account'){const input=await body(req),user=db.prepare('SELECT * FROM users WHERE id=?').get(uid);if(typeof input.password!=='string'||input.password.length>128)fail('Enter your password.');rateLimit(`delete:${uid}`,5);const digest=(await hashPassword(input.password,user.salt,64)).toString('hex');if(!safeEqual(digest,user.password_hash))fail('Password is incorrect.',403);db.prepare('DELETE FROM users WHERE id=?').run(uid);res.setHeader('Set-Cookie',`care_session=; Max-Age=0${cookieFlags}`);return json(res,200,{ok:true});}
        if(req.method==='GET' && /^\/api\/calendar\/[a-f0-9-]+$/.test(route)){const record=owned(uid,route.split('/').at(-1));res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="care-appointment.ics"'});return res.end(appointmentCalendar(record));}
        if(req.method==='POST' && route==='/api/records') {
          if(records(uid).length>=10000)fail('Record limit reached. Export your records and contact the administrator.',409);
          const input=await body(req);if(input.type==='profile')fail('Edit your existing profile instead.');
          const data=validateRecord(input.type,input.data);return json(res,201,{record:add(uid,input.type,data)});
        }
        if(req.method==='POST' && route==='/api/doses') {
          const input=await body(req),med=owned(uid,String(input.medicationId));
          const profile=records(uid).find(r=>r.type==='profile'),day=dayInZone(new Date(),profile.data.timeZone);
          if(med.type!=='medication'||!med.data.active||!med.data.times.includes(input.time)||med.data.startDate>day||(med.data.endDate&&med.data.endDate<day)||!['taken','skipped'].includes(input.status))fail('This dose is not scheduled for today.');
          const id=hash(`${uid}:${med.id}:${day}:${input.time}`),payload={medicationId:med.id,name:med.data.name,dose:med.data.dose,day,time:input.time,status:input.status,recordedAt:new Date().toISOString()};
          if(db.prepare('SELECT id FROM records WHERE id=? AND user_id=?').get(id,uid))fail('This dose has already been recorded. Undo it before changing the entry.',409);
          return json(res,201,{record:add(uid,'dose',payload,id)});
        }
        if(/^\/api\/records\/[a-f0-9-]+$/.test(route)) {
          const record=owned(uid,route.split('/').at(-1));
          if(req.method==='PUT') {if(record.type==='dose')fail('Undo a dose entry before changing it.');const input=await body(req);if(input.revision!==record.revision)fail('This record changed in another window. Refresh before editing.',409);const data=validateRecord(record.type,input.data);db.prepare('UPDATE records SET payload=?,revision=revision+1 WHERE id=? AND user_id=?').run(seal(data,`${uid}:${record.id}:${record.type}`),record.id,uid);return json(res,200,{record:owned(uid,record.id)});}
          if(req.method==='DELETE') {if(record.type==='profile')fail('Use account deletion to remove your profile.');if(String(req.headers['if-match'])!==String(record.revision))fail('This record changed. Refresh before deleting.',409);db.prepare('DELETE FROM records WHERE id=? AND user_id=?').run(record.id,uid);return json(res,200,{ok:true});}
        }
        fail('Not found.',404);
      }
      const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/voice.js':['voice.js','text/javascript'],'/notifications.js':['notifications.js','text/javascript'],'/sw.js':['sw.js','text/javascript'],'/manifest.webmanifest':['manifest.webmanifest','application/manifest+json'],'/style.css':['style.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};
      if(req.method!=='GET'||!files[route])fail('Not found.',404);
      const [file,mime]=files[route];res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`});res.end(readFileSync(path.join(root,'public',file)));
    } catch(error) {const status=error instanceof AppError?error.status:500;if(status===500)console.error('Request failed:',error.name);json(res,status,{error:status===500?'Could not complete the request. Please try again.':error.message});}
  }
  const server=http.createServer((req,res)=>{handler(req,res).catch(()=>{if(!res.headersSent)json(res,500,{error:'Request failed.'});else res.end();});});
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,reminders,close:async()=>{await reminders.stop();await new Promise(resolve=>server.close(resolve));db.close();}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4317);
  if(process.env.NODE_ENV!=='production' && !['127.0.0.1','localhost','::1'].includes(host))throw new Error('Development mode must bind to loopback. Use production configuration for remote access.');
  const app=createApplication();app.server.listen(port,host,()=>console.log(`Thalassaemia Care: ${process.env.APP_ORIGIN||`http://${host}:${port}`} — ${process.env.NODE_ENV==='production'?'configured production server':'development; use fictional records'}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit()));
}
