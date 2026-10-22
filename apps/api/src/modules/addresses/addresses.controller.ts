import {Body,Controller,Get,Inject,Param,Post,Put,Req} from '@nestjs/common';
import {AddressesService} from './addresses.service';
@Controller('customer/addresses')
export class AddressesController {
 constructor(@Inject(AddressesService) private readonly service:AddressesService){}
 @Get() list(@Req() req:any){return this.service.list(req);}
 @Get(':id') detail(@Req() req:any,@Param('id') id:string){return this.service.detail(req,id);}
 @Post() create(@Req() req:any,@Body() body:unknown){return this.service.create(req,body);}
 @Put(':id') update(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.update(req,id,body);}
 @Post(':id/default') setDefault(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.setDefault(req,id,body);}
 @Post(':id/delete') remove(@Req() req:any,@Param('id') id:string,@Body() body:unknown){return this.service.remove(req,id,body);}
}
