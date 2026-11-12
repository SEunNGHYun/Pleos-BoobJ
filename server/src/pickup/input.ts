import { BadRequestException } from '@nestjs/common';
import { PICKUP_LIFECYCLE_ACTIONS } from '@babmatj/contracts';
import { z } from 'zod';
const text=(max=200)=>z.string().trim().min(1).max(max);
const phone=z.string().regex(/^\+[1-9][0-9]{7,14}$/);
const pickup=z.strictObject({name:text(),address:text(500),latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),instructions:text(1000).optional(),isDefault:z.boolean().default(false),spaceCapacity:z.number().int().min(1).max(30).default(1),
 handoffMinutes:z.number().int().min(1).max(60).default(3)});
const imageData=z.string().max(60000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
export const menuImageInput=z.strictObject({imageData:imageData.nullable()});
const menu=z.strictObject({imageData:imageData.optional(),name:text(),priceKrw:z.number().int().min(0).max(100000000),baseCookMinutes:z.number().int().min(1).max(240).optional()});
const foodCategory=z.enum(["한식","중식","일식","양식","치킨","피자","분식","카페·디저트","기타"]);
export const restaurantInput=z.strictObject({
 imageData:imageData.optional(),
 foodCategory:foodCategory.default("기타"),name:text(),contactPhone:phone,address:text(500),maxConcurrentOrders:z.number().int().min(1).max(1000),
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

const mockEta=z.strictObject({source:z.literal('MOCK'),arrivalAt:z.iso.datetime({offset:true}),observedAt:z.iso.datetime({offset:true})});
export const receiptInput=z.strictObject({
 acceptedCookDurationMinutes:z.number().int().min(1).max(240),
 preparationBufferMinutes:z.number().int().min(0).max(120).default(0),
 expectedVersion:z.number().int().min(0),requestKey:z.uuid(),
 eta:mockEta.optional(),
});
export const rejectionInput=z.strictObject({expectedVersion:z.number().int().min(0),requestKey:z.uuid(),reason:text(500)});
export const restaurantOrdersQuery=z.strictObject({
 status:z.enum(['PENDING','ACCEPTED','REJECTED','CANCELLED','COMPLETED']).optional(),
 limit:z.coerce.number().int().min(1).max(100).default(20),offset:z.coerce.number().int().min(0).max(100000).default(0),
});
export type ReceiptInput=z.infer<typeof receiptInput>;
export type RejectionInput=z.infer<typeof rejectionInput>;
export type RestaurantOrdersQuery=z.infer<typeof restaurantOrdersQuery>;

export const lifecycleAction=z.enum(PICKUP_LIFECYCLE_ACTIONS);
export const lifecycleInput=z.strictObject({expectedVersion:z.number().int().min(0),requestKey:z.uuid()});
export type LifecycleAction=z.infer<typeof lifecycleAction>;
export type LifecycleInput=z.infer<typeof lifecycleInput>;

export const etaUpdateInput=lifecycleInput.extend({eta:mockEta});
export type EtaUpdateInput=z.infer<typeof etaUpdateInput>;

const coordinateInput=z.strictObject({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)});
export const routeRankingInput=z.strictObject({
 menuName:text().optional(),foodCategory:foodCategory.optional(),route:z.strictObject({origin:coordinateInput,destination:coordinateInput}).optional(),
}).refine(input=>!!input.menuName!==!!input.foodCategory,{message:"메뉴 또는 카테고리 하나를 선택해주세요."});
export type RouteRankingInput=z.infer<typeof routeRankingInput>;
