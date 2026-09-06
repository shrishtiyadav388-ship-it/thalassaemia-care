import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { createApplication } from '../server.mjs';
import { dayInZone, validateRecord, medicationSlots, appointmentCalendar } from '../lib/domain.mjs';

test('calendar days respect patient time zone and dates are validated',()=>{
 assert.equal(dayInZone(new Date('2026-09-05T20:00:00Z'),'Asia/Kolkata'),'2026-09-06');
 assert.equal(dayInZone(new Date('2026-09-05T01:00:00Z'),'America/Los_Angeles'),'2026-09-04');
 assert.throws(()=>validateRecord('transfusion',{date:'2026-02-31'}));
 assert.throws(()=>validateRecord('medication',{times:['25:00']}));
 const records=[{type:'medication',data:{active:true,startDate:'2026-09-01',endDate:'2026-09-06',times:['08:00','20:00']}}];
 assert.equal(medicationSlots(records,'2026-09-06').length,2);
 assert.equal(medicationSlots(records,'2026-09-07').length,0);
});

test('appointment calendar is neutral, UTC-based, and only exports scheduled events',()=>{
 const r={id:'test',type:'appointment',data:{title:'Private clinical detail',at:'2026-09-07T09:00:00.000Z',status:'scheduled'}};
 const result=appointmentCalendar(r);
 assert.match(result,/DTSTART:20260907T090000Z/);
 assert.match(result,/TRIGGER:-P1D/);assert.match(result,/TRIGGER:-PT1H/);
 assert.ok(!result.includes('Private clinical detail'));
 assert.throws(()=>appointmentCalendar({...r,data:{...r.data,status:'cancelled'}}));
});

test('accounts, encryption, ownership, CSRF, revisions, doses, persistence, and restore',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'thal-care-test-')),key='e'.repeat(64),origin='http://127.0.0.1:4317';
 let service=createApplication({dataDir:dir,key,origin}),base;
 const listen=async()=>{await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${service.server.address().port}`;};
 await listen();
 const request=async(route,{method='GET',data,cookie,csrf,extra={}}={})=>{const res=await fetch(base+route,{method,headers:{Origin:origin,...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...extra},body:data?JSON.stringify(data):undefined});const text=await res.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:res.status,body,cookie:res.headers.get('set-cookie')?.split(';')[0],headers:res.headers};};
 const signup=async username=>request('/api/register',{method:'POST',data:{username,password:'Fictional-test-password-943!',displayName:'Fictional User',timeZone:'Asia/Kolkata',adultConfirmed:true,consentAccepted:true}});
 try {
  assert.equal((await request('/api/state')).status,401);
  const a=await signup('patient-a'),b=await signup('patient-b');assert.equal(a.status,200);assert.equal(b.status,200);
  assert.match(a.headers.get('set-cookie'),/HttpOnly/);assert.match(a.headers.get('set-cookie'),/SameSite=Strict/);
  const auth={cookie:a.cookie,csrf:a.body.csrf},authB={cookie:b.cookie,csrf:b.body.csrf};
  const input={type:'transfusion',data:{date:'2026-09-01',hbBefore:9.8,hbAfter:12.1,hbUnit:'g/dL',units:2,location:'Private example location',notes:'Private example notes'}};
  assert.equal((await request('/api/records',{method:'POST',cookie:a.cookie,data:input})).status,403);
  assert.equal((await request('/api/records',{method:'POST',...auth,data:input,extra:{Origin:'https://wrong.example'}})).status,403);
  const created=await request('/api/records',{method:'POST',...auth,data:input});assert.equal(created.status,201);
  const record=created.body.record;
  assert.equal((await request(`/api/records/${record.id}`,{method:'PUT',...authB,data:{revision:1,data:input.data}})).status,404);
  assert.equal((await request(`/api/records/${record.id}`,{method:'DELETE',...authB,extra:{'If-Match':'1'}})).status,404);
  assert.equal((await request('/api/export',authB)).body.records.length,1);
  assert.equal((await request(`/api/records/${record.id}`,{method:'PUT',...auth,data:{revision:1,data:{...input.data,notes:'Updated private note'}}})).status,200);
  assert.equal((await request(`/api/records/${record.id}`,{method:'PUT',...auth,data:{revision:1,data:input.data}})).status,409);
  assert.equal((await request(`/api/records/${record.id}`,{method:'DELETE',...auth,extra:{'If-Match':'1'}})).status,409);
  // Entering a lab result must not create or alter any scheduled transfusion.
  await request('/api/records',{method:'POST',...auth,data:{type:'lab',data:{test:'Hemoglobin',value:8.8,unit:'g/dL',date:'2026-09-02'}}});
  assert.equal((await request('/api/state',auth)).body.records.filter(r=>r.type==='appointment').length,0);
  const date=dayInZone(new Date(),'Asia/Kolkata');
  const med=await request('/api/records',{method:'POST',...auth,data:{type:'medication',data:{name:'Fictional medication',dose:'As prescribed',times:['08:00'],category:'other',startDate:date,endDate:'',active:true}}});
  const dose={medicationId:med.body.record.id,time:'08:00',status:'taken'};
  assert.equal((await request('/api/doses',{method:'POST',...authB,data:dose})).status,404);
  assert.equal((await request('/api/doses',{method:'POST',...auth,data:dose})).status,201);
  assert.equal((await request('/api/doses',{method:'POST',...auth,data:dose})).status,409);
  const database=new DatabaseSync(path.join(dir,'care.sqlite'),{readOnly:true});
  const payload=database.prepare('SELECT payload FROM records WHERE id=?').get(record.id).payload;
  assert.ok(!payload.includes('Updated private note'));assert.ok(!payload.includes('location'));
  await backup(database,path.join(dir,'restore.sqlite'));database.close();
  await service.close();
  assert.ok(!readFileSync(path.join(dir,'care.sqlite')).includes(Buffer.from('Updated private note')));
  assert.throws(()=>createApplication({dataDir:dir,key:'f'.repeat(64),origin}),/key does not match/);
  service=createApplication({dataDir:dir,key,origin});await listen();
  const restored=await request('/api/state',auth);assert.equal(restored.status,200);assert.equal(restored.body.records.find(r=>r.id===record.id).data.notes,'Updated private note');
  const backupDb=new DatabaseSync(path.join(dir,'restore.sqlite'),{readOnly:true});assert.ok(backupDb.prepare('SELECT id FROM records WHERE id=?').get(record.id));backupDb.close();
  assert.equal((await request('/api/account',{method:'DELETE',...auth,data:{password:'wrong'}})).status,403);
  assert.equal((await request('/api/account',{method:'DELETE',...auth,data:{password:'Fictional-test-password-943!'}})).status,200);
  assert.equal((await request('/api/state',auth)).status,401);
  assert.equal((await request('/api/state',authB)).status,200);
  const recovery=await request('/api/recover',{method:'POST',data:{username:'patient-b',code:b.body.recoveryCode,password:'Replacement-test-password-234!'}});
  assert.equal(recovery.status,200);assert.ok(recovery.body.recoveryCode);
  assert.equal((await request('/api/state',authB)).status,401);
  assert.equal((await request('/api/recover',{method:'POST',data:{username:'patient-b',code:b.body.recoveryCode,password:'Another-test-password-456!'}})).status,401);
 } finally {await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('production refuses missing secure configuration',()=>{
 assert.throws(()=>createApplication({production:true,origin:'http://example.test',key:'a'.repeat(64),invite:'invite'}),/HTTPS/);
});
