import {fail,object} from '../../common/domain';
export const PICKUP_TIMEZONE='Asia/Shanghai';
export function pickupInteger(value:unknown,min=0,max=2_000_000_000):number {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)fail('VALIDATION_ERROR',`请输入${min}至${max}的整数`);
 return value;
}
export function pickupBoolean(value:unknown):boolean {if(typeof value!=='boolean')fail('VALIDATION_ERROR','启用状态必须为布尔值');return value;}
export function serviceDate(date:Date):string {return new Date(date.getTime()+8*3600000).toISOString().slice(0,10);}
export function pickupDate(value:unknown):string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('VALIDATION_ERROR','日期需为有效YYYY-MM-DD');return value;
}
export const dayStart=(date:string)=>new Date(date+'T00:00:00+08:00');
export function dateRange(from:unknown,to:unknown){const a=dayStart(pickupDate(from)),b=new Date(dayStart(pickupDate(to)).getTime()+86400000);if(b<=a||b.getTime()-a.getTime()>31*86400000)fail('VALIDATION_ERROR','日期范围需为1至31天');return {gte:a,lt:b};}
export function zonedInstant(value:unknown):Date {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))fail('VALIDATION_ERROR','时间需为带时区的ISO时间');
 pickupDate(value.slice(0,10));
 const time=value.slice(11,19).split(':').map(Number);const offset=value.match(/([+-])(\d{2}):(\d{2})$/);
 if(time[0]>23||time[1]>59||time[2]>59||offset&&(Number(offset[2])>14||Number(offset[3])>59||(Number(offset[2])===14&&Number(offset[3])!==0)))fail('VALIDATION_ERROR','时间格式不正确');
 const result=new Date(value);if(!Number.isFinite(result.getTime()))fail('VALIDATION_ERROR','时间无效');return result;
}
export function validateSlots(value:unknown){
 if(!Array.isArray(value)||value.length<1||value.length>96)fail('VALIDATION_ERROR','每次需创建1至96个时段');
 const rows=value.map(input=>{const b=object(input,['startsAt','endsAt','capacity']),startsAt=zonedInstant(b.startsAt),endsAt=zonedInstant(b.endsAt),capacity=pickupInteger(b.capacity,1,1000);const minutes=(endsAt.getTime()-startsAt.getTime())/60000;
  if(minutes<5||minutes>240||serviceDate(startsAt)!==serviceDate(endsAt))fail('VALIDATION_ERROR','时段需为同一天内的5至240分钟');return {startsAt,endsAt,capacity};
 }).sort((a,b)=>a.startsAt.getTime()-b.startsAt.getTime());
 for(let i=1;i<rows.length;i++)if(rows[i].startsAt<rows[i-1].endsAt)fail('VALIDATION_ERROR','批量时段不能重叠');return rows;
}
export function bookable(policy:{enabled:boolean;leadMinutes:number;maxAdvanceDays:number}|null,slot:{enabled:boolean;startsAt:Date},now=new Date()):boolean {
 return !!policy?.enabled&&slot.enabled&&slot.startsAt.getTime()>=now.getTime()+policy.leadMinutes*60000&&serviceDate(slot.startsAt)<=serviceDate(new Date(now.getTime()+policy.maxAdvanceDays*86400000));
}
