import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { Transaction } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { DATABASE, LocalDatabase } from '../database/local-database.js';
import type { RestaurantInput, OrderInput, ReceiptInput, RejectionInput, RestaurantOrdersQuery, LifecycleAction, LifecycleInput, EtaUpdateInput, RouteRankingInput } from './input.js';

import { waypointRoute } from './waypoint-routing.js';
import { planPickup } from './pickup-planning.js';

type SpaceRow = {
 order_id: string; space_number: number; start_at: string; end_at: string;
 status: 'RESERVED' | 'OCCUPIED' | 'RELEASED';
};

type Proposal={pickupAt:string;cookingStartAt:string};
type EtaAction={request_payload:EtaUpdateInput;response:{version:number;etaProposal:Proposal|null}};
type Row=Record<string,unknown>;
const pickup=(r:Row)=>({id:r.id,name:r.name,address:r.address,latitude:r.latitude,longitude:r.longitude,instructions:r.instructions??null,isDefault:r.is_default,spaceCapacity:r.space_capacity,handoffMinutes:r.handoff_minutes});
const menu=(r:Row)=>({id:r.id,name:r.name,priceKrw:Number(r.price_krw),baseCookMinutes:r.base_cook_minutes as number|null,imageData:r.image_data as string??null});
@Injectable()
export class PickupService {
 constructor(@Inject(DATABASE)private readonly db:LocalDatabase|null){}
 private async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
  if(!this.db)throw new ServiceUnavailableException('DB가 연결되지 않았습니다.');
  try{return await this.db.withServerRole(work);}catch(error){
   if(error instanceof Error && 'code' in error){
    const code=String(error.code);
    if(code==='P0001'){
     if(/idempotency/.test(error.message))throw new ConflictException('같은 요청 키로 다른 주문을 생성할 수 없습니다.');
     if(/not accepting/.test(error.message))throw new ConflictException('현재 주문을 받지 않는 식당입니다.');
     if(/pickup space conflict/.test(error.message))throw new ConflictException({code:'PICKUP_CONFLICT',message:'픽업 공간이 이미 배정되었습니다.',availableAtEta:false,alternativePickupAt:null});
     if(/arrival is early/.test(error.message))throw new ConflictException('예약 시각 전에 입장할 수 없습니다.');
     if(/arrival is late/.test(error.message))throw new ConflictException('예약 시간이 지났습니다.');
     if(/READY required|pickup reservation required|occupied pickup space/.test(error.message))throw new ConflictException('준비 완료 및 픽업 공간 상태를 확인해주세요.');
     if(/capacity|LOCK|closed|pending|cooking|accepted|scheduled/.test(error.message))throw new ConflictException('현재 주문 상태 또는 조리 수용량으로 처리할 수 없습니다.');
     if(/restaurant not found/.test(error.message))throw new NotFoundException('식당을 찾을 수 없습니다.');
     throw new BadRequestException('메뉴 또는 픽업 위치를 확인해주세요.');
    }
    if(['23503','23514','23502','22P02'].includes(code))throw new BadRequestException('입력값 또는 참조 정보를 확인해주세요.');
    if(code==='23505')throw new ConflictException('중복된 정보가 있습니다.');
   }
   throw error;
  }
 }
 async registerRestaurant(actor:string,input:RestaurantInput){
  return this.transaction(async tx=>{
   const result=await tx.query<Row>(`insert into restaurants(name,contact_phone,address,max_concurrent_orders,is_accepting_orders,food_category)
    values ($1,$2,$3,$4,$5,$6) returning *`,[input.name,input.contactPhone,input.address,input.maxConcurrentOrders,input.isAcceptingOrders,input.foodCategory??"기타"]);
   const r=result.rows[0],locations:Row[]=[],menus:Row[]=[];
   await tx.query("insert into restaurant_members(restaurant_id,user_id,role) values ($1,$2,'OWNER')",[r.id,actor]);
   if(input.imageData)await tx.query('insert into restaurant_images values ($1,$2)',[r.id,input.imageData]);
   for(const p of input.pickupLocations){
    const row=await tx.query<Row>(`insert into restaurant_pickup_locations(restaurant_id,name,address,latitude,longitude,instructions,is_default,space_capacity,handoff_minutes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[r.id,p.name,p.address,p.latitude,p.longitude,p.instructions??null,p.isDefault,p.spaceCapacity,p.handoffMinutes]);
    locations.push(row.rows[0]);
   }
   for(const m of input.menus){
    const row=await tx.query<Row>('insert into menus(restaurant_id,name,price_krw,base_cook_minutes) values($1,$2,$3,$4) returning *',[r.id,m.name,m.priceKrw,m.baseCookMinutes??null]);
    if(m.imageData)await tx.query('insert into menu_images values ($1,$2)',[row.rows[0].id,m.imageData]);
    menus.push({...row.rows[0],image_data:m.imageData});
   }
   return {id:r.id,name:r.name,contactPhone:r.contact_phone,address:r.address,maxConcurrentOrders:r.max_concurrent_orders,
    isAcceptingOrders:r.is_accepting_orders,foodCategory:r.food_category,pickupLocations:locations.map(pickup),menus:menus.map(menu)};
  });
 }
 async listPickupMenuNames(){return this.transaction(async tx=>{
  const result=await tx.query<{name:string}>(`select distinct m.name from menus m join restaurants r on r.id=m.restaurant_id
   where m.is_available and r.is_accepting_orders and exists(
    select 1 from restaurant_pickup_locations p where p.restaurant_id=r.id and p.is_active)
   order by m.name`);
  return result.rows.map(row=>row.name);
 });}
 async rankPickupRestaurants(input:RouteRankingInput){
  const candidates=await this.transaction(async tx=>{
   const result=await tx.query<{restaurantId:string;restaurantName:string;menuId:string;pickupLocationId:string;imageData:string|null;latitude:number;longitude:number}>(`
    select distinct on (r.id) r.id as "restaurantId", r.name as "restaurantName", m.id as "menuId",
     p.id as "pickupLocationId", i.image_data as "imageData", p.latitude::float8 as latitude, p.longitude::float8 as longitude
    from restaurants r join menus m on m.restaurant_id=r.id
    join restaurant_pickup_locations p on p.restaurant_id=r.id
    left join restaurant_images i on i.restaurant_id=r.id
    where r.is_accepting_orders and m.is_available and ($1::text is null or m.name=$1)
    and ($2::text is null or r.food_category=$2) and p.is_active
    order by r.id,p.is_default desc,p.id,m.id`,[input.menuName??null,input.foodCategory??null]);
   return result.rows.sort((a,b)=>a.restaurantName.localeCompare(b.restaurantName,'ko'));
  });
  const key=process.env.KAKAO_FREE_ROUTING_KEY?.trim();
  const route=input.route;
  // Bound the number of provider calls per search. Other restaurants remain selectable.
  const options=await Promise.all(candidates.map(async (candidate,index)=>{
   const estimate=key&&route&&index<5
    ?await waypointRoute(route.origin,route.destination,candidate,key):null;
   return {...candidate,distanceMeters:estimate?.distanceMeters??null,durationSeconds:estimate?.durationSeconds??null};
  }));
  return options.sort((a,b)=>(a.distanceMeters??Infinity)-(b.distanceMeters??Infinity));
 }
 async listLocations(restaurantId:string){return this.transaction(async tx=>{
  await this.requireRestaurant(tx,restaurantId);
  const r=await tx.query<Row>('select * from restaurant_pickup_locations where restaurant_id=$1 and is_active order by created_at,id',[restaurantId]);
  return r.rows.map(pickup);
 });}
 async listMenus(restaurantId:string){return this.transaction(async tx=>{
  await this.requireRestaurant(tx,restaurantId);
  const r=await tx.query<Row>('select m.*,i.image_data from menus m left join menu_images i on i.menu_id=m.id where m.restaurant_id=$1 and m.is_available order by m.created_at,m.id',[restaurantId]);
  return r.rows.map(menu);
 });}
 async setMenuImage(actor:string,restaurantId:string,menuId:string,imageData:string|null){
  return this.transaction(async tx=>{
   await this.requireMember(tx,actor,restaurantId);
   const menu=await tx.query('select id from menus where id=$1 and restaurant_id=$2',[menuId,restaurantId]);
   if(!menu.rows.length)throw new NotFoundException('메뉴를 찾을 수 없습니다.');
   if(imageData===null)await tx.query('delete from menu_images where menu_id=$1',[menuId]);
   else await tx.query(`insert into menu_images values ($1,$2)
    on conflict(menu_id) do update set image_data=excluded.image_data`,[menuId,imageData]);
   return {id:menuId,imageData};
  });
 }
 private async requireRestaurant(tx:Transaction,id:string){
  if(!(await tx.query('select id from restaurants where id=$1',[id])).rows.length)throw new NotFoundException('식당을 찾을 수 없습니다.');
 }
 async createOrder(actor:string,input:OrderInput){
  return this.transaction(async tx=>{
   const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
   const result=await tx.query<Row>(`select * from create_menu_pickup_order($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [actor,input.restaurantId,input.pickupLocationId,input.vehiclePlate,input.contactPhone,input.requestKey,JSON.stringify(input.items),fingerprint]);
   return this.orderResponse(tx,result.rows[0]);
  });
 }
 async getOrder(actor:string,orderId:string){return this.transaction(async tx=>{
  const result=await tx.query<Row>(`select o.* from orders o where o.id=$1 and (o.user_id=$2 or exists(
   select 1 from restaurant_members m where m.restaurant_id=o.restaurant_id and m.user_id=$2))`,[orderId,actor]);
  if(!result.rows[0])throw new NotFoundException('주문을 찾을 수 없습니다.');
  return this.orderResponse(tx,result.rows[0]);
 });}
 async listManagedRestaurants(actor: string) {
  return this.transaction(async tx => {
   const result = await tx.query<{id: string; name: string; address: string}>(`
    select r.id, r.name, r.address
    from restaurant_members m
    join restaurants r on r.id = m.restaurant_id
    where m.user_id = $1 and m.role in ('OWNER', 'STAFF')
    order by r.name, r.address, r.id
   `, [actor]);
   return result.rows;
  });
 }
 async listRestaurantOrders(actor:string,restaurantId:string,query:RestaurantOrdersQuery){
  return this.transaction(async tx=>{
   await this.requireMember(tx,actor,restaurantId);
   const where='restaurant_id=$1 and ($2::text is null or order_status::text=$2)';
   const rows=await tx.query<Row>(`select * from orders where ${where} order by created_at desc,id desc limit $3 offset $4`,[restaurantId,query.status??null,query.limit,query.offset]);
   const total=await tx.query<{n:number}>(`select count(*)::int as n from orders where ${where}`,[restaurantId,query.status??null]);
   const items=[];for(const row of rows.rows)items.push(await this.orderResponse(tx,row));
   return {items,total:total.rows[0].n,limit:query.limit,offset:query.offset};
  });
 }
 private async requireMember(tx:Transaction,actor:string,restaurantId:unknown){
  const member=await tx.query("select user_id from restaurant_members where user_id=$1 and restaurant_id=$2 and role in ('OWNER','STAFF') for share",[actor,restaurantId]);
  if(!member.rows.length)throw new NotFoundException('식당 또는 주문을 찾을 수 없습니다.');
 }
 private async lockedOrder(tx:Transaction,actor:string,orderId:string,driver=false){
  const first=await tx.query<Row>('select restaurant_id from orders where id=$1',[orderId]);
  if(!first.rows[0])throw new NotFoundException('주문을 찾을 수 없습니다.');
  // Same lock order as existing SQL RPCs; all state changes serialize per restaurant.
  await tx.query('select id from restaurants where id=$1 for update',[first.rows[0].restaurant_id]);
  if(!driver)await this.requireMember(tx,actor,first.rows[0].restaurant_id);
  const rows=await tx.query<Row>('select * from orders where id=$1',[orderId]);
  if(!rows.rows[0]||(driver&&rows.rows[0].user_id!==actor))throw new NotFoundException('주문을 찾을 수 없습니다.');
  return rows.rows[0];
 }
 private async receiptReplay(tx:Transaction,actor:string,orderId:string,action:string,input:ReceiptInput|RejectionInput|LifecycleInput){
  const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const rows=await tx.query<{fingerprint:string;response:unknown}>(`select fingerprint,response from restaurant_order_actions where actor_id=$1 and order_id=$2 and action=$3 and request_key=$4`,[actor,orderId,action,input.requestKey]);
  if(rows.rows[0]&&rows.rows[0].fingerprint!==fingerprint)throw new ConflictException('같은 작업 키로 다른 요청을 보낼 수 없습니다.');
  return {fingerprint,response:rows.rows[0]?.response};
 }
 private async saveReceipt(tx:Transaction,actor:string,orderId:string,action:string,input:ReceiptInput|RejectionInput|LifecycleInput,fingerprint:string,response:unknown){
  await tx.query(`insert into restaurant_order_actions(actor_id,order_id,action,request_key,fingerprint,request_payload,response) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,[actor,orderId,action,input.requestKey,fingerprint,JSON.stringify(input),JSON.stringify(response)]);
 }
 async acceptOrder(actor:string,orderId:string,input:ReceiptInput){return this.transaction(async tx=>{
  const current=await this.lockedOrder(tx,actor,orderId);
  const replay=await this.receiptReplay(tx,actor,orderId,'ACCEPT',input);
  if(replay.response)return replay.response;
  if(Number(current.version)!==input.expectedVersion)throw new ConflictException('주문이 변경되었습니다. 다시 조회해주세요.');
  if(current.order_status!=='PENDING')throw new ConflictException('접수 대기 주문만 수락할 수 있습니다.');
  if(!input.eta)throw new UnprocessableEntityException({code:'ETA_REQUIRED',message:'모의 도착 예정 시각이 필요합니다.'});
  this.validateEta(input.eta);
  const cooking=await tx.query<{planned_end_at:string}>(
   'select planned_end_at from reserve_cooking($1,$2,$3::timestamptz,$4)',
   [orderId,input.acceptedCookDurationMinutes,input.eta.arrivalAt,input.preparationBufferMinutes],
  );
  const earliestPickup=new Date(cooking.rows[0].planned_end_at).getTime()+input.preparationBufferMinutes*60_000;
  await this.reservePickupSpace(tx,orderId,current.pickup_location_id,input.eta.arrivalAt,input.acceptedCookDurationMinutes,earliestPickup);
  const updated=(await tx.query<Row>('select * from orders where id=$1',[orderId])).rows[0];
  const response={...await this.orderResponse(tx,updated),eta:input.eta};
  await this.saveReceipt(tx,actor,orderId,'ACCEPT',input,replay.fingerprint,response);
  return response;
 });}
 private async reservePickupSpace(tx:Transaction,orderId:string,locationId:unknown,arrivalAt:string,cookMinutes:number,earliestPickup:number){
  const location=(await tx.query<{space_capacity:number;handoff_minutes:number}>(
   'select space_capacity,handoff_minutes from restaurant_pickup_locations where id=$1 and is_active for update',[locationId],
  )).rows[0];
  if(!location)throw new ConflictException({code:'PICKUP_LOCATION_INACTIVE',message:'픽업 위치를 사용할 수 없습니다.'});
  const reservations=(await tx.query<SpaceRow>(
   "select * from pickup_space_reservations where location_id=$1 and status<>'RELEASED'",[locationId],
  )).rows;
  const requested=Date.parse(arrivalAt);
  const eta=Math.max(requested,earliestPickup);
  const now=Date.now();
  let alternative=Infinity;
  let occupied=false;
  for(let space=1;space<=location.space_capacity;space++){
   const plan=planPickup({now,eta,cookMinutes,
    cookingStatus:'SCHEDULED',handoffMinutes:location.handoff_minutes,
    reservations:reservations.filter(row=>row.space_number===space).map(row=>({
     id:row.order_id,startAt:new Date(row.start_at).getTime(),endAt:new Date(row.end_at).getTime(),
     status:row.status==='OCCUPIED'?'IN_USE':row.status,
    })),
   });
   if(requested===eta&&plan.availableAtEta){
    await tx.query(`insert into pickup_space_reservations(order_id,location_id,space_number,start_at,end_at)
     values ($1,$2,$3,$4,$5)`,[orderId,locationId,space,new Date(eta).toISOString(),
      new Date(eta+location.handoff_minutes*60_000).toISOString()]);
    return;
   }
   occupied ||= plan.reasons.includes('SPACE_IN_USE');
   alternative=Math.min(alternative,plan.proposedPickupAt??Infinity);
  }
  throw new ConflictException({
   code:requested<earliestPickup?'COOKING_CAPACITY':!Number.isFinite(alternative)&&occupied?'SPACE_OCCUPIED':'PICKUP_CONFLICT',
   message:'요청한 픽업 시각을 확정할 수 없습니다.',
   availableAtEta:false,
   alternativePickupAt:Number.isFinite(alternative)?new Date(alternative).toISOString():null,
  });
 }
 async rejectOrder(actor:string,orderId:string,input:RejectionInput){return this.transaction(async tx=>{
  const current=await this.lockedOrder(tx,actor,orderId);
  const replay=await this.receiptReplay(tx,actor,orderId,'REJECT',input);
  if(replay.response)return replay.response;
  if(Number(current.version)!==input.expectedVersion)throw new ConflictException('주문이 변경되었습니다. 다시 조회해주세요.');
  if(current.order_status!=='PENDING')throw new ConflictException('접수 대기 주문만 거절할 수 있습니다.');
  const updated=(await tx.query<Row>("select * from close_pickup_order($1,'REJECTED')",[orderId])).rows[0];
  const response={...await this.orderResponse(tx,updated),rejectionReason:input.reason};
  await this.saveReceipt(tx,actor,orderId,'REJECT',input,replay.fingerprint,response);
  return response;
 });}
 async applyLifecycle(actor:string,orderId:string,action:LifecycleAction,input:LifecycleInput){
  return this.transaction(async tx=>{
   const current=await this.lockedOrder(tx,actor,orderId);
   const operation=action.toUpperCase();
   const replay=await this.receiptReplay(tx,actor,orderId,operation,input);
   if(replay.response)return replay.response;
   if(Number(current.version)!==input.expectedVersion)throw new ConflictException('주문이 변경되었습니다. 다시 조회해주세요.');
   const queries={
    start:'select start_cooking($1)',
    ready:'select mark_order_ready($1)',
    arrive:'select occupy_pickup_space($1)',
    complete:"select close_pickup_order($1,'COMPLETED')",
    cancel:"select close_pickup_order($1,'CANCELLED')",
   };
   if(action==='complete'&&current.order_status!=='COMPLETED'){
    const space=await tx.query<{status:string}>('select status from pickup_space_reservations where order_id=$1',[orderId]);
    if(current.cooking_status!=='READY'||space.rows[0]?.status!=='OCCUPIED'){
     throw new ConflictException('준비 완료 및 픽업 공간 상태를 확인해주세요.');
    }
   }
   await tx.query(queries[action],[orderId]);
   if(action==='arrive')await tx.query('select record_pickup_arrival($1)',[orderId]);
   const updated=(await tx.query<Row>('select * from orders where id=$1',[orderId])).rows[0];
   const response=await this.orderResponse(tx,updated);
   await this.saveReceipt(tx,actor,orderId,operation,input,replay.fingerprint,response);
   return response;
  });
 }
 private validateEta(eta:EtaUpdateInput['eta']){
  const age=Date.now()-Date.parse(eta.observedAt);
  if(age>300000||age< -30000)throw new UnprocessableEntityException({code:'INVALID_ETA',message:'5분 이내에 관측한 모의 ETA가 필요합니다.'});
  if(Date.parse(eta.arrivalAt)<Date.parse(eta.observedAt))throw new UnprocessableEntityException({code:'INVALID_ETA',message:'도착 시각은 관측 시각보다 빠를 수 없습니다.'});
 }
 private async latestEta(tx:Transaction,orderId:unknown){
  return (await tx.query<EtaAction>(
   "select request_payload,response from restaurant_order_actions where order_id=$1 and action='ETA' order by (response->>'version')::integer desc limit 1",
   [orderId],
  )).rows[0];
 }
 private async replacePlan(tx:Transaction,order:Row,pickupAt:string){
  const duration=Number(order.accepted_cook_duration_minutes);
  const buffer=Number(order.preparation_buffer_minutes);
  await tx.query('select clear_pickup_for_replan($1)',[order.id]);
  const cooking=(await tx.query<{planned_start_at:Date;planned_end_at:Date}>(
   'select planned_start_at,planned_end_at from reserve_cooking($1,$2,$3::timestamptz,$4)',
   [order.id,duration,pickupAt,buffer],
  )).rows[0];
  await this.reservePickupSpace(tx,String(order.id),order.pickup_location_id,pickupAt,duration,
   new Date(cooking.planned_end_at).getTime()+buffer*60_000);
  return {pickupAt,cookingStartAt:new Date(cooking.planned_start_at).toISOString()};
 }
 private async previewPlan(tx:Transaction,order:Row,arrivalAt:string):Promise<Proposal|null>{
  let candidate=arrivalAt;
  // Each attempt uses the real capacity checks and rolls back all tentative changes.
  for(let attempt=0;attempt<10;attempt++){
   await tx.exec('savepoint eta_preview');
   try{
    return await this.replacePlan(tx,order,candidate);
   }catch(error){
    if(error instanceof ConflictException){
     const response=error.getResponse() as {alternativePickupAt?:string};
     if(!response.alternativePickupAt||Date.parse(response.alternativePickupAt)<=Date.parse(candidate))return null;
     candidate=response.alternativePickupAt;
    }else if(error instanceof Error&&'code' in error&&error.code==='P0001'&&/capacity/.test(error.message)){
     return null;
    }else throw error;
   }finally{
    await tx.exec('rollback to savepoint eta_preview; release savepoint eta_preview');
   }
  }
  return null;
 }
 async updateEta(actor:string,orderId:string,input:EtaUpdateInput){
  return this.transaction(async tx=>{
   const current=await this.lockedOrder(tx,actor,orderId);
   const replay=await this.receiptReplay(tx,actor,orderId,'ETA',input);
   if(replay.response)return replay.response;
   if(current.order_status!=='ACCEPTED')throw new ConflictException('수락된 주문만 ETA를 변경할 수 있습니다.');
   const previous=await this.orderResponse(tx,current);
   const observed=Date.parse(input.eta.observedAt);
   if(previous.eta&&observed<=Date.parse(previous.eta.observedAt)){
    if(observed===Date.parse(previous.eta.observedAt)&&Date.parse(input.eta.arrivalAt)===Date.parse(previous.eta.arrivalAt))return previous;
    throw new ConflictException({code:observed===Date.parse(previous.eta.observedAt)?'ETA_SAMPLE_CONFLICT':'STALE_ETA',message:'이미 더 최신 ETA가 있거나 같은 관측 시각의 값이 다릅니다.'});
   }
   if(previous.version!==input.expectedVersion)throw new ConflictException('주문이 변경되었습니다. 다시 조회해주세요.');
   this.validateEta(input.eta);
   const eligible=current.cooking_status==='SCHEDULED'&&previous.pickupSpaceReservationStatus==='RESERVED';
   const window=previous.pickupSpaceReservation;
   const arrival=Date.parse(input.eta.arrivalAt);
   const matches=window&&arrival>=new Date(window.startAt).getTime()&&arrival<new Date(window.endAt).getTime()&&!previous.pickupExpired;
   const etaProposal=eligible&&!matches?await this.previewPlan(tx,current,input.eta.arrivalAt):null;
   await tx.query('select advance_eta_version($1)',[orderId]);
   const updated=(await tx.query<Row>('select * from orders where id=$1',[orderId])).rows[0];
   const response={...await this.orderResponse(tx,updated),eta:input.eta,etaProposal,
    etaNeedsReview:!matches&&previous.pickupSpaceReservationStatus!=='OCCUPIED'};
   await this.saveReceipt(tx,actor,orderId,'ETA',input,replay.fingerprint,response);
   return response;
  });
 }
 async confirmEta(actor:string,orderId:string,input:LifecycleInput){
  return this.transaction(async tx=>{
   const current=await this.lockedOrder(tx,actor,orderId,true);
   const replay=await this.receiptReplay(tx,actor,orderId,'CONFIRM_ETA',input);
   if(replay.response)return replay.response;
   const previous=await this.orderResponse(tx,current);
   if(previous.version!==input.expectedVersion||!previous.etaProposal){
    throw new ConflictException('변경 제안이 유효하지 않습니다. 주문 상태를 다시 조회해주세요.');
   }
   const plan=await this.replacePlan(tx,current,previous.etaProposal.pickupAt);
   if(plan.cookingStartAt!==previous.etaProposal.cookingStartAt){
    throw new ConflictException('조리 일정이 바뀌었습니다. 식당에서 새 ETA를 입력해주세요.');
   }
   const updated=(await tx.query<Row>('select * from orders where id=$1',[orderId])).rows[0];
   const response=await this.orderResponse(tx,updated);
   const confirmed={...response,etaNeedsReview:false};
   await this.saveReceipt(tx,actor,orderId,'CONFIRM_ETA',input,replay.fingerprint,confirmed);
   return confirmed;
  });
 }
 private async orderResponse(tx:Transaction,o:Row){
  const rows=await tx.query<Row>('select * from order_items where order_id=$1 order by created_at,id',[o.id]);
  const reservation=await tx.query<Row>('select * from cooking_reservations where order_id=$1 and released_at is null',[o.id]);
  const acceptance=await tx.query<{request_payload:ReceiptInput}>("select request_payload from restaurant_order_actions where order_id=$1 and action='ACCEPT' order by created_at desc,id desc limit 1",[o.id]);
  const latest=await this.latestEta(tx,o.id);
  const confirmed=latest&&(await tx.query("select 1 from restaurant_order_actions where order_id=$1 and action='CONFIRM_ETA' and (response->>'version')::integer > $2 limit 1",[o.id,latest.response.version])).rows.length>0;
  const rejection=await tx.query<{request_payload:RejectionInput}>("select request_payload from restaurant_order_actions where order_id=$1 and action='REJECT' order by created_at desc,id desc limit 1",[o.id]);
  const space=(await tx.query<SpaceRow>('select * from pickup_space_reservations where order_id=$1',[o.id])).rows[0];
  const eta=latest?.request_payload.eta??acceptance.rows[0]?.request_payload.eta??null;
  const pickupExpired=space?.status==='RESERVED'&&new Date(space.end_at).getTime()<=Date.now();
  const arrival=eta?Date.parse(eta.arrivalAt):0;
  const etaProposal=o.order_status==='ACCEPTED'&&o.cooking_status==='SCHEDULED'&&space?.status==='RESERVED'
   &&latest?.response.version===Number(o.version)&&latest.response.etaProposal
   &&Date.parse(latest.response.etaProposal.cookingStartAt)>Date.now()?latest.response.etaProposal:null;
  const etaNeedsReview=o.order_status==='ACCEPTED'&&space?.status==='RESERVED'&&
   (pickupExpired||!!latest&&!confirmed&&(arrival<new Date(space.start_at).getTime()||arrival>=new Date(space.end_at).getTime()));
  const items=rows.rows.map(i=>({id:i.id,menuName:i.menu_name_snapshot,quantity:Number(i.quantity),unitPriceKrw:Number(i.unit_price_krw)}));
  return {id:o.id,userId:o.user_id,restaurantId:o.restaurant_id,orderStatus:o.order_status,cookingStatus:o.cooking_status,
   vehicleStatus:o.vehicle_status,vehiclePlate:o.pickup_vehicle_plate,contactPhone:o.pickup_contact_phone,
   pickupLocation:{id:o.pickup_location_id,name:o.pickup_name,address:o.pickup_address,latitude:o.pickup_latitude,
    longitude:o.pickup_longitude,instructions:o.pickup_instructions},items,
   rejectionReason:rejection.rows[0]?.request_payload.reason??null,
   version:Number(o.version),acceptedCookDurationMinutes:o.accepted_cook_duration_minutes,
   eta,etaProposal,etaNeedsReview,pickupExpired,
   cookingReservation:reservation.rows[0]?{id:reservation.rows[0].id,plannedStartAt:reservation.rows[0].planned_start_at,plannedEndAt:reservation.rows[0].planned_end_at}:null,
   pickupSpaceReservationStatus:space?.status??'UNRESERVED',
   pickupSpaceReservation:space?{spaceNumber:space.space_number,startAt:space.start_at,endAt:space.end_at}:null,
   totalPriceKrw:items.reduce((n,i)=>n+i.quantity*i.unitPriceKrw,0),createdAt:o.created_at};
 }
}
