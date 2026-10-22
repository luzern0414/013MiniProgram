import {fail, object} from '../../common/domain';

const pointKeys=['system','latitudeE6','longitudeE6','source','confirmedAt'];
const fields=['name','phone','region','detail','point','isDefault'];
const writeFields=['expectedBookRevision',...fields];
const int=(v:any,label:string)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>2_000_000_000)fail('VALIDATION_ERROR',`${label}格式不正确`);return v;};
const text=(v:any,label:string,min:number,max:number)=>{if(typeof v!=='string')fail('VALIDATION_ERROR',`${label}格式不正确`);const s=v.trim();if(s.length<min||s.length>max||/\p{Cc}/u.test(s))fail('VALIDATION_ERROR',`${label}格式不正确`);return s;};
export function key(value:any){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(value))fail('VALIDATION_ERROR','Idempotency-Key格式不正确');return value;}
export function point(value:any){
  if(value===null)return null;if(!value||typeof value!=='object'||Array.isArray(value))fail('VALIDATION_ERROR','point格式不正确');
  if(Object.keys(value).sort().join(',')!==pointKeys.slice().sort().join(','))fail('VALIDATION_ERROR','point字段不完整');
  if(value.system!=='WGS84'||value.source!=='DEVICE'&&value.source!=='MANUAL'||typeof value.latitudeE6!=='number'||!Number.isInteger(value.latitudeE6)||value.latitudeE6<-90000000||value.latitudeE6>90000000||typeof value.longitudeE6!=='number'||!Number.isInteger(value.longitudeE6)||value.longitudeE6<-180000000||value.longitudeE6>180000000||typeof value.confirmedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.confirmedAt))fail('VALIDATION_ERROR','point格式不正确');
  const date=new Date(value.confirmedAt);if(Number.isNaN(date.getTime())||date.toISOString()!==value.confirmedAt||date.getTime()>Date.now()+300000)fail('VALIDATION_ERROR','point确认时间不正确');
  return {system:'WGS84',latitudeE6:value.latitudeE6,longitudeE6:value.longitudeE6,source:value.source,confirmedAt:value.confirmedAt};
}
export function addressFields(body:any, update=false){
  const allowed=update?['expectedBookRevision','expectedRevision',...fields]:writeFields;const b=object(body,allowed);
  if(typeof b.expectedBookRevision!=='number'||!Number.isSafeInteger(b.expectedBookRevision)||b.expectedBookRevision<0||b.expectedBookRevision>2_000_000_000)fail('VALIDATION_ERROR','expectedBookRevision格式不正确');
  if(update)int(b.expectedRevision,'expectedRevision');
  return {expectedBookRevision:b.expectedBookRevision,...(update?{expectedRevision:b.expectedRevision}:{}),name:text(b.name,'name',1,40),phone:(()=>{if(typeof b.phone!=='string'||!/^[1][3-9]\d{9}$/.test(b.phone))fail('VALIDATION_ERROR','phone格式不正确');return b.phone;})(),region:text(b.region,'region',2,100),detail:text(b.detail,'detail',2,200),point:point(b.point),isDefault:typeof b.isDefault==='boolean'?b.isDefault:fail('VALIDATION_ERROR','isDefault格式不正确')};
}
export function versionBody(body:any){const b=object(body,['expectedBookRevision','expectedRevision']);return {expectedBookRevision:int(b.expectedBookRevision,'expectedBookRevision'),expectedRevision:int(b.expectedRevision,'expectedRevision')};}
export function pathId(id:any){if(typeof id!=='string'||id.length<1||id.length>200)fail('VALIDATION_ERROR','地址ID格式不正确');return id;}
