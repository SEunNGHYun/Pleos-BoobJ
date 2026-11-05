import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { Transaction } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { DATABASE, LocalDatabase } from '../database/local-database.js';
import type { RestaurantInput, OrderInput, ReceiptInput, RejectionInput, RestaurantOrdersQuery } from './input.js';

type Row=Record<string,unknown>;
const pickup=(r:Row)=>({id:r.id,name:r.name,address:r.address,latitude:r.latitude,longitude:r.longitude,instructions:r.instructions??null,isDefault:r.is_default});
const menu=(r:Row)=>({id:r.id,name:r.name,priceKrw:Number(r.price_krw)});
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
   const result=await tx.query<Row>(`insert into restaurants(name,contact_phone,address,max_concurrent_orders,is_accepting_orders)
    values ($1,$2,$3,$4,$5) returning *`,[input.name,input.contactPhone,input.address,input.maxConcurrentOrders,input.isAcceptingOrders]);
   const r=result.rows[0],locations:Row[]=[],menus:Row[]=[];
   await tx.query("insert into restaurant_members(restaurant_id,user_id,role) values ($1,$2,'OWNER')",[r.id,actor]);
   for(const p of input.pickupLocations){
    const row=await tx.query<Row>(`insert into restaurant_pickup_locations(restaurant_id,name,address,latitude,longitude,instructions,is_default)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,[r.id,p.name,p.address,p.latitude,p.longitude,p.instructions??null,p.isDefault]);
    locations.push(row.rows[0]);
   }
   for(const m of input.menus){
    const row=await tx.query<Row>('insert into menus(restaurant_id,name,price_krw) values($1,$2,$3) returning *',[r.id,m.name,m.priceKrw]);
    menus.push(row.rows[0]);
   }
   return {id:r.id,name:r.name,contactPhone:r.contact_phone,address:r.address,maxConcurrentOrders:r.max_concurrent_orders,
    isAcceptingOrders:r.is_accepting_orders,pickupLocations:locations.map(pickup),menus:menus.map(menu)};
  });
 }
 async listLocations(restaurantId:string){return this.transaction(async tx=>{
  await this.requireRestaurant(tx,restaurantId);
  const r=await tx.query<Row>('select * from restaurant_pickup_locations where restaurant_id=$1 and is_active order by created_at,id',[restaurantId]);
  return r.rows.map(pickup);
 });}
 async listMenus(restaurantId:string){return this.transaction(async tx=>{
  await this.requireRestaurant(tx,restaurantId);
  const r=await tx.query<Row>('select * from menus where restaurant_id=$1 and is_available order by created_at,id',[restaurantId]);
  return r.rows.map(menu);
 });}
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
 private async lockedOrder(tx:Transaction,actor:string,orderId:string){
  const first=await tx.query<Row>('select restaurant_id from orders where id=$1',[orderId]);
  if(!first.rows[0])throw new NotFoundException('주문을 찾을 수 없습니다.');
  // Same lock order as existing SQL RPCs; all state changes serialize per restaurant.
  await tx.query('select id from restaurants where id=$1 for update',[first.rows[0].restaurant_id]);
  await this.requireMember(tx,actor,first.rows[0].restaurant_id);
  const rows=await tx.query<Row>('select * from orders where id=$1',[orderId]);
  if(!rows.rows[0])throw new NotFoundException('주문을 찾을 수 없습니다.');
  return rows.rows[0];
 }
 private async receiptReplay(tx:Transaction,actor:string,orderId:string,action:string,input:ReceiptInput|RejectionInput){
  const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const rows=await tx.query<{fingerprint:string;response:unknown}>(`select fingerprint,response from restaurant_order_actions where actor_id=$1 and order_id=$2 and action=$3 and request_key=$4`,[actor,orderId,action,input.requestKey]);
  if(rows.rows[0]&&rows.rows[0].fingerprint!==fingerprint)throw new ConflictException('같은 작업 키로 다른 요청을 보낼 수 없습니다.');
  return {fingerprint,response:rows.rows[0]?.response};
 }
 private async saveReceipt(tx:Transaction,actor:string,orderId:string,action:string,input:ReceiptInput|RejectionInput,fingerprint:string,response:unknown){
  await tx.query(`insert into restaurant_order_actions(actor_id,order_id,action,request_key,fingerprint,request_payload,response) values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,[actor,orderId,action,input.requestKey,fingerprint,JSON.stringify(input),JSON.stringify(response)]);
 }
 async acceptOrder(actor:string,orderId:string,input:ReceiptInput){return this.transaction(async tx=>{
  const current=await this.lockedOrder(tx,actor,orderId);
  const replay=await this.receiptReplay(tx,actor,orderId,'ACCEPT',input);
  if(replay.response)return replay.response;
  if(Number(current.version)!==input.expectedVersion)throw new ConflictException('주문이 변경되었습니다. 다시 조회해주세요.');
  if(current.order_status!=='PENDING')throw new ConflictException('접수 대기 주문만 수락할 수 있습니다.');
  if(!input.eta)throw new UnprocessableEntityException({code:'ETA_REQUIRED',message:'모의 도착 예정 시각이 필요합니다.'});
  const age=Date.now()-Date.parse(input.eta.observedAt);
  if(age>300000||age< -30000)throw new UnprocessableEntityException({code:'INVALID_ETA',message:'5분 이내에 관측한 모의 ETA가 필요합니다.'});
  if(Date.parse(input.eta.arrivalAt)<Date.parse(input.eta.observedAt))throw new UnprocessableEntityException({code:'INVALID_ETA',message:'도착 시각은 관측 시각보다 빠를 수 없습니다.'});
  await tx.query('select * from reserve_cooking($1,$2,$3::timestamptz,$4)',[orderId,input.acceptedCookDurationMinutes,input.eta.arrivalAt,input.preparationBufferMinutes]);
  const updated=(await tx.query<Row>('select * from orders where id=$1',[orderId])).rows[0];
  const response={...await this.orderResponse(tx,updated),eta:input.eta};
  await this.saveReceipt(tx,actor,orderId,'ACCEPT',input,replay.fingerprint,response);
  return response;
 });}
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
 private async orderResponse(tx:Transaction,o:Row){
  const rows=await tx.query<Row>('select * from order_items where order_id=$1 order by created_at,id',[o.id]);
  const reservation=await tx.query<Row>('select * from cooking_reservations where order_id=$1 and released_at is null',[o.id]);
  const acceptance=await tx.query<{request_payload:ReceiptInput}>("select request_payload from restaurant_order_actions where order_id=$1 and action='ACCEPT' order by created_at desc,id desc limit 1",[o.id]);
  const rejection=await tx.query<{request_payload:RejectionInput}>("select request_payload from restaurant_order_actions where order_id=$1 and action='REJECT' order by created_at desc,id desc limit 1",[o.id]);
  const items=rows.rows.map(i=>({id:i.id,menuName:i.menu_name_snapshot,quantity:Number(i.quantity),unitPriceKrw:Number(i.unit_price_krw)}));
  return {id:o.id,userId:o.user_id,restaurantId:o.restaurant_id,orderStatus:o.order_status,cookingStatus:o.cooking_status,
   vehicleStatus:o.vehicle_status,vehiclePlate:o.pickup_vehicle_plate,contactPhone:o.pickup_contact_phone,
   pickupLocation:{id:o.pickup_location_id,name:o.pickup_name,address:o.pickup_address,latitude:o.pickup_latitude,
    longitude:o.pickup_longitude,instructions:o.pickup_instructions},items,
   rejectionReason:rejection.rows[0]?.request_payload.reason??null,
   version:Number(o.version),acceptedCookDurationMinutes:o.accepted_cook_duration_minutes,
   eta:acceptance.rows[0]?.request_payload.eta??null,
   cookingReservation:reservation.rows[0]?{id:reservation.rows[0].id,plannedStartAt:reservation.rows[0].planned_start_at,plannedEndAt:reservation.rows[0].planned_end_at}:null,
   pickupSpaceReservationStatus:'NOT_IMPLEMENTED',
   totalPriceKrw:items.reduce((n,i)=>n+i.quantity*i.unitPriceKrw,0),createdAt:o.created_at};
 }
}
