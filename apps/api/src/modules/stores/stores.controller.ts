import { Controller, Get, Inject, Param } from '@nestjs/common';
import { Db } from '../../common/db';
import { CatalogService } from '../catalog/catalog.service';
import { fail } from '../../common/domain';
import { PublicBrand } from '../../common/public-brand';
@Controller()
export class StoresController {
  constructor(@Inject(Db) private db: Db, @Inject(CatalogService) private catalog: CatalogService, @Inject(PublicBrand) private publicBrand: PublicBrand) {}
  @Get('health') async health() { await this.db.$queryRaw`SELECT 1`; return {status: 'ok', database: 'connected'}; }
  @Get('stores') async stores() { const brandId = await this.publicBrand.id(); return this.db.store.findMany({where: {brandId}, orderBy: {id: 'asc'}, select: {id: true, name: true, address: true, phone: true, notice: true, isOpen: true, serviceModes: true, pickupMinutes: true, deliveryFeeFen: true, minOrderFen: true, themeColor: true}}); }
  @Get('stores/:storeId/catalog') getCatalog(@Param('storeId') id: string) { return this.catalog.get(id); }
  @Get('stores/:storeId/tables') async tables(@Param('storeId') storeId: string) {
    await this.publicBrand.assertStore(storeId);
    const [tables, activeOrders] = await this.db.$transaction([
      this.db.diningTable.findMany({where: {storeId}, select: {id: true, name: true, capacity: true, status: true, code: true}, orderBy: {name: 'asc'}}),
      this.db.order.findMany({where: {storeId, mode: 'DINE_IN', status: {notIn: ['CANCELLED','COMPLETED']}}, select: {tableName: true}})
    ]);
    return tables.map(table => ({...table, status: activeOrders.some(order => order.tableName === table.name) ? 'OCCUPIED' : 'FREE'}));
  }
}
