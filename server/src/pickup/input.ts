import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
const text=(max=200)=>z.string().trim().min(1).max(max);
const phone=z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const pickup=z.strictObject({name:text(),address:text(500),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),instructions:text(1000).optional(),isDefault:z.boolean().default(false)});
const menu=z.strictObject({name:text(),priceKrw:z.number().int().min(0).max(100000000)});
export const restaurantInput=z.strictObject({
 name:text(),contactPhone:phone,address:text(500),maxConcurrentOrders:z.number().int().min(1).max(1000),
 isAcceptingOrders:z.boolean().default(false),pickupLocations:z.array(pickup).min(1).max(30),menus:z.array(menu).max(100).default([]),
}).refine(x=>x.pickupLocations.filter(p=>p.isDefault).length<=1,{message:'기본 픽업 위치는 최대 1개입니다.'});
export const orderInput=z.strictObject({restaurantId:z.uuid(),pickupLocationId:z.uuid(),vehiclePlate:text(30),contactPhone:phone,
 requestKey:z.uuid(),items:z.array(z.strictObject({menuId:z.uuid(),quantity:z.number().int().min(1).max(100)})).min(1).max(100),
}).refine(x=>new Set(x.items.map(i=>i.menuId)).size===x.items.length,{message:'메뉴 중복 대신 수량을 지정해주세요.'});
export function parse<T>(schema:z.ZodType<T>,input:unknown):T{
 const result=schema.safeParse(input);
 if(!result.success)throw new BadRequestException({message:'입력값을 확인해주세요.',errors:result.error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});
 return result.data;
}
export type RestaurantInput=z.infer<typeof restaurantInput>;
export type OrderInput=z.infer<typeof orderInput>;

export const receiptInput=z.strictObject({
 acceptedCookDurationMinutes:z.number().int().min(1).max(240),
 preparationBufferMinutes:z.number().int().min(0).max(120).default(0),
 expectedVersion:z.number().int().min(0),requestKey:z.uuid(),
 eta:z.strictObject({source:z.literal('MOCK'),arrivalAt:z.iso.datetime({offset:true}),observedAt:z.iso.datetime({offset:true})}).optional(),
});
export const rejectionInput=z.strictObject({expectedVersion:z.number().int().min(0),requestKey:z.uuid(),reason:text(500)});
export const restaurantOrdersQuery=z.strictObject({
 status:z.enum(['PENDING','ACCEPTED','REJECTED','CANCELLED','COMPLETED']).optional(),
 limit:z.coerce.number().int().min(1).max(100).default(20),offset:z.coerce.number().int().min(0).max(100000).default(0),
});
export type ReceiptInput=z.infer<typeof receiptInput>;
export type RejectionInput=z.infer<typeof rejectionInput>;
export type RestaurantOrdersQuery=z.infer<typeof restaurantOrdersQuery>;
