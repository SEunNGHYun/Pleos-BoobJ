import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { isHealthResponse } from '../contracts/dist/index.js';

async function freePort() {
 const socket=createServer();
 await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
 const port=socket.address().port;
 await new Promise(resolve=>socket.close(resolve)); return port;
}
async function stop(child) {
 if(child.exitCode!==null || child.signalCode!==null) return;
 const exit=once(child,'exit'); child.kill('SIGTERM');
 const timeout=setTimeout(()=>child.kill('SIGKILL'),5000); timeout.unref();
 try {await exit;} finally {clearTimeout(timeout);}
}
const apiPort=await freePort(),webPort=await freePort();
const apiUrl=`http://127.0.0.1:${apiPort}`,webUrl=`http://127.0.0.1:${webPort}`;
const children=[];
function launch(args,extra={}) {
 const child=spawn(process.execPath,args,{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});
 let log=''; child.stdout.on('data',chunk=>{log+=chunk;}); child.stderr.on('data',chunk=>{log+=chunk;});
 children.push(child); return {child,log:()=>log};
}
async function ready(url,processInfo) {
 for(let i=0;i<100;i++) {
  if(processInfo.child.exitCode!==null || processInfo.child.signalCode!==null) throw new Error(processInfo.log());
  try {const response=await fetch(url,{signal:AbortSignal.timeout(1000)});if(response.ok)return response;}catch{}
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 throw new Error(`Server did not become ready: ${url}\n${processInfo.log()}`);
}
try {
 const api=launch(['server/dist/main.js'],{PORT:String(apiPort),HOST:'127.0.0.1',SUPABASE_URL:''});
 await ready(`${apiUrl}/api/health`,api);
 const web=launch(['node_modules/next/dist/bin/next','start','restaurant-web','--hostname','127.0.0.1','--port',String(webPort)],{API_BASE_URL:apiUrl,NEXT_TELEMETRY_DISABLED:'1'});
 const page=await ready(webUrl,web);
 assert.match(await page.text(),/픽업 준비를 시작해볼까요/);
 const health=await fetch(`${webUrl}/api/health`);
 assert.equal(health.status,200);assert.ok(isHealthResponse(await health.json()));
 await stop(api.child);
 const unavailable=await fetch(`${webUrl}/api/health`);
 assert.equal(unavailable.status,503);assert.match((await unavailable.json()).message,/연결할 수 없습니다/);
 console.log('PASS: Next.js page, web → NestJS health, API outage response');
} finally {await Promise.all(children.map(stop));}
