import { PrismaClient } from '@prisma/client';
import { assertEnvironment } from '../src/common/domain';
export async function seed(db: PrismaClient) {
  assertEnvironment(process.env);
  if (process.env.NODE_ENV === 'production' || process.env.DEV_SEED_ENABLED !== 'true') throw new Error('Experience seed requires DEV_SEED_ENABLED=true outside production');
  const brand = await db.brand.upsert({where: {id: 'experience-brand'}, update: {}, create: {id: 'experience-brand', name: '梧桐里 · 体验品牌', isExperience: true}});
  if (!brand.isExperience) throw new Error('Reserved experience brand id belongs to a non-experience brand; aborting seed');
  const collisions = await db.store.count({where: {id: {in: ['experience-store-a','experience-store-b']}, brandId: {not: brand.id}}});
  if (collisions) throw new Error('Reserved experience store id collision; refusing to alter another brand');
  const categories = [{id: 'experience-cat-signature', name: '招牌鲜食', sort: 1}, {id: 'experience-cat-drinks', name: '清爽茶饮', sort: 2}];
  for (const c of categories) await db.category.upsert({where: {id: c.id}, update: {}, create: {...c, brandId: brand.id}});
  const units = new Map<string,string>();
  for (const name of ['份','杯']) {
    const id = `experience-unit-${name==='份'?'portion':'cup'}`;
    const stable = await db.unit.findUnique({where:{id}});
    if (stable && stable.brandId!==brand.id) throw new Error('Reserved experience unit id belongs to another brand');
    // Migrated seed products may reference a renamed/disabled unit with a legacy ID.
    // Reuse that identity before looking up the original display name.
    const existing = await db.product.findFirst({where:{id:{in:name==='份'?['experience-a-chicken','experience-b-chicken']:['experience-a-lemon','experience-b-lemon']},store:{brandId:brand.id},unitId:{not:null}},include:{unitDefinition:true},orderBy:{id:'asc'}});
    const unit = stable || existing?.unitDefinition || await db.unit.upsert({where:{brandId_name:{brandId:brand.id,name}},update:{},create:{id,brandId:brand.id,name}});
    units.set(name,unit.id);
  }
  const products = [
    {key: 'chicken', name: '香煎鸡腿饭', description: '现煎鸡腿配时蔬、溏心蛋与香软米饭', price: 2800, category: categories[0].id, unit: '份', options: [{name: '标准份', price: 2800}, {name: '加量份', price: 3400}]},
    {key: 'beef', name: '番茄炖牛腩', description: '慢炖牛腩与新鲜番茄，浓郁家常风味', price: 3800, category: categories[0].id, unit: '份'},
    {key: 'vegetable', name: '田园时蔬碗', description: '当季时蔬搭配杂粮，轻盈清爽', price: 2200, category: categories[0].id, unit: '份'},
    {key: 'lemon', name: '手打柠檬茶', description: '鲜切柠檬与清香茶底，现点现做', price: 1600, category: categories[1].id, unit: '杯'},
    {key: 'plum', name: '桂花酸梅汤', description: '乌梅慢煮，桂花飘香', price: 1200, category: categories[1].id, unit: '杯'}
  ];
  for (const [index, suffix] of ['a','b'].entries()) {
    const storeId = `experience-store-${suffix}`;
    await db.store.upsert({where: {id: storeId}, update: {}, create: {id: storeId, brandId: brand.id, name: index === 0 ? '体验门店 · 梧桐里' : '体验门店 · 湖滨', address: index === 0 ? '体验地址：梧桐路88号' : '体验地址：湖滨路16号', phone: '0571-00000000', notice: '仅供本地体验；现金由员工确认，微信支付与配送服务尚未接入。', deliveryFeeFen: 500, minOrderFen: 0, serviceModes: ['DINE_IN','PICKUP'], pickupPolicy:{create:{}}}});
    await db.pickupPolicy.upsert({where:{storeId},update:{},create:{storeId}});
    const page = {notice: '体验门店 · 数据仅供本地演示', bannerTitle: '把一餐，过得认真', bannerSubtitle: '现点现做 · 温暖日常', primaryColor: '#247D61'};
    await db.page.upsert({where: {storeId}, update: {}, create: {storeId, draft: page, published: page}});
    for (let n = 1; n <= 6; n++) await db.diningTable.upsert({where: {code: `EXPERIENCE-${suffix.toUpperCase()}-${n}`}, update: {}, create: {id: `experience-table-${suffix}-${n}`, storeId, name: `${String(n).padStart(2,'0')}号桌`, capacity: n < 4 ? 2 : 4, code: `EXPERIENCE-${suffix.toUpperCase()}-${n}`}});
    for (const p of products) {
      const productId = `experience-${suffix}-${p.key}`;
      await db.product.upsert({where: {id: productId}, update: {}, create: {id: productId, storeId, categoryId: p.category, name: p.name, description: p.description, unit: p.unit, unitId:units.get(p.unit)}});
      const options = p.options || [{name: '标准份', price: p.price}];
      for (const [i, option] of options.entries()) await db.sku.upsert({where: {id: `${productId}-sku-${i}`}, update: {}, create: {id: `${productId}-sku-${i}`, productId, name: option.name, priceFen: option.price, stock: 40}});
      if (p.category === categories[0].id) await db.modifier.upsert({where: {id: `${productId}-egg`}, update: {}, create: {id: `${productId}-egg`, productId, name: '加一份溏心蛋', priceFen: 300, stock: 40}});
    }
  }
  for (const [account, name, role] of [['customer','体验顾客','CUSTOMER'],['owner','体验店主','OWNER'],['clerk-a','梧桐里店员','CLERK'],['clerk-b','湖滨店员','CLERK']]) {
    const user = await db.user.upsert({where: {devAccount: account}, update: {}, create: {id: `experience-user-${account}`, brandId: brand.id, devAccount: account, name, role, phone: account === 'customer' ? '13800000000' : null}});
    if (user.brandId !== brand.id || user.role !== role) throw new Error('Experience identity collision');
    for (const suffix of role === 'OWNER' ? ['a','b'] : account === 'clerk-a' ? ['a'] : account === 'clerk-b' ? ['b'] : []) {
      const storeId = `experience-store-${suffix}`;
      await db.staffStore.upsert({where: {userId_storeId: {userId: user.id, storeId}}, update: {}, create: {userId: user.id, storeId}});
    }
  }
}
if (require.main === module) {
  const db = new PrismaClient();
  seed(db).then(() => console.log('Experience brand and two stores seeded; no production data initialized.')).catch(e => {console.error(e.message); process.exitCode = 1;}).finally(() => db.$disconnect());
}
