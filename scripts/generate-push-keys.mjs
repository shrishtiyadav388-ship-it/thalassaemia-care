import webpush from 'web-push';
import { writeFileSync } from 'node:fs';
const destination=process.argv[2];
if(!destination){console.error('Provide a private destination file outside your source repository.');process.exit(1);}
writeFileSync(destination,JSON.stringify(webpush.generateVAPIDKeys(),null,2),{flag:'wx',mode:0o600});
console.log('Keys saved to the requested private file. Move them into host secrets; do not commit the file.');
