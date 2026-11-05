import { test } from 'node:test';
import assert from 'node:assert/strict';

test('HTTP health reports service availability without claiming database connectivity',async()=>{
 const { createApp } = await import('../dist/app.js');
 const previous = process.env.SUPABASE_URL;
 delete process.env.SUPABASE_URL;
 const app=await createApp({logger:false});
 try {
  await app.listen(0,'127.0.0.1');
  const base=await app.getUrl();
  const response=await fetch(`${base}/api/health`);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:'ok',service:'babmatj-server',database:'not_configured'});
  assert.equal((await fetch(`${base}/api/orders`)).status,404);
  assert.equal((await fetch(`${base}/api/orders`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,503);
 } finally {
  await app.close();
  if(previous===undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL=previous;
 }
});
