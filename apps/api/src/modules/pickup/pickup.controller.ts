import {Body,Controller,Get,Inject,Param,Patch,Post,Put,Query,Req} from '@nestjs/common';
import {PickupService} from './pickup.service';
import {OrdersService} from '../orders/orders.service';
@Controller()
export class PickupController {
 constructor(@Inject(PickupService)private pickup:PickupService,@Inject(OrdersService)private orders:OrdersService){}
 @Get('merchant/pickup-policy') policy(@Req()req:any,@Query()query:any){return this.pickup.policy(req,query);}
 @Put('merchant/pickup-policy') putPolicy(@Req()req:any,@Body()body:unknown){return this.pickup.putPolicy(req,body);}
 @Get('merchant/pickup-slots') slots(@Req()req:any,@Query()query:any){return this.pickup.slots(req,query);}
 @Post('merchant/pickup-slots') create(@Req()req:any,@Body()body:unknown){return this.pickup.create(req,body);}
 @Patch('merchant/pickup-slots/:id') patch(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.pickup.patch(req,id,body);}
 @Get('stores/:storeId/pickup-slots') publicSlots(@Param('storeId')storeId:string,@Query()query:any){return this.pickup.publicSlots(storeId,query);}
 @Post('merchant/orders/:id/pickup') verify(@Req()req:any,@Param('id')id:string,@Body()body:unknown){return this.orders.pickup(req,id,body);}
}
