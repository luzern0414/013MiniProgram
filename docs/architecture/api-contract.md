# R1 API 合约与交接

日期 2026-10-20；已确认方案 A。此文档是各端实施的唯一合约。金额均为安全整数分，时间 ISO8601，ID 为 string。API base http://127.0.0.1:3000/api/v1（本地已运行，不是生产部署地址）。

## 认证与通用约定

- 成功 HTTP 200/201：{data:T,requestId:string}；失败：{error:{code:string,message:string,details?:unknown},requestId:string}。
- Authorization: Bearer token；写订单 Idempotency-Key。Error code 如 UNAUTHENTICATED、FORBIDDEN、VALIDATION_ERROR、STORE_CLOSED、OUT_OF_STOCK、PRICE_CHANGED、STATE_CONFLICT。
- GET /health 公共，返回 {status:'ok',database:'connected'}（数据库不可用不能仍返回 connected）。
- POST /auth/dev-login 仅 NODE_ENV 非 production 且 DEV_AUTH_ENABLED=true 时存在。body {account:'customer'|'owner'|'clerk-a'|'clerk-b'}；实际查开发种子中对应账户，不接收任意角色；返回 {token,user:{id,name,role,storeIds:string[]},environment:'development'}。
- POST /auth/wechat {code,client:'customer'|'merchant'}：未配置时 503 INTEGRATION_UNAVAILABLE，不伪造登录。
- GET /me：返回当前用户，商户需 storeIds；成员信息包含真实积分/余额（R1 若无账户可为0，但不得编造权益）。

## 业务读模型

Store = {id,name,address,phone,notice,isOpen:boolean,serviceModes:('DINE_IN'|'PICKUP'|'DELIVERY')[],pickupMinutes:number,deliveryFeeFen:number,minOrderFen:number,themeColor:string}。
Category = {id,name,sort:number}。
Product = {id,categoryId,name,description,imageUrl:string|null,unit:string,unitId:string|null,isAvailable:boolean,configurationRevision:number,specGroups:SpecGroup[],attributeGroups:AttributeGroup[],skus:Sku[],modifiers:Modifier[]}。unit 优先使用关联单位的当前名称，无关联的旧记录兼容原 unit 文本。
Sku = {id,name,enabled:boolean,priceFen:number,available:number,selections:{groupRef:string,valueRef:string}[]}。
Modifier = {id,name,enabled:boolean,priceFen:number,available:number}。
商品图片来源由后台保存；开发种子必须明确隔离并在应用显示“体验门店”，不要从前端常量填充业务列表。
GET /stores 公共：Store[]。
GET /stores/:storeId/catalog 公共：{categories:Category[],products:Product[]}。
GET /stores/:storeId/tables 公共（仅返回桌号基本资料）：{id,name,capacity,status:'FREE'|'OCCUPIED',code:string}[]。
GET /public-config?storeId=...：{brandId,brandName,environment:'development'|'test'|'production',home:{notice,bannerTitle,bannerSubtitle},theme:{primaryColor}}；允许无 storeId 返回品牌配置。brandId来自服务端公开品牌选择，用于员工登录，不接受前端写死体验品牌。

## 报价与订单

CartLineInput = {skuId:string,quantity:number,modifierIds:string[],attributeOptionIds?:string[]}；quantity 1..99，modifierIds 去重，同SKU不同加料或口味不合并。attributeOptionIds 省略视为[]，不能绕过必选组。
POST /quotes，需要客户或员工登录：{storeId,mode:'DINE_IN'|'PICKUP'|'DELIVERY',lines:CartLineInput[],tableCode?:string,address?:{name,phone,detail},note?:string,couponId?:string}。
返回 Quote = {id,storeId,mode,lines:{skuId,productName,skuName,quantity,unitPriceFen,modifierIds,modifiers:{id,name,priceFen}[],attributeOptionIds:string[],attributes:{groupId,groupName,options:{id,name}[]}[],configurationRevision:number,lineTotalFen}[],subtotalFen,packagingFeeFen,deliveryFeeFen,discountFen,totalFen,expiresAt}。
R1 无优惠券或有正确实现的券可为0折扣；传不存在或不支持的 couponId 必须显式拒绝，不能静默忽略。
POST /orders body {quoteId:string}，Idempotency-Key 必填；用户与报价所有者相符；返回 Order。
Order = {id,number,storeId,storeName,userId,mode,status,paymentStatus,refundStatus,subtotalFen,deliveryFeeFen,packagingFeeFen,discountFen,totalFen,note,tableName:string|null,pickupNumber:string|null,createdAt,lines:QuoteLine[],events:{id,status,label,createdAt}[],cashReceipt:null|{amountFen:number,tenderedFen:number,changeFen:number,refundedFen:number,shiftId:string|null},cashRefunds:CashRefundReceipt[],refundedFen:number,netPaidFen:number}。
现金回执取实际已提交流水；重试带不同实收金额也只返回原收款事实。界面不得用可变输入框的当前数值反算已成功回执。
status: PENDING_PAYMENT、AWAITING_ACCEPTANCE、PREPARING、READY、DELIVERING、COMPLETED、CANCELLED。
paymentStatus: UNPAID、PAID、CLOSED；refundStatus: NONE、PARTIAL、PROCESSING、SUCCEEDED、FAILED。
GET /orders?storeId=&status=：客户只看自己；员工仅允许门店；返回 {items:Order[],total,page,pageSize}，按 createdAt DESC、id DESC 稳定排序，pageSize 最多100。
可选配对查询 pickupNumber 与 pickupServiceDate：必须同时传入并明确 storeId；号码 trim 后转大写，支持 Q+至少4位数字或原10位十六进制，日期必须为真实 YYYY-MM-DD。缺失、空值、非法值、数组或对象均400 VALIDATION_ERROR，无权门店403。服务端在实时授权范围内叠加 mode=PICKUP、完整号码相等与日期谓词；新单匹配 pickupServiceDate，旧单该字段 null 时按 createdAt 的 Asia/Shanghai 当日半开区间 [00:00,次日00:00) 查询。顾客仍保留 userId 边界；不传两字段时保持原普通列表。total 仅计算匹配集，调用方须分页读取匹配结果，不能将首个局部页当作全部匹配。
GET /orders/:id 返回 Order 严格权限。
POST /orders/:id/cancel {reason?:string} 未付款取消释放库存；重复取消可安全返回原结果；已付款转退款策略，不能直接改未付款。
POST /orders/:id/payment {provider:'WECHAT'}：未配置 503；真实实现返回 requestPayment 参数，不能返回假已支付。

## 商户 API

以下必须员工授权，storeId 来自请求但服务端验证。
GET /merchant/overview?storeId=：{paidRevenueFen,refundFen,netRevenueFen,orderCount,pendingCount,preparingCount,readyCount,lowStockCount} 全部真实聚合。
PATCH /merchant/stores/:storeId body 只允许 {name,address,phone,notice,isOpen,pickupMinutes,deliveryFeeFen,minOrderFen,themeColor} 白名单；owner可维护门店规则，clerk仅营业状态。
GET /merchant/products?storeId=：{categories,products}，含不可售商品。
POST /merchant/products body {storeId,categoryId,name,description,imageUrl?,unitId?,unit?,skus:{name,priceFen,stock}[]} 当前门店 OWNER 权限。unitId 与 unit 至少一个，优先 unitId；同时传时名称必须一致。只传 unit 文本解析同品牌已有有效单位，不自动创建；不存在400 VALIDATION_ERROR、其他品牌403 FORBIDDEN、停用409 STATE_CONFLICT。
PATCH /merchant/products/:productId body {storeId,categoryId?,name?,description?,isAvailable?,imageUrl?,unitId?,unit?}。改分类时校验同品牌、启用及本店可见。没有改变单位时必须省略 unit/unitId；显式选择停用单位会409，原商品仅改名称/价格/库存不受其已有单位停用影响。商品新增/修改及规格写入在事务内复核当前 OWNER 与门店权限；分类和单位校验与商品写入、审计原子提交。
PATCH /merchant/skus/:skuId body {storeId,priceFen?,stock?}：stock 指可售库存，保留 reserved；审计旧值/新值。实际价格变化在同一事务递增商品 configurationRevision；价格相同或只改库存不递增。
POST /merchant/categories body {storeId,name}，归品牌；管理规则与其他分类/单位接口见下节。
POST /merchant/orders/:id/transition {action:'ACCEPT'|'START'|'READY'|'DISPATCH'|'COMPLETE'|'REJECT',reason?}，依合法状态转移；已支付拒绝需要真实退款或明确未完成错误，不能吞钱。
POST /merchant/orders/:id/cash-payment {tenderedFen:number}：仅授权员工确认现金，必须 >= totalFen；写现金收款、找零、原子确认订单；重复调用不重复入账；返回 Order。
POST /merchant/orders/:id/cash-refunds {storeId,amountFen,reason}，Idempotency-Key 必填，仅有效且获本店授权的 OWNER 确认已经实际退还的现金，返回当前 Order；详见下节。
GET /merchant/members?storeId=&search= 返回实际 {id,name,phone,levelName,balanceFen,points}[]，字段脱敏。
GET /merchant/staff?storeId= 返回实际 Staff[]，仅当前有效 OWNER 可读（员工凭据与授权规则见下节）。
GET /merchant/audit?storeId= 返回分页审计记录（不含密钥及密码）。

## 现金班次与交班（2026-10-21）

每店共享一个显式 OPEN 班次，有效 OWNER 开关班，本店有效 OWNER/CLERK 可读；写事务内再次校验会话、enabled、角色、品牌及本店授权。顾客/跨店/跨品牌/撤权403，未登录或失效401。新增现金收退款必须在原金融事务内先锁当前班次，再变更金融/库存、写凭证及 revision+1；没有活动班次409 SHIFT_REQUIRED。原成功收退款在授权后可重放，不要求当前有活动班次，不重归班、不增 revision/审计。完整退款关闭订单的原现金收款409规则保持。

```ts
type ShiftView = {
  id:string; storeId:string; state:'OPEN'|'CLOSED'; revision:number;
  openingFen:number; openedBy:{id:string;name:string}; openedAt:string;
  closedBy:{id:string;name:string}|null; closedAt:string|null;
  summary:{paymentCount:number;refundCount:number;paidFen:number;refundFen:number;
    netFen:number;expectedFen:number;countedFen:number|null;differenceFen:number|null;reason:string|null};
};
```

- GET `/merchant/cash-shifts?storeId=&state=OPEN|CLOSED|ALL&page=1&pageSize=20` → `{items:ShiftView[],total,page,pageSize}`，state 默认 ALL，按 openedAt/id 倒序，数据库过滤/计数/分页。page 正整数，pageSize 1..50，超出历史页返回空 items、真实 total。
- GET `/merchant/cash-shifts/current?storeId=` → `{shift:ShiftView|null}`；GET `/merchant/cash-shifts/:id?storeId=` → ShiftView，缺失404。OPEN 在同一 Serializable 快照聚合真实凭证并返回对应 revision；CLOSED 读取保存的固定汇总。
- POST `/merchant/cash-shifts`，严格 `{storeId,openingFen}`，必填 Idempotency-Key → 201 ShiftView。期初0..2000000000整数分；摘要包括操作者、门店、期初。相同 key/载荷返回原班次当前事实，即便它已关闭；异载荷409 IDEMPOTENCY_CONFLICT。同店已有活动班次409 SHIFT_ALREADY_OPEN；数据库部分唯一索引确保并发只开一班。
- POST `/merchant/cash-shifts/:id/close`，严格 `{storeId,expectedRevision,countedFen,reason?}`，必填 Idempotency-Key → 201 ShiftView。版本0..2000000000，实点0..2000000000整数分；reason trim 后最多500字，非零差额必须1..500字，零差额可省略或空。锁指定班次后先检查原 key，再核对 OPEN 和 expectedRevision；状态/版本变化409 SHIFT_CHANGED，客户端重读并明确再次确认。摘要覆盖操作者、班次、门店、原版本、实点和 trim 后原因；同 key 原载荷返回原关闭事实，异载荷409 IDEMPOTENCY_CONFLICT。一次关闭递增 revision 并只记一次 CASH_SHIFT_CLOSED 审计。
- 标识符为非空字符串最多200字，幂等 key 非空最多120字；所有数值拒绝字符串/数组/小数。query/body 严格白名单，拒绝客户端 shiftId/status/操作者/时间/汇总字段及其他未知字段，普通参数400。响应不含 key/hash、登录账号或凭据。
- 班次金额与固定快照使用数据库 BIGINT，聚合在 SQL 保留 BIGINT，所有公开金额及笔数转换前检查 JS 安全整数；汇总/版本溢出409 SHIFT_TOTAL_TOO_LARGE，金融与班次写入整笔回滚。应有=期初+sum(CashPayment.amountFen)−sum(CashRefund.amountFen)，净额与应有/差额允许负数；tenderedFen 不参与累计，changeFen 不重复扣减。关班只存真实汇总、实点、差异及原因，不调整订单、不产生虚假收入/退款。
- `Order.cashReceipt.shiftId` 与 `Order.cashRefunds[].shiftId` 兼容追加为 `string|null` 只读事实。收款归原销售发生班次，退款归实际退款时活动班次，不能继承原收款班次。迁移012只为原 CashPayment/CashRefund 加 nullable 字段，历史全部保持 null，不按日期猜填；null 明确表示历史未归班。原凭证金额、时间、员工和订单快照不改。日统计仍按各凭证 Asia/Shanghai 发生日，班次不因午夜自动关闭。
- 开关班未知结果必须保留原 key/载荷，GET失败、401/403均不得认为未发生；显式同 key 恢复核对后才解锁，不能自动开下一班。班次只代表当前现金渠道，微信/余额/应收等不在本合约中。

## 现金返款账本与真实日汇总（2026-10-20）

CashRefundReceipt = {id:string,amountFen:number,reason:string,createdAt:ISO8601,shiftId:string|null}。原现金收款凭证新增 refundedFen，详情和列表新增 cashRefunds、refundedFen、netPaidFen，所有客户端沿同一订单授权读取。cashRefunds 稳定按 createdAt/id 升序；不返回 staffId、员工账号、幂等键或摘要。历史未退款现金单返回 []、0、原 amountFen；无现金凭证返回 cashReceipt=null、[]、0、0，不生成虚拟凭证。

- POST /merchant/orders/:id/cash-refunds 严格只收 {storeId:string,amountFen:number,reason:string}。amountFen 为1至2000000000的整数分，reason 为去首尾空白后非空的原因（输入最多500字符）；Idempotency-Key 沿订单规则，为非空字符串、最多120字符。未知字段、强制转换、零/负数/小数或非法原因400 VALIDATION_ERROR。
- 经营者应已经把现金交还顾客后再确认；接口登记实际现金返还事实，顾客和 CLERK 不能确认，CLERK 仍可读取有权门店的凭证。本接口不代表微信原路退款或外部资金已经转移；微信支付/退款保持未接入。
- Serializable 事务内重验当前会话、enabled、OWNER、品牌、本店授权及订单归属，再检查原 CashPayment 与 PAID 状态。客户端不能传 paymentId 转移别店交易。跨店/品牌、撤权或非 OWNER 为403 FORBIDDEN，停用/过期会话401 UNAUTHENTICATED；无现金收款或未收款409 CASH_REFUND_UNAVAILABLE。
- 可退额=原 amountFen−refundedFen，不以 tenderedFen 为上限，不再次扣找零。多笔部分返款累计不超过原 amountFen；超额或最后可退额竞争失败409 REFUND_EXCEEDS_REMAINING。原收款 amountFen/tenderedFen/changeFen/staffId/createdAt 与订单菜品、金额快照均不改写。
- 幂等作用域为原 paymentId；请求摘要包含 orderId、storeId、amountFen 及 trim 后 reason。同key同载荷返回当前订单及原成功凭证，不新增返款、事件或审计；同key异载荷409 IDEMPOTENCY_CONFLICT。不同原收款可使用相同key。实时授权检查先于幂等返回，撤权后不能凭旧key读取经营凭证。结果未知时应先重读；需要确认本请求是否成功时以同key同载荷显式重放，不以列表里相同金额/原因推断归属。
- 返款成功后部分为 PARTIAL、累计达到原 amountFen 为 SUCCEEDED，paymentStatus 始终保留 PAID 表示原收款事实。全退将尚未完成的订单关闭为 CANCELLED 并追加“现金全额退款”原因；COMPLETED 保留原状态及旧完成事件。部分返款保留当前履约状态。关闭的全退单不可再次收款、制作或核销；原收款重放对其他合法订单保持兼容。顾客取消/员工拒单不直接退现金，提示由店主处理实际返款。
- 现金累计条件更新、CashRefund、订单状态、事件及 CASH_REFUND 审计原子提交。返款不增加商品或加料库存，不调用库存结算；已确认预约保持 CONFIRMED 与 confirmedCount，不回收已接单产能。需要补充可售量仍由现有有权库存入口独立处理并审计。
- GET /merchant/overview 的 paidRevenueFen 按 CashPayment.createdAt/amountFen 汇总，refundFen 按 CashRefund.createdAt/amountFen 汇总，均使用门店 Asia/Shanghai 当日 [00:00,次日00:00)；netRevenueFen=收入−退款，可为负。昨日收款今日返款不会改写昨日收入，不以订单创建日、totalFen 或 refundStatus 布尔代替凭证。cash-summary 模块提供同一日期范围和账本汇总供后续财务页复用。
- 增量迁移010新增 refundedFen 默认0、0≤累计≤原amountFen CHECK、新 CashRefund 正整数 CHECK、paymentId/key UNIQUE 与 CashPayment RESTRICT 外键；新增 SQL 时间默认显式使用 UTC，与 Prisma 一致。增量扩展原 Order CHECK 以允许 PARTIAL 和 CANCELLED/PAID/SUCCEEDED，保留原所有合法组合，不改旧列行或付款期限009规则。无 UPDATE/DELETE 返款API；财务事实追加记录，不覆盖旧凭证。

## 品牌分类与单位设置（2026-10-20）

SettingsCategory = {id,name,sort:number,enabled:boolean,revision:number,visibleStoreIds:string[]|null,productCount:number}。
Unit = {id,name,enabled:boolean,revision:number,productCount:number}。

- GET /merchant/catalog-settings?storeId= 返回 {canManageBrand:boolean,categories:SettingsCategory[],units:Unit[],stores:{id,name}[]}。要求当前门店的有效 OWNER/CLERK 授权。categories 按 sort、id 升序；stores 只含当前操作者授权的本品牌门店。canManageBrand 仅当 OWNER 拥有该品牌全部现有门店授权时为 true。不能管理品牌的用户看到的 visibleStoreIds 仅含可访问门店，不能据此写回全品牌配置。
- POST /merchant/categories {storeId,name} 返回201 SettingsCategory；默认 sort=0、enabled=true、revision=0、visibleStoreIds=null。
- PATCH /merchant/categories/:id {storeId,expectedRevision,name?,sort?,enabled?,visibleStoreIds?} 返回200 SettingsCategory。至少一个变更字段；名称去首尾空白后1至80字，sort 为0至100000整数，enabled 为布尔。visibleStoreIds=null 表示本品牌全部当前及未来门店，数组完整替换显式可见集合，[] 表示全部隐藏；省略则保留原值。数组最多100项，去重后逐项验证同品牌；其他品牌403 FORBIDDEN。
- DELETE /merchant/categories/:id {storeId,expectedRevision} 返回200 {id,deleted:true}。有任何商品引用时409 REFERENCE_CONFLICT，应先调整商品或停用分类。
- POST /merchant/units {storeId,name} 返回201 Unit，默认 enabled=true、revision=0。名称去首尾空白后1至20字，同品牌同名409 NAME_CONFLICT。
- PATCH /merchant/units/:id {storeId,expectedRevision,name?,enabled?} 返回200 Unit，至少一个变更字段。改名后所有关联商品的新查询显示新名称；订单、报价历史快照不改写。停用单位仍可供已关联商品展示及下单，不能在新增商品或单位变更时选择。
- DELETE /merchant/units/:id {storeId,expectedRevision} 返回200 {id,deleted:true}。有商品引用时409 REFERENCE_CONFLICT。
- 上述所有写操作要求有效 OWNER 且拥有该品牌全部现有门店授权；单店 OWNER、CLERK、跨品牌目标均403。每个操作在 Serializable 事务内实时复核会话、enabled、角色和当前授权，数据、可见关系、版本与审计原子提交。新门店加入而操作者尚未获授权时也不能修改品牌设置。
- PATCH/DELETE 的 expectedRevision 为0至2000000000整数，成功 PATCH 递增1；旧版本409 STATE_CONFLICT（与员工管理 VERSION_CONFLICT 区分），界面应刷新后重新确认，不自动覆盖。并发同版本修改最多一方成功。严格拒绝未知字段与空修改。错误响应均保留 requestId。
- 公开菜单同时过滤停用/本店隐藏分类及其商品。报价及下单也核验相同规则，包括已生成报价；失效返回409 CATALOG_CHANGED，提示刷新菜单。已经存在的订单现金、履约、取消和超时释放库存保持可用，重复下单幂等仍返回已有订单。
- 迁移006增加 Category 状态/版本/allStores、可见映射、品牌 Unit 与可空 Product.unitId，按商品所属门店的品牌和原 unit 文本去重、回填，原文本和商品记录完整保留。默认全品牌可见；不重置存量数据。跨域预检允许 DELETE，原认证和请求头规则保持。

## 门店商品规格、口味与加料配置（2026-10-20）

SpecGroup = {id,name,sort:number,enabled:boolean,values:{id,name,sort:number,enabled:boolean}[]}。
AttributeGroup = {id,name,sort:number,enabled:boolean,minSelections:number,maxSelections:number,options:{id,name,sort:number,enabled:boolean}[]}。
ProductOptions = {productId,configurationRevision:number,specGroups:SpecGroup[],skus:(Sku & {reserved:number})[],attributeGroups:AttributeGroup[],modifiers:(Modifier & {reserved:number})[]}。

- GET /merchant/products/:productId/options?storeId=... 返回200 ProductOptions。仅当前有效 OWNER 且获本门店授权可读写；不要求拥有品牌其他门店授权。包含全部停用记录、可售量 available 和预占 reserved，供编辑恢复；不返回组合键或 clientKey。
- PUT /merchant/products/:productId/options 请求完整树，成功200返回同 GET。顶层严格限定 {storeId,expectedRevision,specGroups,skus,attributeGroups,modifiers}；expectedRevision 为0至2000000000整数。单次成功保存递增配置版本一次，旧版本409 STATE_CONFLICT；并发同版本只成功一次。配置、身份/授权复核与审计在 Serializable 事务内完成。

```text
specGroups:[{id?,clientKey?,name,sort,enabled,values:[{id?,clientKey?,name,sort,enabled}]}]
skus:[{id?,name,enabled,priceFen,selections:[{groupRef,valueRef}],initialStock?}]
attributeGroups:[{id?,name,sort,enabled,minSelections,maxSelections,
                  options:[{id?,name,sort,enabled}]}]
modifiers:[{id?,name,enabled,priceFen,initialStock?}]
```

- 所有既有节点必须携带原 id 并完整保留，停用传 enabled=false；不提供硬删除端点。遗漏、重复、外来节点、错误父子归属均400 VALIDATION_ERROR。新节点不传 id，由后端生成身份；新维度/值以1至64位 a-zA-Z0-9_- 的唯一 clientKey 在本次请求关联。groupRef/valueRef 仅引用本次声明的 id 或 clientKey。响应中的 selections 仍用 groupRef/valueRef 字段，值全部为持久化 id；PUT 不接受 groupId/valueId。
- 所有配置名称 trim 后1至80字，sort 为0至100000整数，enabled 严格布尔；金额/库存为0至2000000000整数分/数量。最多3个规格维度、每维20个值，最多20个启用 SKU；最多5个属性组、每组10个选项，加料最多20项。存量超限树读取完整保留，编辑失败明确提示调整，不做迁移截断。属性规则 0≤minSelections≤maxSelections≤10；启用组必须至少有 minSelections 个启用选项。minSelections>0 即必选，不接收 required 字段。
- 启用 SKU 恰好为每个启用维度选择一个启用值；服务端按 groupId/valueId 排序生成组合键，同商品启用组合唯一。停用维度造成组合合并时400拒绝，需停用或调整重复 SKU。无启用维度时启用 SKU 名称不可重复。已停用 SKU 的派生键置 null，以允许保留历史身份；再次启用仍完整验证。组合键不接受客户端输入。
- initialStock 只用于新 SKU/Modifier，省略默认0；已有项传 initialStock、stock、available 或 reserved 均400。保存配置只更新名称、价格、启停及选项关系，保留原库存与预占；不重建既有身份。
- PATCH /merchant/modifiers/:id/inventory {storeId,expectedAvailable,available} 返回200 {id,available,reserved}；仅当前有效且有门店授权的 OWNER。以可售量条件更新，保留 reserved，并验证 available+reserved≤2000000000；旧可售量409 STATE_CONFLICT。库存修改不递增配置版本。提交结果未知时先重新读取核对，客户端不自动重发写入。
- 公共菜单只包含启用 SKU/加料、启用维度/值、启用属性组/选项和可售量，不返回 reserved；商户商品列表保留停用节点。分类停用、门店可见性和原单位兼容规则保持。
- 新报价逐项校验属性去重、归属、启停及组上下限，缺选、超选、重复或跨商品选项400 VALIDATION_ERROR；停用 SKU/加料也400。属性不加价、不占库存，加料在 SKU 价外加价并预占自己的库存。报价行与订单行保存 attributeOptionIds、attributes 名称/选项快照及 configurationRevision。
- 下单再次核对配置版本、启停、价格和属性规则，配置变更后旧报价409 PRODUCT_OPTIONS_CHANGED，提示刷新菜单；旧报价缺 configurationRevision 按0处理，未编辑的迁移商品仍可使用。既有价格防护 PRICE_CHANGED、分类 CATALOG_CHANGED 及缺货 OUT_OF_STOCK 保持；SKU改价接口实际改价会递增配置版本而得到 PRODUCT_OPTIONS_CHANGED。仅库存更新不作废报价，仍须库存充足。
- 已生成订单继续使用原快照；现金、履约、取消及超时释放可继续操作已停用 SKU/加料，不重写名称或价格历史。库存写入按加料 id 再 SKU id 的稳定顺序进行，配置保存保持相同库存锁顺序。上述错误均沿用 requestId 信封，401 UNAUTHENTICATED、403 FORBIDDEN 的认证规则不变。
- 迁移007仅增量添加模型与字段：Product.configurationRevision=0，Sku/Modifier.enabled=true，旧 SKU.combinationKey=null。旧 SKU/Modifier id、stock/reserved、报价/订单/会话完整保留，新引用关系的 SQL 与 Prisma 都使用 Restrict；不运行 reset 或在源库清理数据。

## 预约自提容量与取餐核销（2026-10-20）

PickupPolicy = {storeId,enabled:boolean,revision:number,timezone:'Asia/Shanghai',leadMinutes:number,maxAdvanceDays:number}。
PickupSlot = {id,storeId,startsAt:ISO8601,endsAt:ISO8601,capacity:number,heldCount:number,confirmedCount:number,enabled:boolean,revision:number}。
PickupWindow = {slotId,startsAt:ISO8601,endsAt:ISO8601,timezone:'Asia/Shanghai',serviceDate:'YYYY-MM-DD'}。

- GET /merchant/pickup-policy?storeId=... 返回200 PickupPolicy；GET /merchant/pickup-slots?storeId=...&from=YYYY-MM-DD&to=YYYY-MM-DD 返回200 PickupSlot[]，日期两端均包含、最多31天，按 startsAt/id 排序。只允许有效且有本店授权的 OWNER/CLERK；读取不创建配置。
- PUT /merchant/pickup-policy {storeId,expectedRevision,enabled,leadMinutes,maxAdvanceDays} 返回200 PickupPolicy。仅本店有效 OWNER；leadMinutes 为0至1440整数，maxAdvanceDays 为1至90整数，enabled 为布尔，expectedRevision 为0至2000000000整数。保存递增 revision 并记录审计，旧版本409 STATE_CONFLICT。默认显式关闭、提前15分钟、最远14天、固定上海时区，不接受客户端时区输入。
- POST /merchant/pickup-slots {storeId,slots:[{startsAt,endsAt,capacity}]} 返回201 PickupSlot[]。仅本店 OWNER；一次1至96个时段，全成或全败。时间必须是带 Z 或数值时区的 ISO8601，秒必填、可含1至3位毫秒，保存UTC；同一上海日期内长度5至240分钟，起止递增，capacity 为1至1000笔订单的整数。禁止批内重叠及与本店既有（包括停用）时段重叠，相邻可用，跨午夜需拆分日期。参数错误400 VALIDATION_ERROR，既有重叠或并发冲突409 STATE_CONFLICT；并发写由 Serializable 事务防护。
- PATCH /merchant/pickup-slots/:id {storeId,expectedRevision,enabled,capacity} 返回200 PickupSlot。仅本店 OWNER；跨店403 FORBIDDEN，旧版本409 STATE_CONFLICT。容量不可低于 heldCount+confirmedCount，违反409 STATE_CONFLICT。起止时间不通过此接口改动，无删除接口，关闭后可按原 id 恢复。容量、启停、版本和前后审计同事务提交。
- GET /stores/:storeId/pickup-slots?date=YYYY-MM-DD 返回200 {id,startsAt,endsAt,timezone,remaining}[]；先按 PublicBrand 验证公开门店归属。门店休息、不支持自取、政策缺失/关闭、时段关闭、开始时间早于当前时间加提前量、日期超过最远预约日、满额均不提供可选项。最远天数以门店当地日期计算，最远日包含当天全部时间。列表余量不构成承诺，不返回订单/客户数据。
- POST /quotes 新增可选 pickupSlotId:string，仅 PICKUP 可用；省略表示即时自取。公开报价新增 pickupWindow:PickupWindow|null，内部报价保存时段/政策 revision；报价不占容量。下单在原加料→SKU预占后，复核门店、政策/时段版本、当前时间及余量，再以计数 CAS 预占并创建 HELD 预约，同事务分配取餐号及保存不可变窗口快照。库存、容量、序列、订单任一失败全部回滚；幂等重放先返回原订单。旧报价无已知预约版本字段时按即时自取兼容。
- 预约下单：经营版本改变409 PICKUP_RULES_CHANGED；时间已不满足提前量/最远日期409 PICKUP_TIME_UNAVAILABLE；满额409 PICKUP_SLOT_FULL；跨门店403 FORBIDDEN。报价不可预约/满额对应 PICKUP_TIME_UNAVAILABLE/PICKUP_SLOT_FULL。所有请求严格白名单，保留既有错误信封和 requestId；写入结果未知时真实重读，不自动重发。
- 新 PICKUP 订单新增 pickupServiceDate:string|null、pickupOrdinal:number|null、pickupWindow:PickupWindow|null。预约序列日期取时段开始时间的上海日期，即时单取创建当日；同门店同履约日期从1递增，显示 Q0001、Q0002 至 Q10000 等，不截断、不回收取消号码。不同门店或日期可同号；查询/核销始终以订单和门店上下文授权，不以号码公开检索他人订单。DINE_IN 无取餐号；DELIVERY 继续返回未配置错误。
- 现金确认将 HELD→CONFIRMED、heldCount减1、confirmedCount加1；未付款取消/拒单/超时仅 HELD→RELEASED 并释放一次。现金与取消并发依原订单事务解决。已付款或已完成不归还已接单产能；已付款拒绝/取消继续返回 REFUND_UNAVAILABLE。关闭或修改政策、关闭时段不阻断已成立订单现金、履约和未付款释放。
- POST /merchant/orders/:id/pickup {storeId,pickupNumber} 返回201 Order，仅有本店权限的有效 OWNER/CLERK。必须 PICKUP、已付款且 READY，号码必须与当前订单一致；错误号码400 VALIDATION_ERROR，错误状态409 STATE_CONFLICT，跨店403 FORBIDDEN。复用履约事务及 COMPLETE 审计/事件；相同号码重提已完成订单返回已完成结果，不重复增加完成事件。号码是员工叫号标识。原通用 transition 接口兼容保留，旧10位十六进制号仍可展示/核销，不重编号。
- 迁移008为全部现有门店建立关闭政策，订单新增字段为 null，旧报价/订单/现金/库存/会话不改写。显式 seed 新门店与关闭政策在同次嵌套创建提交；重复 seed 不重设既有政策。当前没有门店新建API。异常缺政策时经营 GET 返回409 PICKUP_CONFIGURATION_MISSING，OWNER 通过 expectedRevision=0 的 PUT 显式初始化；公开列表为空，即时单不受影响。未来新增门店事务须同时初始化政策，不能靠GET补写。

## 员工凭据与授权（2026-10-20）

Staff = {id:string,name:string,role:'OWNER'|'CLERK',account:string|null,enabled:boolean,revision:number,storeIds:string[]}。account=null 表示尚未建立员工凭据的既有身份。响应、审计均不含密码或 passwordHash。

- POST /auth/staff-login {brandId:string,account:string,password:string}，成功201返回 {token,user:{id,name,role,brandId,storeIds,balanceFen,points,levelName},environment:string}；environment 为实际 NODE_ENV（未设置时 development）。账号不区分大小写；密码保留首尾空白。错误密码、不存在、已停用账号统一401 UNAUTHENTICATED / 账号或密码不正确。相同客户端 IP+品牌+规范化账号15分钟最多10次尝试，超限429 RATE_LIMITED；进程内窗口最多5000项。结构错误400，不计入登录次数。当前 OWNER 与 CLERK 均可通过真实凭据登录；首位 OWNER 使用受控离线命令初始化，命令及受限文件步骤见config/README.md，无凭据的旧OWNER不会获得默认密码。
- POST /auth/logout {}，201返回 {revoked:true}，只撤销请求 Bearer token 对应会话；重复、过期或缺失 token 均安全返回。其他设备会话不受本次退出影响。
- GET /merchant/staff?storeId=，200 Staff[]：仅列同品牌且授权包含查询门店的 OWNER/CLERK，最多100条；storeIds 仅包含查询者当前有权管理的门店。跨品牌、查询门店未授权或非 OWNER 均403。
- POST /merchant/staff {storeId,name,account,password,storeIds:string[]}，201 Staff：服务端固定创建 CLERK，拒绝 role 等未知字段；账号同品牌唯一，冲突409 ACCOUNT_CONFLICT。新建授权必须包含当前 storeId。
- PATCH /merchant/staff/:id {storeId,expectedRevision:number,name?:string,enabled?:boolean,storeIds?:string[]}，200 Staff。至少一项变更；只允许编辑同品牌 CLERK；目标必须当前授权包含 storeId，且其全部既有授权门店与新授权门店都在操作者当前集合内。OWNER、他品牌、存在不可管理门店的目标均403。账号创建后不通过此入口修改。
- POST /merchant/staff/:id/reset-password {storeId,expectedRevision:number,password:string}，201 Staff，同样 OWNER 及目标管理权限。密码重设只保存新随机盐的 scrypt 凭据。
- expectedRevision 为非负整数（不超过2000000000）；每次成功编辑/重设递增1，旧版本409 VERSION_CONFLICT，调用方应刷新并重新确认变更。授权更换、停用、重设密码都在同一事务中撤销目标全部会话。姓名编辑和启用不会撤销会话。旧版本失败、权限失败不修改任何表。
- 姓名1至80字符且不得全为空白；账号3至64位，仅字母/数字/点/下划线/短横线，服务端转小写，不自动去除空白；创建/重设密码12至128字符，不 trim；storeIds 非空数组，输入最多100项，去重后逐一校验同品牌及操作者门店集合。
- 有效会话每次请求实时查询 enabled 和授权；停用开发身份后，既有开发会话及 dev-login 也不能绕过限制。事务内重新验证 OWNER 的有效会话、角色、品牌和授权，写入、revision、门店关系、会话撤销与不含凭据的审计原子提交。
- scrypt 参数受控：N=16384/r=8/p=1，32字节输出，16字节随机盐，64MiB maxmem；版本化格式严格解析，timingSafeEqual 比较；不存在账号也执行一次同参数校验。500日志仅保留 requestId、错误类型及受控 Prisma 代码，避免查询参数泄露凭据。

此模块及首位OWNER离线初始化已完成本地真实CLI/API/PostgreSQL验证；不表示完整经营角色体系、微信身份或生产部署已完成。OWNER密码恢复尚待实施。

## CMS

GET /merchant/page?storeId=：{draft:{notice,bannerTitle,bannerSubtitle,primaryColor},published:{...},version:number}。
PUT /merchant/page?storeId= body {notice,bannerTitle,bannerSubtitle,primaryColor} owner仅保存草稿。
POST /merchant/page/publish?storeId= {expectedVersion:number} owner发布，经版本校验，public-config读取已发布版本。
只读发布内容存DB，不要直接让前端修改 config 文件。

## 登录联调与隔离

开发 seed 创建明确“体验品牌”“体验门店 · 梧桐里”“体验门店 · 湖滨”，提供 customer/owner/clerk-a/clerk-b 四个固定开发身份，DEV_AUTH 仅能在非生产启动。测试环境独立 PostgreSQL schema 或 database。密码与真实生产初始化分别实现，不用开发角色通道承接生产。

数据库开发启动采用本项目专用 portable PostgreSQL 16，loopback 127.0.0.1:55432；不接触电脑其他项目的数据库。生产通过 DATABASE_URL 使用受控 PostgreSQL。主进程与各子任务的文件所有权按计划划分，禁止多个任务同时修改同一个配置或 lockfile。

## 收银挂单与取单（2026-10-20，API）

```ts
type DraftSelection = {
  mode: 'PICKUP' | 'DINE_IN'; tableCode?: string; pickupSlotId?: string; note: string;
  lines: {skuId: string; quantity: number; modifierIds: string[]; attributeOptionIds: string[]}[];
};
type DraftWrite = {storeId: string; name: string; selection: DraftSelection};
type DraftEdit = DraftWrite & {expectedRevision: number};
type DraftVersion = {storeId: string; expectedRevision: number};
type DraftView = {
  id: string; storeId: string; name: string; revision: number;
  state: 'DRAFT' | 'CONVERTED' | 'CANCELLED'; selection: DraftSelection;
  display: {lines: {skuId: string; productName: string; skuName: string;
    modifierNames: string[]; attributeNames: string[]}[]};
  orderId: string | null; createdAt: string; updatedAt: string;
};
```

- GET /merchant/cashier-drafts?storeId=&state=DRAFT&page=1&pageSize=20 返回200 {items:DraftView[],total,page,pageSize}。state默认DRAFT，允许DRAFT/CONVERTED/CANCELLED；page为正安全整数，pageSize为1至50整数。按当前授权门店/state数据库谓词、updatedAt DESC/id DESC分页，total是真实总数；超出末页返回空items。未知字段、非整数字符串、数组及超范围参数400。
- GET /merchant/cashier-drafts/:id?storeId= 返回200 DraftView；跨店403，当前授权下不存在404。不返回createKey、createHash或员工账号。
- POST /merchant/cashier-drafts 请求DraftWrite，必须携带Idempotency-Key（1至120字符），返回201 DraftView，默认DRAFT/revision=0。同门店同key、同创建者及规范化输入返回草稿当前事实，之后已编辑/取消/转单也不再创建或新增审计。同key异载荷或不同创建者409 IDEMPOTENCY_CONFLICT；权限重验先于幂等返回。
- PUT /merchant/cashier-drafts/:id 请求DraftEdit，返回200 DraftView；POST /merchant/cashier-drafts/:id/cancel 请求DraftVersion，返回201 DraftView。expectedRevision为非负安全整数，正常编辑/取消递增1，旧版本或非DRAFT状态409 DRAFT_CHANGED。重复取消已CANCELLED返回现有事实，不额外审计；CONVERTED编辑/取消均409 DRAFT_ALREADY_CONVERTED，应GET获取orderId。
- POST /merchant/cashier-drafts/:id/quote 请求DraftVersion，返回201现有报价视图加cashierDraft:{id,revision}，仅DRAFT且版本匹配才可报价；公共POST /quotes不能传入该绑定。草稿报价复用OrdersService.quoteInTransaction，同一Serializable事务内复核权限、草稿版本和完整当前商品/属性/库存/门店/预约规则，不占库存、预约、取餐号或现金。
- POST /orders {quoteId}及其Idempotency-Key保持原订单合约。服务端识别报价快照中的cashierDraft绑定，在原下单Serializable事务内复核当前本店staff、草稿DRAFT/revision、报价归属/有效期以及当前可售/预约规则，再按原逻辑预占并创建订单，CAS将草稿置CONVERTED、revision+1并绑定唯一orderId，同时写审计；任一步失败全部回滚。不同key或另一报价第二次转单409 DRAFT_ALREADY_CONVERTED；草稿修改后旧报价409 DRAFT_CHANGED。原成功key回执丢失可恢复原订单，恢复前仍重验当前员工角色、enabled、品牌和本店授权，不重复预占。正式订单后续取消、过期或退款不会恢复草稿。
- 所有草稿读写仅限当前有效且有本店授权的OWNER/CLERK；顾客、跨店、跨品牌、停用及撤权身份拒绝。每次写事务内重验权限；读取不创建记录。新增、修改、取消与转换审计跟业务写入同事务。
- name trim后1至60字符，note必须字符串、最多500字符且可空；1至100行，每行数量1至99整数。modifierIds必须数组、输入最多20项、去重后稳定排序；attributeOptionIds必须数组、最多50项、重复拒绝并稳定排序。标识符必须非空字符串且最多200字符。严格拒绝客户端价格/金额、状态、revision赋值、orderId、display及所有未知字段。
- DINE_IN必须核对本店tableCode且不能带pickupSlotId；PICKUP不能带tableCode；配送拒绝。保存只核对SKU/加料/属性所属商品及预约/桌码所属门店，允许仍存在的停用、缺货或过期选择持久保存，不预占。display由服务端当前记录生成；已删除或无法解析的选择400提示重新核对，原草稿与原输入不自动清除或替换。重新报价使用当前规则和当前价格。
- 迁移011只新增CashierDraft表、索引和RESTRICT关系；revision>=0、三值状态、CONVERTED当且仅当orderId非空、orderId唯一。新草稿createdAt默认显式UTC，updatedAt由服务端UTC写入，不修改任何旧列、订单快照或历史时间。隔离测试通过不表示源库已迁移或前端/真机/生产已验收。


