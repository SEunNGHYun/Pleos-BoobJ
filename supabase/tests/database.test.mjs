import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../migrations/', import.meta.url);
async function database() {
  const db = new PGlite();
  // Test-only Supabase platform bootstrap. Never part of the production migration.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    grant usage on schema public to anon, authenticated, service_role;`);
  for (const name of (await readdir(migrations)).filter(n => n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  return db;
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(db, capacity = 2) {
  await db.query('insert into auth.users values ($1)', [id(1)]);
  await db.query('insert into public.users(id, contact_phone) values ($1, $2)', [id(1), '+821012345678']);
  await db.query(`insert into restaurants(id,name,contact_phone,address,max_concurrent_orders,is_accepting_orders)
    values ($1,'밥맞식당','+82212345678','서울', $2,true)`, [id(2),capacity]);
  await db.query(`insert into restaurant_pickup_locations(id,restaurant_id,name,address,latitude,longitude)
    values ($1,$2,'정문','서울 정문',37.5,127)`,[id(3),id(2)]);
}
async function order(db, key = crypto.randomUUID(), location = id(3)) {
  const r = await db.query(`select (public.create_pickup_order($1,$2,$3,$4,$5,$6,$7::jsonb)).id`,
    [id(1),id(2),location,'12가3456','+821012345678',key,
      JSON.stringify([{menu_name:'제육',quantity:1,unit_price_krw:10000}])]);
  return r.rows[0].id;
}
async function reserve(db, orderId, duration=10, minutes=30) {
  return db.query(`select (public.reserve_cooking($1,$2,now()+make_interval(mins=>$3),0)).*`,[orderId,duration,minutes]);
}
async function reject(db, sql, params, pattern) {
  await assert.rejects(db.query(sql,params),pattern);
}

test('schema, order snapshots, idempotency, input constraints and RLS', async () => {
  const db=await database();
  try {
    await fixture(db);
    const key=crypto.randomUUID(); const o=await order(db,key);
    assert.equal(await order(db,key),o);
    assert.equal((await db.query('select count(*)::int as n from order_items')).rows[0].n,1);
    await db.query("update restaurant_pickup_locations set name='변경' where id=$1",[id(3)]);
    assert.equal((await db.query('select pickup_name from orders where id=$1',[o])).rows[0].pickup_name,'정문');
    await reject(db,'update restaurants set max_concurrent_orders=0',[],/check constraint/);
    await reject(db,'update order_items set quantity=0',[],/check constraint/);
    await reject(db,'update orders set order_status=$1 where id=$2',['INVALID',o],/invalid input value/);
    await reject(db,'delete from restaurant_pickup_locations where id=$1',[id(3)],/foreign key constraint/);
    await reject(db,`select public.create_pickup_order($1,$2,$3,'12가3456','+821012345678',$4,'[]')`,[id(1),id(2),id(3),crypto.randomUUID()],/items/);
    const r=await db.query(`select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'`);
    assert.equal(r.rows.length,13); assert.ok(r.rows.every(x=>x.relrowsecurity));
    await db.exec('set role authenticated');
    await reject(db,'select * from orders',[],/permission denied/);
    await reject(db,'select * from pickup_space_reservations',[],/permission denied/);
    await reject(db,'select public.start_cooking($1)',[o],/permission denied/);
    await db.exec('reset role; set role service_role');
    await reject(db,"update orders set order_status='ACCEPTED' where id=$1",[o],/permission denied/);
    await db.query('select public.reserve_cooking($1,10,now()+interval \'30 minutes\',0)',[o]);
    await db.exec('reset role');
  } finally {await db.close();}
});

test('capacity shifts third reservation, rejects reduction, and releases cancelled capacity',async()=>{
 const db=await database(); try {
  await fixture(db); const a=await order(db), b=await order(db), c=await order(db);
  await db.exec('begin');
  await reserve(db,a); await reserve(db,b); await reserve(db,c);
  const r=(await db.query('select order_id,planned_start_at,planned_end_at from cooking_reservations order by planned_start_at')).rows;
  assert.equal(new Date(r[2].planned_start_at).getTime(),new Date(r[0].planned_end_at).getTime());
  await db.exec('commit');
  await reject(db,'update restaurants set max_concurrent_orders=1 where id=$1',[id(2)],/capacity/);
  await db.query("select close_pickup_order($1,'CANCELLED')",[a]);
  await reserve(db,c);
  const x=(await db.query('select planned_start_at from cooking_reservations where order_id=$1',[c])).rows[0];
  assert.ok(new Date(x.planned_start_at)<new Date(r[2].planned_start_at));
 } finally {await db.close();}
});

test('LOCK, actual concurrency, overruns and completion transitions',async()=>{
 const db=await database(); try {
  await fixture(db,1); const a=await order(db), b=await order(db);
  await reserve(db,a,10,1); await reserve(db,b,10,1);
  await db.query('select start_cooking($1)',[a]);
  await reject(db,'select start_cooking($1)',[b],/capacity/);
  await reject(db,'select reserve_cooking($1,10,now()+interval \'1 hour\',0)',[a],/LOCK/);
  await reject(db,"select close_pickup_order($1,'CANCELLED')",[a],/cooking/);
  await reject(db,"select close_pickup_order($1,'COMPLETED')",[a],/READY/);
  // Simulate an overrun using DB-owner-only fixture writes.
  await db.query("update orders set cooking_started_at=now()-interval '11 minutes', estimated_ready_at=now()-interval '1 minute' where id=$1",[a]);
  await reject(db,'select reserve_cooking($1,10,now()+interval \'30 minutes\',0)',[b],/capacity/);
  await db.query('select mark_order_ready($1)',[a]);
  await db.query('select start_cooking($1)',[b]);
  await db.query("select close_pickup_order($1,'COMPLETED')",[a]);
  assert.equal((await db.query('select order_status from orders where id=$1',[a])).rows[0].order_status,'COMPLETED');
 } finally {await db.close();}
});

test('duplicate completion preserves the original timestamp, version and reservation release',async()=>{
 const db=await database(); try {
  await fixture(db); const id=await order(db);
  await reserve(db,id);
  await db.query('select start_cooking($1)',[id]);
  await db.query('select mark_order_ready($1)',[id]);
  const snapshot=async()=> (await db.query(`select o.order_status,o.completed_at,o.version,c.released_at
    from orders o join cooking_reservations c on c.order_id=o.id where o.id=$1`,[id])).rows[0];
  await db.query("select close_pickup_order($1,'COMPLETED')",[id]);
  const first=await snapshot();
  assert.equal(first.order_status,'COMPLETED');
  assert.ok(first.completed_at);
  assert.ok(first.released_at);
  await db.query("select close_pickup_order($1,'COMPLETED')",[id]);
  assert.deepEqual(await snapshot(),first);
 } finally {await db.close();}
});

test('cross-restaurant pickup is rejected and inactive locations cannot accept new orders',async()=>{
 const db=await database(); try {
  await fixture(db);
  await db.query(`insert into restaurants(id,name,contact_phone,address) values ($1,'다른식당','+82200000000','서울')`,[id(4)]);
  await db.query(`insert into restaurant_pickup_locations(id,restaurant_id,name,address,latitude,longitude) values ($1,$2,'다른곳','서울',37,127)`,[id(5),id(4)]);
  await assert.rejects(order(db,crypto.randomUUID(),id(5)),/pickup/);
  await db.query('update restaurant_pickup_locations set is_active=false where id=$1',[id(3)]);
  await assert.rejects(order(db),/pickup/);
 } finally {await db.close();}
});

test('a failed booking leaves no accepted state and exact adjacent intervals share capacity',async()=>{
 const db=await database(); try {
  await fixture(db,1); const a=await order(db), b=await order(db);
  await db.exec('begin');
  await reserve(db,a,10,10); await reserve(db,b,10,10);
  const slots=(await db.query('select planned_start_at,planned_end_at from cooking_reservations order by planned_start_at')).rows;
  assert.equal(+slots[0].planned_end_at,+slots[1].planned_start_at);
  await db.exec('commit');
  const c=await order(db);
  await reject(db,"select reserve_cooking($1,10,now()+interval '8 days',0)",[c],/capacity/);
  const o=(await db.query('select order_status,cooking_status from orders where id=$1',[c])).rows[0];
  assert.deepEqual(o,{order_status:'PENDING',cooking_status:'UNSCHEDULED'});
  assert.equal((await db.query('select count(*)::int as n from cooking_reservations where order_id=$1',[c])).rows[0].n,0);
  await db.query("select close_pickup_order($1,'REJECTED')",[c]);
  await reject(db,"select reserve_cooking($1,10,now()+interval '1 hour',0)",[c],/closed/);
 } finally {await db.close();}
});

test('interval capacity checks the peak rather than total number of intersecting orders',async()=>{
 const db=await database(); try {
  await fixture(db,2); const a=await order(db), b=await order(db), c=await order(db);
  await db.exec('begin');
  await reserve(db,a,10,10); // now .. now+10
  await reserve(db,b,10,20); // now+10 .. now+20
  await reserve(db,c,20,20); // now .. now+20: only two at any point
  const slots=(await db.query('select order_id,planned_start_at from cooking_reservations')).rows;
  assert.equal(+slots.find(x=>x.order_id===a).planned_start_at,+slots.find(x=>x.order_id===c).planned_start_at);
  await db.exec('commit');
 } finally {await db.close();}
});

test('backend role can reduce unused capacity but cannot reduce booked capacity',async()=>{
 const db=await database(); try {
  await fixture(db,2);
  await db.exec('set role service_role');
  await db.query('update restaurants set max_concurrent_orders=1 where id=$1',[id(2)]);
  await db.query('update restaurants set max_concurrent_orders=2 where id=$1',[id(2)]);
  await db.exec('reset role');
  const a=await order(db),b=await order(db);
  await db.exec('begin'); await reserve(db,a); await reserve(db,b); await db.exec('commit');
  await db.exec('set role service_role');
  await reject(db,'update restaurants set max_concurrent_orders=1 where id=$1',[id(2)],/capacity reduction/);
  await db.exec('reset role');
 } finally {await db.close();}
});


test('a late cooking start atomically moves conflicting future reservations',async()=>{
 const db=await database(); try {
  await fixture(db,1); const a=await order(db), b=await order(db);
  await reserve(db,a,10,10); await reserve(db,b,10,15);
  await db.query("update cooking_reservations set planned_start_at=now()-interval '10 minutes',planned_end_at=now() where order_id=$1",[a]);
  await db.query('select start_cooking($1)',[a]);
  const row=(await db.query(`select r.planned_start_at,o.estimated_ready_at from cooking_reservations r
   cross join orders o where r.order_id=$1 and o.id=$2`,[b,a])).rows[0];
  assert.ok(+row.planned_start_at>=+row.estimated_ready_at,'confirmed next reservation must follow actual completion estimate');
 } finally {await db.close();}
});

test('pickup space blocks overlapping windows, early and late entry, and releases atomically',async()=>{
 const db=await database();try{
  await fixture(db);
  const first=await order(db), second=await order(db);
  await reserve(db,first);await reserve(db,second);
  const insert=(orderId,start,end)=>db.query(`insert into pickup_space_reservations
   (order_id,location_id,space_number,start_at,end_at)
   values ($1,$2,1,now()+make_interval(mins=>$3),now()+make_interval(mins=>$4))`,[orderId,id(3),start,end]);
  await insert(first,10,13);
  await assert.rejects(insert(second,11,14),/pickup space conflict/);
  await reject(db,'select occupy_pickup_space($1)',[first],/early/);
  await db.query("select close_pickup_order($1,'CANCELLED')",[first]);
  await insert(second,-4,-1);
  await reject(db,'select occupy_pickup_space($1)',[second],/late/);
  await db.query("select close_pickup_order($1,'CANCELLED')",[second]);
  const third=await order(db), fourth=await order(db);
  await reserve(db,third);await reserve(db,fourth);
  await insert(third,-1,2);
  await db.query('select occupy_pickup_space($1)',[third]);
  await db.query('select occupy_pickup_space($1)',[third]);
  await assert.rejects(insert(fourth,30,33),/pickup space conflict/);
  await reject(db,"select close_pickup_order($1,'CANCELLED')",[third],/occupied/);
  await db.query('select start_cooking($1)',[third]);
  await reject(db,"select reserve_cooking($1,10,now()+interval '1 hour',0)",[third],/LOCK/);
  await db.query('select mark_order_ready($1)',[third]);
  const close="select (close_pickup_order($1,'COMPLETED')).version";
  const completed=await db.query(close,[third]);
  assert.deepEqual((await db.query(close,[third])).rows,completed.rows);
  assert.equal((await db.query('select status from pickup_space_reservations where order_id=$1',[third])).rows[0].status,'RELEASED');
  await insert(fourth,30,33);
 }finally{await db.close();}
});
