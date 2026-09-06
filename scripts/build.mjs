import { mkdirSync, copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const file of ['server.mjs','lib/domain.mjs','lib/reminders.mjs','public/app.js','public/voice.js','public/notifications.js','public/sw.js']) {
  const result=spawnSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});
  if(result.status!==0)process.exit(1);
}
const html=readFileSync(path.join(root,'public/index.html'),'utf8');
for(const match of html.matchAll(/(?:href|src)="\/([^"#]+)"/g))readFileSync(path.join(root,'public',match[1]));
// Only public assets and application source are packaged. Never copy the data directory.
const copy=(from,to)=>{mkdirSync(to,{recursive:true});for(const entry of readdirSync(from,{withFileTypes:true})){const a=path.join(from,entry.name),b=path.join(to,entry.name);if(entry.isDirectory())copy(a,b);else copyFileSync(a,b);}};
for(const folder of ['public','lib'])copy(path.join(root,folder),path.join(root,'dist',folder));
for(const file of ['server.mjs','package.json','package-lock.json'])copyFileSync(path.join(root,file),path.join(root,'dist',file));
console.log('Build complete: runnable Node application in dist; no patient data included.');
