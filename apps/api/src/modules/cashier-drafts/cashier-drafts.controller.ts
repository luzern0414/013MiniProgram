import {Body, Controller, Get, Inject, Param, Post, Put, Query, Req} from '@nestjs/common';
import {CashierDraftsService} from './cashier-drafts.service';
@Controller('merchant/cashier-drafts')
export class CashierDraftsController {
  constructor(@Inject(CashierDraftsService) private drafts: CashierDraftsService) {}
  @Get() list(@Req() req: any, @Query() query: unknown) {return this.drafts.list(req, query);}
  @Get(':id') get(@Req() req: any, @Param('id') id: string, @Query() query: unknown) {return this.drafts.get(req, id, query);}
  @Post() create(@Req() req: any, @Body() body: unknown) {return this.drafts.create(req, body);}
  @Put(':id') update(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {return this.drafts.update(req, id, body);}
  @Post(':id/cancel') cancel(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {return this.drafts.cancel(req, id, body);}
  @Post(':id/quote') quote(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {return this.drafts.quote(req, id, body);}
}
