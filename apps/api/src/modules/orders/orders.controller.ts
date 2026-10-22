import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { AuthService } from '../auth/auth.service';
import { fail, object } from '../../common/domain';
@Controller()
export class OrdersController {
  constructor(@Inject(OrdersService) private orders: OrdersService, @Inject(AuthService) private auth: AuthService) {}
  @Post('quotes') quote(@Req() req: any, @Body() body: unknown) { return this.orders.quote(req, body); }
  @Post('orders') create(@Req() req: any, @Body() body: unknown) { return this.orders.create(req, body); }
  @Get('orders') list(@Req() req: any, @Query() query: any) { return this.orders.list(req, query); }
  @Get('orders/:id') get(@Req() req: any, @Param('id') id: string) { return this.orders.get(req, id); }
  @Post('orders/:id/cancel') cancel(@Req() req: any, @Param('id') id: string, @Body() body: unknown) { return this.orders.cancel(req, id, body); }
  @Post('orders/:id/payment') async payment(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {
    await this.orders.get(req, id); const b = object(body, ['provider']);
    if (b.provider !== 'WECHAT') fail('VALIDATION_ERROR', '不支持的支付渠道');
    fail('INTEGRATION_UNAVAILABLE', '微信支付尚未接入，订单不会标记为已支付', 503);
  }
  @Post('merchant/orders/:id/cash-payment') cash(@Req() req: any, @Param('id') id: string, @Body() body: unknown) { return this.orders.cash(req, id, body); }
  @Post('merchant/orders/:id/transition') transition(@Req() req: any, @Param('id') id: string, @Body() body: unknown) { return this.orders.transition(req, id, body); }
}
