import {Body, Controller, Inject, Param, Post, Req} from '@nestjs/common';
import {CashRefundsService} from './cash-refunds.service';

@Controller('merchant/orders')
export class CashRefundsController {
  constructor(@Inject(CashRefundsService) private refunds: CashRefundsService) {}
  @Post(':id/cash-refunds') create(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {
    return this.refunds.create(req, id, body);
  }
}
