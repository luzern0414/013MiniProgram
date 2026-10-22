import {Body,Controller,Get,Inject,Param,Patch,Put,Query,Req} from '@nestjs/common';
import {ProductOptionsService} from './product-options.service';
@Controller('merchant')
export class ProductOptionsController {
 constructor(@Inject(ProductOptionsService) private options:ProductOptionsService){}
 @Get('products/:productId/options') get(@Req() req:any,@Param('productId') id:string,@Query('storeId') storeId:string){return this.options.get(req,id,storeId);}
 @Put('products/:productId/options') put(@Req() req:any,@Param('productId') id:string,@Body() body:unknown){return this.options.put(req,id,body);}
 @Patch('modifiers/:modifierId/inventory') inventory(@Req() req:any,@Param('modifierId') id:string,@Body() body:unknown){return this.options.inventory(req,id,body);}
}
