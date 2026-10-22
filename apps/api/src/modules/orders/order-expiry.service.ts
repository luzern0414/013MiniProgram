import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OrdersService } from './orders.service';
@Injectable()
export class OrderExpiryService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(@Inject(OrdersService) private orders: OrdersService) {}
  async sweep() {
    if (this.running) return;
    this.running = true;
    try { await this.orders.expireUnpaid(); }
    catch (error: any) { console.error('Unpaid order expiry failed', error.code || error.name, error.message); }
    finally { this.running = false; }
  }
  async onModuleInit() {
    await this.sweep();
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
