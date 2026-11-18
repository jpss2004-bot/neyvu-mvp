import {mkdir,lstat,chown,chmod,access} from 'node:fs/promises';
import {constants} from 'node:fs';
const root='/var/schoolvault/files';
if(process.env.SCHOOL_BETA_FILE_ROOT!==root)throw Error('Unexpected beta file mount');
await mkdir(root,{recursive:true,mode:0o700});
if((await lstat(root)).isSymbolicLink())throw Error('Unsafe file mount');
// Initialize just this dedicated mount. Never recursively change existing files.
if(process.getuid()===0){await chown(root,1000,1000);await chmod(root,0o700);process.setgroups([]);process.setgid(1000);process.setuid(1000);}
await access(root,constants.R_OK|constants.W_OK);
await import('./server.js');
