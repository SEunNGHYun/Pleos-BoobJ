import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalDatabase} from '../dist/database/local-database.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const localDir=join(root,'.local');
const dataPath=resolve(process.env.LOCAL_DB_PATH??join(localDir,'database'));
const credentialPath=join(localDir,'credentials.json');
const envPath=join(root,'server','.env');
await mkdir(localDir,{recursive:true,mode:0o700});
let env='';
try{env=await readFile(envPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(!/^LOCAL_DB_PATH=/m.test(env)){
 await appendFile(envPath,`${env&&!env.endsWith('\n')?'\n':''}LOCAL_DB_PATH=${JSON.stringify(dataPath)}\n`,{mode:0o600});
}
const db=await LocalDatabase.open(dataPath);
try{
 let accounts;
 try{
  accounts=JSON.parse(await readFile(credentialPath,'utf8'));
  if(await db.authenticate(accounts.owner.token)!==accounts.owner.userId||await db.authenticate(accounts.customer.token)!==accounts.customer.userId){
   throw new Error('Saved local credentials do not match this database. Keep the DB and credentials together.');
  }
 }catch(error){
  if(error.code!=='ENOENT')throw error;
  accounts={owner:await db.createLocalUser('로컬 식당 운영자'),customer:await db.createLocalUser('로컬 주문 사용자')};
  await writeFile(credentialPath,JSON.stringify(accounts,null,2)+'\n',{mode:0o600,flag:'wx'});
 }
 console.log('Local database and developer accounts are ready.');
 console.log(`Credentials file (keep private): ${credentialPath}`);
 console.log('Start the API with: npm run dev:server (repository root).');
}finally{await db.close();}
