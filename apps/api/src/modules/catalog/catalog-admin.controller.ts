import {Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req} from '@nestjs/common';
import {CatalogAdminService} from './catalog-admin.service';

@Controller('merchant')
export class CatalogAdminController {
  constructor(@Inject(CatalogAdminService) private catalog: CatalogAdminService) {}
  @Get('catalog-settings') settings(@Req() req:any,@Query('storeId') storeId:string) {return this.catalog.settings(req,storeId);}
  @Post('categories') createCategory(@Req() req:any,@Body() body:unknown) {return this.catalog.create(req,'category',body);}
  @Patch('categories/:id') editCategory(@Req() req:any,@Param('id') id:string,@Body() body:unknown) {return this.catalog.edit(req,'category',id,body);}
  @Delete('categories/:id') deleteCategory(@Req() req:any,@Param('id') id:string,@Body() body:unknown) {return this.catalog.remove(req,'category',id,body);}
  @Post('units') createUnit(@Req() req:any,@Body() body:unknown) {return this.catalog.create(req,'unit',body);}
  @Patch('units/:id') editUnit(@Req() req:any,@Param('id') id:string,@Body() body:unknown) {return this.catalog.edit(req,'unit',id,body);}
  @Delete('units/:id') deleteUnit(@Req() req:any,@Param('id') id:string,@Body() body:unknown) {return this.catalog.remove(req,'unit',id,body);}
}
