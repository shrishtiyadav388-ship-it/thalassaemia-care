import { DatabaseSync, backup } from 'node:sqlite';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const source=process.argv[2],destination=process.argv[3];
if(!source||!destination||existsSync(destination)){console.error('Provide an existing database path and a new backup path. Existing destinations are not overwritten.');process.exit(1);}
const db=new DatabaseSync(resolve(source),{readOnly:true});
try{await backup(db,resolve(destination));console.log('Database backup complete. Keep its encryption key separately; both are required to restore.');}finally{db.close();}
