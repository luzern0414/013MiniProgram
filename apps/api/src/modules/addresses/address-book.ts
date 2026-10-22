import {Prisma} from '@prisma/client';
import {fail} from '../../common/domain';
export async function lockBook(tx:Prisma.TransactionClient,userId:string){
  await tx.customerAddressBook.upsert({where:{userId},create:{userId},update:{}});
  try {await tx.$queryRaw`SELECT "userId" FROM "CustomerAddressBook" WHERE "userId"=${userId} FOR UPDATE`;}
  catch(error:any){if(error.code==='P2010'&&['40001','40P01'].includes(error.meta?.code))throw new Prisma.PrismaClientKnownRequestError('Address book lock retry',{code:'P2034',clientVersion:Prisma.prismaVersion.client});throw error;}
  return tx.customerAddressBook.findUniqueOrThrow({where:{userId}});
}
export function increment(value:number){if(value>=2_000_000_000)fail('ADDRESS_VERSION_LIMIT','地址版本已达上限，请重新读取后重试',409);return value+1;}
export function view(a:any){return {id:a.id,revision:a.revision,name:a.name,phone:a.phone,region:a.region,detail:a.detail,point:a.point,isDefault:a.isDefault,deletedAt:a.deletedAt?.toISOString()??null,createdAt:a.createdAt.toISOString(),updatedAt:a.updatedAt.toISOString()};}
