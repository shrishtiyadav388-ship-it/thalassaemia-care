import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createECDH,randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { validateSubscription,dueReminders,createReminders } from '../lib/reminders.mjs';

const sub=()=>({endpoint:'https://fcm.googleapis.com/fcm/send/fictional-test-endpoint',keys:{p256dh:createECDH('prime256v1').generateKeys().toString('base64url'),auth:randomBytes(16).toString('base64url')}});
test('push subscriptions restrict outbound hosts and validate keys',()=>{
 const valid=sub();assert.equal(validateSubscription(valid).endpoint,valid.endpoint);
 for(const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.example/a','https://user:pass@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a','https://169.254.169.254/a'])assert.throws(()=>validateSubscription({...valid,endpoint}));
 assert.throws(()=>validateSubscription({...valid,keys:{auth:'bad',p256dh:'bad'}}));
});
test('due reminders follow schedules and logged doses, including India midnight and repeated DST hour',()=>{
 const profile={type:'profile',data:{timeZone:'Asia/Kolkata'}},med={id:'m',revision:1,type:'medication',data:{active:true,startDate:'2026-01-01',endDate:'',times:['23:59']}};
 const india=dueReminders([profile,med],new Date('2026-09-05T18:35:00Z'));assert.equal(india.length,1);assert.equal(india[0].key,'m:2026-09-05:23:59');
 assert.equal(dueReminders([profile,med,{type:'dose',data:{medicationId:'m',day:'2026-09-05',time:'23:59',status:'skipped'}}],new Date('2026-09-05T18:35:00Z')).length,0);
 const dstProfile={type:'profile',data:{timeZone:'America/New_York'}},dstMed={...med,data:{...med.data,times:['01:30']}};
 assert.equal(dueReminders([dstProfile,dstMed],new Date('2026-11-01T05:30:00Z'))[0].key,dueReminders([dstProfile,dstMed],new Date('2026-11-01T06:30:00Z'))[0].key);
 const appt={id:'a',revision:1,type:'appointment',data:{status:'scheduled',at:'2026-09-07T10:00:00.000Z'}};
 assert.equal(dueReminders([profile,appt],new Date('2026-09-07T09:00:00Z')).length,1);
 assert.equal(dueReminders([profile,{...appt,data:{...appt.data,status:'cancelled'}}],new Date('2026-09-07T09:00:00Z')).length,0);
 assert.equal(dueReminders([profile,appt],new Date('2026-09-07T09:16:00Z')).length,0);
});
test('durable queue deduplicates, acknowledges display, cancels changed plans, and retries failures',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'care-push-test-'));const db=new DatabaseSync(path.join(dir,'test.sqlite'));
 db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES (\'u\');INSERT INTO users VALUES (\'other\');');
 let records=[{type:'profile',data:{timeZone:'Asia/Kolkata'}},{id:'a',revision:1,type:'appointment',data:{status:'scheduled',at:'2026-09-07T10:00:00.000Z'}}],sends=[],failure=false;
 const service=createReminders({db,directory:dir,production:false,seal:v=>JSON.stringify(v),unseal:v=>JSON.parse(v),records:()=>records,options:{startScheduler:false,send:async(s,p)=>{if(failure)throw Object.assign(new Error('temporary'),{statusCode:503});sends.push(JSON.parse(p));return {statusCode:201};}}});
 try {
  const subscription=sub();service.subscribe('u','session',subscription);assert.throws(()=>service.subscribe('other','other-session',subscription));
  service.unsubscribe('other',subscription.endpoint);assert.equal(service.status('u').browsers,1);
  const time=new Date('2026-09-07T09:00:00Z');await service.tick(time);await service.tick(new Date('2026-09-07T09:00:30Z'));assert.equal(sends.length,1);
  assert.ok(!JSON.stringify(sends[0]).includes('transfusion'));assert.ok(!JSON.stringify(sends[0]).includes('medicine'));
  assert.equal(db.prepare('SELECT status FROM push_jobs').get().status,'accepted');
  service.acknowledge(sends[0].id,'a'.repeat(48));assert.equal(db.prepare('SELECT status FROM push_jobs').get().status,'accepted');
  service.acknowledge(sends[0].id,sends[0].receipt);assert.equal(db.prepare('SELECT status FROM push_jobs').get().status,'displayed');
  // A changed appointment is a new schedule. A failed attempt stays pending.
  records[1].revision=2;failure=true;await service.tick(new Date('2026-09-07T09:01:00Z'));assert.equal(db.prepare('SELECT count(*) AS n FROM push_jobs WHERE status=\'pending\'').get().n,1);
  records[1].data.status='cancelled';failure=false;await service.tick(new Date('2026-09-07T09:03:00Z'));assert.equal(sends.length,1);assert.equal(db.prepare('SELECT count(*) AS n FROM push_jobs WHERE status=\'cancelled\'').get().n,1);
 }finally{await service.stop();db.close();rmSync(dir,{recursive:true,force:true});}
});
