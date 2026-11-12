import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalDatabase} from '../dist/database/local-database.js';
import {PickupService} from '../dist/pickup/pickup.service.js';

test('ETA proposals preserve reservations until the driver confirms and respect cooking lock',async()=>{
 const db=await LocalDatabase.open('memory://');
 try{
  const service=new PickupService(db);
  const {userId:owner}=await db.createLocalUser('점주');
  const {userId:driver}=await db.createLocalUser('운전자');
  const restaurant=await service.registerRestaurant(owner,{
   name:'식당',contactPhone:'+82212345678',address:'서울',maxConcurrentOrders:2,isAcceptingOrders:true,
   pickupLocations:[{name:'정문',address:'서울',latitude:37.5,longitude:127,isDefault:true,spaceCapacity:1,handoffMinutes:3}],
   menus:[{name:'비빔밥',priceKrw:9000}],
  });
  const place=()=>service.createOrder(driver,{
   restaurantId:restaurant.id,pickupLocationId:restaurant.pickupLocations[0].id,vehiclePlate:'12가3456',
   contactPhone:'+821012345678',requestKey:crypto.randomUUID(),items:[{menuId:restaurant.menus[0].id,quantity:1}],
  });
  const order=await place();
  const now=Date.now();
  const eta=(minutes,observedAt)=>({
   source:'MOCK',arrivalAt:new Date(now+minutes*60_000).toISOString(),observedAt:new Date(observedAt).toISOString(),
  });
  const mutation=expectedVersion=>({expectedVersion,requestKey:crypto.randomUUID()});
  const accepted=await service.acceptOrder(owner,order.id,{
   ...mutation(order.version),acceptedCookDurationMinutes:20,preparationBufferMinutes:2,eta:eta(60,now-2000),
  });
  const update={...mutation(accepted.version),eta:eta(70,now-1000)};
  const proposed=await service.updateEta(owner,order.id,update);
  assert.equal(proposed.etaProposal.pickupAt,update.eta.arrivalAt);
  assert.equal(proposed.etaProposal.cookingStartAt,new Date(now+48*60_000).toISOString());
  assert.deepEqual(proposed.pickupSpaceReservation,accepted.pickupSpaceReservation);
  assert.deepEqual(proposed.cookingReservation,accepted.cookingReservation);
  assert.deepEqual((await service.getOrder(driver,order.id)).etaProposal,proposed.etaProposal);
  await assert.rejects(service.confirmEta(owner,order.id,mutation(proposed.version)),{status:404});
  await assert.rejects(service.updateEta(owner,order.id,{
   ...mutation(proposed.version),eta:eta(75,now-1500),
  }),{status:409});
  const competitor=await place();
  const booked=await service.acceptOrder(owner,competitor.id,{
   ...mutation(competitor.version),acceptedCookDurationMinutes:20,preparationBufferMinutes:2,eta:eta(70,now-1000),
  });
  await assert.rejects(service.confirmEta(driver,order.id,mutation(proposed.version)),{status:409});
  const unchanged=await service.getOrder(driver,order.id);
  assert.deepEqual(unchanged.pickupSpaceReservation,accepted.pickupSpaceReservation);
  assert.deepEqual(unchanged.cookingReservation,accepted.cookingReservation);
  assert.equal(unchanged.version,proposed.version);
  const alternative=await service.updateEta(owner,order.id,{
   ...mutation(proposed.version),eta:eta(70,now-500),
  });
  assert.equal(Date.parse(alternative.etaProposal.pickupAt),Date.parse(update.eta.arrivalAt)+180_000);
  await service.applyLifecycle(owner,competitor.id,'cancel',mutation(booked.version));
  const confirm=mutation(alternative.version);
  const confirmed=await service.confirmEta(driver,order.id,confirm);
  assert.equal(new Date(confirmed.pickupSpaceReservation.startAt).toISOString(),alternative.etaProposal.pickupAt);
  assert.equal(confirmed.etaProposal,null);
  assert.equal((await service.getOrder(driver,order.id)).etaNeedsReview,false);
  assert.equal((await service.confirmEta(driver,order.id,confirm)).version,confirmed.version);
  const started=await service.applyLifecycle(owner,order.id,'start',mutation(confirmed.version));
  const late=await service.updateEta(owner,order.id,{...mutation(started.version),eta:eta(90,now)});
  assert.equal(late.etaProposal,null);
  assert.equal(late.etaNeedsReview,true);
  assert.deepEqual(late.cookingReservation,started.cookingReservation);
  assert.deepEqual(late.pickupSpaceReservation,started.pickupSpaceReservation);
 }finally{await db.close();}
});
