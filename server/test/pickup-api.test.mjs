import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function fixture(dataDir = 'memory://') {
 const {LocalDatabase}=await import('../dist/database/local-database.js');
 const {createApp}=await import('../dist/app.js');
 const db=await LocalDatabase.open(dataDir);
 const owner=await db.createLocalUser('점주');
 const customer=await db.createLocalUser('고객');
 const outsider=await db.createLocalUser('다른 고객');
 const app=await createApp({logger:false},db);
 await app.listen(0,'127.0.0.1'); const base=await app.getUrl();
 const request=async(method,path,actor,body)=>{
  const response=await fetch(`${base}/api${path}`,{method,
   headers:{'Content-Type':'application/json',...(actor?{Authorization:`Bearer ${actor.token}`}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
 };
 return {db,app,owner,customer,outsider,request,close:async()=>{await app.close();}};
}
const restaurant=()=>({name:'밥맞식당',contactPhone:'+82212345678',address:'서울시',maxConcurrentOrders:2,
 isAcceptingOrders:true,pickupLocations:[
  {name:'정문',address:'정문 주차장',latitude:37.5,longitude:127,isDefault:true},
  {name:'후문',address:'후문 픽업존',latitude:37.51,longitude:127.01,instructions:'주차구역에서 수령'}],
 menus:[{name:'제육',priceKrw:10000},{name:'비빔밥',priceKrw:9000}]});
const order=(r)=>({restaurantId:r.id,pickupLocationId:r.pickupLocations[1].id,vehiclePlate:'12가3456',
 contactPhone:'+821012345678',requestKey:crypto.randomUUID(),items:[{menuId:r.menus[0].id,quantity:2}]});

test('register restaurant and create an order with selected pickup snapshot and server-priced items',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('GET','/health',null)).body.database,'local_ready');
  const created=await f.request('POST','/restaurants',f.owner,restaurant());assert.equal(created.status,201);
  const r=created.body;assert.equal(r.pickupLocations.length,2);assert.equal(r.menus.length,2);
  assert.equal((await f.request('GET',`/restaurants/${r.id}/pickup-locations`,f.customer)).status,200);
  const availableMenus=(await f.request('GET',`/restaurants/${r.id}/menus`,f.customer)).body;
  assert.equal(availableMenus.find(m=>m.id===r.menus[0].id).priceKrw,10000);
  const input=order(r);const placed=await f.request('POST','/orders',f.customer,input);
  assert.equal(placed.status,201);assert.equal(placed.body.orderStatus,'PENDING');
  assert.equal(placed.body.cookingStatus,'UNSCHEDULED');assert.equal(placed.body.vehicleStatus,'UNKNOWN');
  assert.equal(placed.body.userId,f.customer.userId);assert.equal(placed.body.items[0].unitPriceKrw,10000);
  assert.equal(placed.body.pickupLocation.name,'후문');
  const pickup=await f.request('GET',`/orders/${placed.body.id}/pickup-location`,f.customer);
  assert.equal(pickup.status,200);assert.equal(pickup.body.id,input.pickupLocationId);
  assert.equal((await f.request('GET',`/orders/${placed.body.id}`,f.owner)).status,200);
  await f.db.withServerRole(tx=>tx.query("update restaurant_pickup_locations set name='변경',is_active=false where id=$1",[input.pickupLocationId]));
  assert.equal((await f.request('GET',`/orders/${placed.body.id}/pickup-location`,f.customer)).body.name,'후문');
  await f.db.withServerRole(tx=>tx.query("update menus set name='변경 메뉴',price_krw=12000 where id=$1",[r.menus[0].id]));
  const replay=await f.request('POST','/orders',f.customer,input);assert.equal(replay.body.id,placed.body.id);
  assert.equal(replay.body.items[0].menuName,'제육');assert.equal(replay.body.items[0].unitPriceKrw,10000);
  assert.equal((await f.request('POST','/orders',f.customer,{...input,vehiclePlate:'34나5678'})).status,409);
 }finally{await f.close();}
});

test('authentication, ownership and strict input validation prevent forged orders and data access',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('POST','/restaurants',null,restaurant())).status,401);
  assert.equal((await f.request('POST','/restaurants',{token:'invalid'},restaurant())).status,401);
  assert.equal((await f.request('POST','/restaurants',f.owner,{...restaurant(),maxConcurrentOrders:0})).status,400);
  const bad=restaurant();bad.pickupLocations[0].latitude=100;
  assert.equal((await f.request('POST','/restaurants',f.owner,bad)).status,400);
  const r=(await f.request('POST','/restaurants',f.owner,restaurant())).body;
  assert.equal((await f.request('POST','/orders',f.customer,{...order(r),userId:f.owner.userId})).status,400);
  const forged=order(r);forged.items[0].unitPriceKrw=1;
  assert.equal((await f.request('POST','/orders',f.customer,forged)).status,400);
  const placed=(await f.request('POST','/orders',f.customer,order(r))).body;
  assert.equal((await f.request('GET',`/orders/${placed.id}/pickup-location`,f.outsider)).status,404);
  assert.equal((await f.request('GET',`/orders/${crypto.randomUUID()}/pickup-location`,f.customer)).status,404);
  assert.equal((await f.request('GET','/orders/not-a-uuid/pickup-location',f.customer)).status,400);
 }finally{await f.close();}
});

test('cross-restaurant selections, inactive menus and closed restaurants reject without saving orders',async()=>{
 const f=await fixture();try{
  const a=(await f.request('POST','/restaurants',f.owner,restaurant())).body;
  const b=(await f.request('POST','/restaurants',f.owner,restaurant())).body;
  assert.equal((await f.request('POST','/orders',f.customer,{...order(a),pickupLocationId:b.pickupLocations[0].id})).status,400);
  const wrong=order(a);wrong.items[0].menuId=b.menus[0].id;
  assert.equal((await f.request('POST','/orders',f.customer,wrong)).status,400);
  await f.db.withServerRole(tx=>tx.query('update menus set is_available=false where id=$1',[a.menus[0].id]));
  assert.equal((await f.request('POST','/orders',f.customer,order(a))).status,400);
  await f.db.withServerRole(tx=>tx.query('update restaurants set is_accepting_orders=false where id=$1',[b.id]));
  assert.equal((await f.request('POST','/orders',f.customer,order(b))).status,409);
  const count=await f.db.withServerRole(tx=>tx.query('select count(*)::int as n from orders'));
  assert.equal(count.rows[0].n,0);
  const dup=restaurant();dup.pickupLocations[1].isDefault=true;
  assert.equal((await f.request('POST','/restaurants',f.owner,dup)).status,400);
  assert.equal((await f.db.withServerRole(tx=>tx.query('select count(*)::int as n from restaurants'))).rows[0].n,2);
 }finally{await f.close();}
});

test('local database persists orders and migration history across reopen',async()=>{
 const {LocalDatabase}=await import('../dist/database/local-database.js');
 const {createApp}=await import('../dist/app.js');
 const path=await mkdtemp(join(tmpdir(),'babmatj-api-')); let f,app,db;
 try{
  f=await fixture(join(path,'db'));
  const r=(await f.request('POST','/restaurants',f.owner,restaurant())).body;
  const o=(await f.request('POST','/orders',f.customer,order(r))).body;
  const customer=f.customer;await f.close();f=null;
  db=await LocalDatabase.open(join(path,'db'));
  assert.equal(await db.authenticate(customer.token),customer.userId);
  app=await createApp({logger:false},db);await app.listen(0,'127.0.0.1');
  const response=await fetch(`${await app.getUrl()}/api/orders/${o.id}/pickup-location`,{headers:{Authorization:`Bearer ${customer.token}`}});
  assert.equal(response.status,200);assert.equal((await response.json()).name,'후문');
 }finally{if(f)await f.close();if(app)await app.close();else if(db)await db.close();await rm(path,{recursive:true,force:true});}
});

test('local development authentication and DB cannot be enabled in production',async()=>{
 const {LocalDatabase}=await import('../dist/database/local-database.js');
 const previous=process.env.NODE_ENV;
 try{process.env.NODE_ENV='production';await assert.rejects(LocalDatabase.open('memory://'),/disabled in production/);}
 finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('minimal order creation requirements: HTTP results and persisted database state',async(t)=>{
 const f=await fixture();try{
  const r=(await f.request('POST','/restaurants',f.owner,restaurant())).body;
  const other=(await f.request('POST','/restaurants',f.owner,restaurant())).body;
  let created,input;
  const counts=async()=>f.db.withServerRole(async tx=>({
   orders:(await tx.query('select count(*)::int as n from orders')).rows[0].n,
   items:(await tx.query('select count(*)::int as n from order_items')).rows[0].n,
   reservations:(await tx.query('select count(*)::int as n from cooking_reservations')).rows[0].n,
  }));
  await t.test('valid menu quantities save the selected pickup and initial statuses and return order ID',async()=>{
   input=order(r);input.items.push({menuId:r.menus[1].id,quantity:1});
   const response=await f.request('POST','/orders',f.customer,input);
   assert.equal(response.status,201);created=response.body;
   assert.match(created.id,/^[0-9a-f-]{36}$/);
   assert.equal(created.orderStatus,'PENDING');
   assert.equal(created.cookingStatus,'UNSCHEDULED');assert.equal(created.vehicleStatus,'UNKNOWN');
   assert.equal(created.totalPriceKrw,29000);
   const saved=await f.db.withServerRole(tx=>tx.query(`select user_id,restaurant_id,pickup_location_id,
    order_status,cooking_status,vehicle_status from orders where id=$1`,[created.id]));
   assert.deepEqual(saved.rows[0],{user_id:f.customer.userId,restaurant_id:r.id,pickup_location_id:input.pickupLocationId,
    order_status:'PENDING',cooking_status:'UNSCHEDULED',vehicle_status:'UNKNOWN'});
   const items=await f.db.withServerRole(tx=>tx.query('select menu_name_snapshot,quantity from order_items where order_id=$1 order by menu_name_snapshot',[created.id]));
   assert.deepEqual(items.rows,[{menu_name_snapshot:'비빔밥',quantity:1},{menu_name_snapshot:'제육',quantity:2}]);
   assert.deepEqual(await counts(),{orders:1,items:2,reservations:0});
  });
  const invalid=async(payload)=>{
   const before=await counts();const result=await f.request('POST','/orders',f.customer,payload);
   assert.equal(result.status,400);assert.deepEqual(await counts(),before);
  };
  await t.test('nonexistent but well-formed menu UUID is rejected without saving any order or item',async()=>{
   const payload=order(r);payload.items[0].menuId=crypto.randomUUID();await invalid(payload);
  });
  await t.test('quantity zero and negative quantity are rejected without database changes',async()=>{
   for(const quantity of [0,-1]){const payload=order(r);payload.items[0].quantity=quantity;await invalid(payload);}
  });
  await t.test('empty order items are rejected without database changes',async()=>{
   await invalid({...order(r),items:[]});
  });
  await t.test('pickup location belonging to a different restaurant is rejected',async()=>{
   await invalid({...order(r),pickupLocationId:other.pickupLocations[0].id});
  });
  await t.test('same request key replays the order; changed payload conflicts without duplicate rows',async()=>{
   const before=await counts();
   const replay=await f.request('POST','/orders',f.customer,input);
   assert.equal(replay.status,201);assert.equal(replay.body.id,created.id);assert.equal(replay.body.orderStatus,'PENDING');
   const conflict=structuredClone(input);conflict.items[0].quantity=3;
   assert.equal((await f.request('POST','/orders',f.customer,conflict)).status,409);
   assert.deepEqual(await counts(),before);
  });
 }finally{await f.close();}
});

test('restaurant receipt: own list, acceptance and rejection with atomic cooking reservations',async()=>{
 const f=await fixture();try{
  const r=(await f.request('POST','/restaurants',f.owner,restaurant())).body;
  const a=(await f.request('POST','/orders',f.customer,order(r))).body;
  const b=(await f.request('POST','/orders',f.customer,order(r))).body;
  const list=await f.request('GET',`/restaurants/${r.id}/orders?status=PENDING&limit=1&offset=0`,f.owner);
  assert.equal(list.status,200);assert.equal(list.body.items.length,1);assert.equal(list.body.total,2);
  assert.ok(list.body.items[0].contactPhone);assert.ok(list.body.items[0].pickupLocation.id);
  assert.equal((await f.request('GET',`/restaurants/${r.id}/orders`,f.customer)).status,404);
  assert.equal((await f.request('GET',`/restaurants/${r.id}/orders?limit=0`,f.owner)).status,400);
  const input={acceptedCookDurationMinutes:20,expectedVersion:0,requestKey:crypto.randomUUID(),
   eta:{source:'MOCK',arrivalAt:new Date(Date.now()+60*60*1000).toISOString(),observedAt:new Date().toISOString()}};
  const accepted=await f.request('POST',`/orders/${a.id}/accept`,f.owner,input);
  assert.equal(accepted.status,200);assert.equal(accepted.body.orderStatus,'ACCEPTED');
  assert.equal(accepted.body.cookingStatus,'SCHEDULED');assert.equal(accepted.body.version,1);
  assert.equal(accepted.body.acceptedCookDurationMinutes,20);assert.equal(accepted.body.eta.source,'MOCK');
  assert.ok(accepted.body.cookingReservation.plannedStartAt);assert.equal(accepted.body.pickupSpaceReservationStatus,'NOT_IMPLEMENTED');
  const replay=await f.request('POST',`/orders/${a.id}/accept`,f.owner,input);
  assert.equal(replay.status,200);assert.deepEqual(replay.body,accepted.body);
  assert.equal((await f.request('POST',`/orders/${a.id}/accept`,f.owner,{...input,acceptedCookDurationMinutes:25})).status,409);
  assert.equal((await f.request('POST',`/orders/${a.id}/accept`,f.owner,{...input,requestKey:crypto.randomUUID()})).status,409);
  assert.equal((await f.request('GET',`/orders/${a.id}`,f.customer)).body.eta.source,'MOCK');
  const reject={expectedVersion:0,requestKey:crypto.randomUUID(),reason:'재료 소진'};
  const rejected=await f.request('POST',`/orders/${b.id}/reject`,f.owner,reject);
  assert.equal(rejected.status,200);assert.equal(rejected.body.orderStatus,'REJECTED');assert.equal(rejected.body.version,1);
  assert.equal((await f.request('GET',`/orders/${b.id}`,f.customer)).body.rejectionReason,'재료 소진');
  assert.equal((await f.request('GET',`/restaurants/${r.id}/orders?status=REJECTED`,f.owner)).body.items[0].rejectionReason,'재료 소진');
  assert.equal((await f.request('POST',`/orders/${b.id}/reject`,f.owner,reject)).status,200);
  assert.equal((await f.request('GET',`/restaurants/${r.id}/orders?status=PENDING`,f.owner)).body.total,0);
  const rows=await f.db.withServerRole(tx=>tx.query('select count(*)::int as n from cooking_reservations'));
  assert.equal(rows.rows[0].n,1);
 }finally{await f.close();}
});

test('restaurant receipt rejects unauthorized, invalid or missing ETA and rolls back booking failures',async()=>{
 const f=await fixture();try{
  const r=(await f.request('POST','/restaurants',f.owner,restaurant())).body;
  const o=(await f.request('POST','/orders',f.customer,order(r))).body;
  const input={acceptedCookDurationMinutes:20,expectedVersion:0,requestKey:crypto.randomUUID(),
   eta:{source:'MOCK',arrivalAt:new Date(Date.now()+3600000).toISOString(),observedAt:new Date().toISOString()}};
  assert.equal((await f.request('POST',`/orders/${o.id}/accept`,f.customer,input)).status,404);
  assert.equal((await f.request('POST',`/orders/${o.id}/accept`,f.owner,{...input,eta:undefined})).status,422);
  assert.equal((await f.request('POST',`/orders/${o.id}/accept`,f.owner,{...input,acceptedCookDurationMinutes:0})).status,400);
  assert.equal((await f.request('POST',`/orders/${o.id}/accept`,f.owner,{...input,expectedVersion:1})).status,409);
  const stale={...input,eta:{...input.eta,observedAt:new Date(Date.now()-10*60000).toISOString()}};
  assert.equal((await f.request('POST',`/orders/${o.id}/accept`,f.owner,stale)).status,422);
  assert.equal((await f.request('POST',`/orders/${o.id}/accept`,f.owner,{...input,eta:{...input.eta,source:'VEHICLE'}})).status,400);
  const far={...input,eta:{...input.eta,arrivalAt:new Date(Date.now()+8*86400000).toISOString()}};
  assert.equal((await f.request('POST',`/orders/${o.id}/accept`,f.owner,far)).status,409);
  const before=await f.request('GET',`/orders/${o.id}`,f.customer);
  assert.equal(before.body.orderStatus,'PENDING');assert.equal(before.body.version,0);assert.equal(before.body.cookingReservation,null);
  const count=await f.db.withServerRole(tx=>tx.query('select count(*)::int as n from restaurant_order_actions'));
  assert.equal(count.rows[0].n,0);
  const results=await Promise.all([0,1].map(()=>f.request('POST',`/orders/${o.id}/accept`,f.owner,{...input,requestKey:crypto.randomUUID()})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const final=await f.db.withServerRole(tx=>tx.query('select count(*)::int as n from cooking_reservations where order_id=$1',[o.id]));
  assert.equal(final.rows[0].n,1);
 }finally{await f.close();}
});

test('restaurant receipt idempotency survives DB reopen',async()=>{
 const {LocalDatabase}=await import('../dist/database/local-database.js');
 const {createApp}=await import('../dist/app.js');
 const path=await mkdtemp(join(tmpdir(),'babmatj-receipt-'));let f,db,app;
 try{
  f=await fixture(join(path,'db'));const owner=f.owner;
  const r=(await f.request('POST','/restaurants',owner,restaurant())).body;
  const o=(await f.request('POST','/orders',f.customer,order(r))).body;
  const input={acceptedCookDurationMinutes:20,expectedVersion:0,requestKey:crypto.randomUUID(),
   eta:{source:'MOCK',arrivalAt:new Date(Date.now()+3600000).toISOString(),observedAt:new Date().toISOString()}};
  const accepted=await f.request('POST',`/orders/${o.id}/accept`,owner,input);assert.equal(accepted.status,200);
  await f.close();f=null;db=await LocalDatabase.open(join(path,'db'));
  app=await createApp({logger:false},db);await app.listen(0,'127.0.0.1');
  const replay=await fetch(`${await app.getUrl()}/api/orders/${o.id}/accept`,{method:'POST',
   headers:{'Content-Type':'application/json',Authorization:`Bearer ${owner.token}`},body:JSON.stringify(input)});
  assert.equal(replay.status,200);assert.deepEqual(await replay.json(),accepted.body);
  assert.equal((await db.withServerRole(tx=>tx.query('select count(*)::int as n from cooking_reservations'))).rows[0].n,1);
 }finally{if(f)await f.close();if(app)await app.close();else if(db)await db.close();await rm(path,{recursive:true,force:true});}
});
