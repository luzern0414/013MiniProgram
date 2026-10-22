import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { StaffService } from './staff.service';

@Controller('merchant/staff')
export class StaffController {
  constructor(@Inject(StaffService) private staff: StaffService) {}
  @Get() list(@Req() req: any, @Query('storeId') storeId: string) { return this.staff.list(req, storeId); }
  @Post() create(@Req() req: any, @Body() body: unknown) { return this.staff.create(req, body); }
  @Patch(':id') update(@Req() req: any, @Param('id') id: string, @Body() body: unknown) { return this.staff.update(req, id, body); }
  @Post(':id/reset-password') reset(@Req() req: any, @Param('id') id: string, @Body() body: unknown) { return this.staff.update(req, id, body, true); }
}
