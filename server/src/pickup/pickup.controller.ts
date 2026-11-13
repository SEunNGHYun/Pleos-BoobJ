import { Body, Controller, Get, HttpCode, Query, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { LocalAuthGuard, type ActorRequest } from './auth.guard.js';
import { PickupService } from './pickup.service.js';
import { parse, restaurantInput, orderInput, receiptInput, rejectionInput, restaurantOrdersQuery, lifecycleAction, lifecycleInput, etaUpdateInput, routeRankingInput, menuImageInput } from './input.js';
@Controller()
@UseGuards(LocalAuthGuard)
export class PickupController {
 constructor(@Inject(PickupService)private readonly service:PickupService){}
 @Get('pickup/menu-names') menuNames(){return this.service.listPickupMenuNames();}
 @Post('pickup/restaurant-options') @HttpCode(200)
 restaurantOptions(@Body()body:unknown){return this.service.rankPickupRestaurants(parse(routeRankingInput,body));}
 @Post('restaurants') register(@Req()req:ActorRequest,@Body()body:unknown){return this.service.registerRestaurant(req.actorId,parse(restaurantInput,body));}
 @Get('restaurants/mine') myRestaurants(@Req()req:ActorRequest){
  return this.service.listManagedRestaurants(req.actorId);
 }
 @Get('restaurants/:id/pickup-locations') locations(@Param('id',new ParseUUIDPipe())id:string){return this.service.listLocations(id);}
 @Get('restaurants/:id/menus') menus(@Param('id',new ParseUUIDPipe())id:string){return this.service.listMenus(id);}
 @Post('restaurants/:id/menus/:menuId/image') @HttpCode(200)
 menuImage(@Req()req:ActorRequest,@Param('id',new ParseUUIDPipe())id:string,@Param('menuId',new ParseUUIDPipe())menuId:string,@Body()body:unknown){
  return this.service.setMenuImage(req.actorId,id,menuId,parse(menuImageInput,body).imageData);
 }
 @Post('orders') order(@Req()req:ActorRequest,@Body()body:unknown){return this.service.createOrder(req.actorId,parse(orderInput,body));}
 @Get('orders/:id') detail(@Req()req:ActorRequest,@Param('id',new ParseUUIDPipe())id:string){return this.service.getOrder(req.actorId,id);}
 @Get('orders/:id/pickup-location') async pickup(@Req()req:ActorRequest,@Param('id',new ParseUUIDPipe())id:string){return (await this.service.getOrder(req.actorId,id)).pickupLocation;}
 @Get('restaurants/:id/orders') listOrders(@Req()req:ActorRequest,@Param('id',new ParseUUIDPipe())id:string,@Query()query:unknown){return this.service.listRestaurantOrders(req.actorId,id,parse(restaurantOrdersQuery,query));}
 @Post('orders/:id/accept') @HttpCode(200) accept(@Req()req:ActorRequest,@Param('id',new ParseUUIDPipe())id:string,@Body()body:unknown){return this.service.acceptOrder(req.actorId,id,parse(receiptInput,body));}
 @Post('orders/:id/reject') @HttpCode(200) reject(@Req()req:ActorRequest,@Param('id',new ParseUUIDPipe())id:string,@Body()body:unknown){return this.service.rejectOrder(req.actorId,id,parse(rejectionInput,body));}
 @Post('orders/:id/eta') @HttpCode(200)
 eta(@Req()req:ActorRequest,@Param('id',new ParseUUIDPipe())id:string,@Body()body:unknown){
  return this.service.updateEta(req.actorId,id,parse(etaUpdateInput,body));
 }
 @Post('orders/:id/eta/confirm') @HttpCode(200)
 confirmEta(@Req()req:ActorRequest,@Param('id',new ParseUUIDPipe())id:string,@Body()body:unknown){
  return this.service.confirmEta(req.actorId,id,parse(lifecycleInput,body));
 }
 @Post('orders/:id/:action') @HttpCode(200)
 lifecycle(@Req()req:ActorRequest,@Param('id',new ParseUUIDPipe())id:string,@Param('action')action:string,@Body()body:unknown){
  return this.service.applyLifecycle(req.actorId,id,parse(lifecycleAction,action),parse(lifecycleInput,body));
 }
}
