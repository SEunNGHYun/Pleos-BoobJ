import { createApp } from './app.js';
import { resolve } from 'node:path';
import { LocalDatabase } from './database/local-database.js';

async function main() {
 const port = Number(process.env.PORT ?? 3001);
 if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
 }
 const host = process.env.HOST ?? '127.0.0.1';
 if (process.env.LOCAL_DB_PATH && !['127.0.0.1','::1'].includes(host)) {
  throw new Error('Local developer APIs must bind to loopback');
 }
 const database=process.env.LOCAL_DB_PATH?await LocalDatabase.open(resolve(process.env.LOCAL_DB_PATH)):null;
 const app = await createApp({},database);
 try { await app.listen(port, host); } catch (error) { await app.close(); throw error; }
 console.log(`밥맞J API: ${await app.getUrl()}/api/health`);
}
main().catch((error: unknown) => {
 console.error(error instanceof Error ? error.message : 'Server startup failed');
 process.exitCode = 1;
});
