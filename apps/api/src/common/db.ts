import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { fail } from './domain';
@Injectable()
export class Db extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
  async atomic<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try { return await this.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15000 }); }
      catch (error: any) {
        if (['P2034', 'P2002'].includes(error.code) && attempt < 4) continue;
        if (['P2034', 'P2002'].includes(error.code)) fail('STATE_CONFLICT', '并发状态冲突，请重试', 409);
        throw error;
      }
    }
    throw new Error('unreachable');
  }
}
