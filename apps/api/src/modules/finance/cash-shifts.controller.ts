import {Body, Controller, Get, Inject, Param, Post, Query, Req} from '@nestjs/common';
import {CashShiftsService} from './cash-shifts.service';
@Controller('merchant/cash-shifts')
export class CashShiftsController {
  constructor(@Inject(CashShiftsService) private shifts: CashShiftsService) {}
  @Get() list(@Req() req: any, @Query() query: unknown) {return this.shifts.list(req, query);}
  @Get('current') current(@Req() req: any, @Query() query: unknown) {return this.shifts.current(req, query);}
  @Get(':id') detail(@Req() req: any, @Param('id') id: string, @Query() query: unknown) {return this.shifts.detail(req, id, query);}
  @Post() open(@Req() req: any, @Body() body: unknown) {return this.shifts.open(req, body);}
  @Post(':id/close') close(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {return this.shifts.close(req, id, body);}
}
