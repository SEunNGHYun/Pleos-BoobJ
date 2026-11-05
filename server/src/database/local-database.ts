import { PGlite, type Transaction } from '@electric-sql/pglite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OnApplicationShutdown } from '@nestjs/common';

const migrations = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const DATABASE = Symbol('LOCAL_DATABASE');
export class LocalDatabase implements OnApplicationShutdown {
 private constructor(private readonly db: PGlite) {}
 static async open(dataDir: string): Promise<LocalDatabase> {
  if (process.env.NODE_ENV === 'production') throw new Error('Local developer database is disabled in production');
  const db = new PGlite(dataDir);
  try {
   await db.exec(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
   end $$;
   create schema if not exists auth;
   create table if not exists auth.users(id uuid primary key);
   grant usage on schema public to anon,authenticated,service_role;
   create schema if not exists local_development;
   revoke all on schema local_development from public,anon,authenticated,service_role;
   create table if not exists local_development.migrations(name text primary key, checksum text not null);
   create table if not exists local_development.tokens(token_hash text primary key,user_id uuid not null references auth.users(id));`);
   for (const name of (await readdir(migrations)).filter(n => n.endsWith('.sql')).sort()) {
    const sql=await readFile(join(migrations,name), 'utf8');
    const hash=digest(sql);
    const prior=await db.query<{checksum:string}>('select checksum from local_development.migrations where name=$1',[name]);
    if (prior.rows[0]) {
     if(prior.rows[0].checksum!==hash) throw new Error(`Applied migration changed: ${name}`);
     continue;
    }
    // Existing migration files have their own BEGIN/COMMIT; journal atomically with the DDL.
    const body=sql.replace(/^\s*begin\s*;/i,'').replace(/commit\s*;\s*$/i,'');
    await db.transaction(async tx=>{
     await tx.exec(body);
     await tx.query('insert into local_development.migrations values ($1,$2)',[name,hash]);
    });
   }
   return new LocalDatabase(db);
  } catch(error) {await db.close();throw error;}
 }
 async withServerRole<T>(work: (tx: Transaction)=>Promise<T>):Promise<T> {
  return this.db.transaction(async tx=>{await tx.exec('set local role service_role');return work(tx);});
 }
 async createLocalUser(displayName:string):Promise<{userId:string;token:string}> {
  const userId=randomUUID(),token=randomBytes(32).toString('hex');
  await this.db.transaction(async tx=>{
   await tx.query('insert into auth.users(id) values ($1)',[userId]);
   await tx.query('insert into public.users(id,display_name) values ($1,$2)',[userId,displayName]);
   await tx.query('insert into local_development.tokens values ($1,$2)',[digest(token),userId]);
  });
  return {userId,token};
 }
 async authenticate(token:string):Promise<string|null> {
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  const result=await this.db.query<{user_id:string}>('select user_id from local_development.tokens where token_hash=$1',[digest(token)]);
  return result.rows[0]?.user_id??null;
 }
 async close(){if(!this.db.closed)await this.db.close();}
 async onApplicationShutdown(){await this.close();}
}
