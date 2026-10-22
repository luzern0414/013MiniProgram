# 顾客地址簿实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. 同时一个实现者，每任务独立Spec/Quality审查；源业务与迁移由root独占。

**Goal:** 建立本人地址管理、默认地址并发保护和持久写入恢复，为已批准的外卖点单提供真实地址依赖。本计划只交付地址簿；配送规则计价、配送任务随后各自实施，不将地址簿完成标作完整REQ006。

**Architecture:** User拥有唯一地址簿，所有变更在Serializable事务内锁地址簿，核对地址/地址簿版本并写操作凭证。uni-app顾客端复用独立shared控制器；地址列表、表单与配送点确认分开，身份或网络变化不能丢原尝试。

**Tech Stack:** 当前NestJS11/Prisma6.19/PostgreSQL16、Vue3/uni-app/mini-core；不升级依赖。承接已批准总体设计及细化设计docs/superpowers/specs/2026-10-21-delivery-address-design.md中“地址簿”部分，研究docs/research/2026-10-20-delivery-pickup-research.md。现金班次三任务及root真实验收已完成c724d2a，不再重复。

## Global Constraints

- 正式业务数据全部通过后端读写数据库；不得伪造成功。
- 保留development/public全部已有商品、订单、现金、退款、库存、草稿和会话，不删库重置；迁移必须可作用于现存数据，旧金额/时间/操作者/快照不可改写。
- 地址信息按登录用户与品牌隔离，员工不能枚举顾客地址簿。一个用户最多20个未删除地址、最多一个默认地址，允许没有默认地址。删除默认地址后不擅自将其他地址设默认。
- 删除采用软删除，历史订单中的地址快照不变；界面列表只显示未删除地址。
- 所有新增/修改/默认/删除写入前重验当前顾客身份及归属。新增和全部变更有Idempotency-Key。
- 原key同载荷重放返回已成功的操作凭证及地址当前事实；若地址后来又修改/删除，要明确显示现状，不能把过去成功说成当前再次保存成功。原key异载荷409。
- 所有端的409保留输入，用户明确读取最新后再决定覆盖，不自动换revision重发。
- 操作unknown持久保留原身份、key和body；查询失败/401不清记录。重新登录同身份后显式重放，其他身份无法读取该恢复记录或原地址内容。
- 本地阶段统一使用WGS84存储和计算。GCJ-02输入不能仅改标签保存。经纬度用整数微度，纬度-90000000..90000000、经度-180000000..180000000；拒绝NaN、Infinity、字符串和非整数。
- 定位只协助选择收货点，不能将当前位置悄悄当成另一地址的坐标。重新定位或选择地址必须让用户确认。
- 没有可用地图检索/逆地理编码时不放虚构地图或宣称已定位具体楼栋。
- 所有界面文字原则上不得小于14px，提交禁重，失败提示清晰，保留requestId。动效尊重reduced-motion。
- 当前没有AppID/支付/域名/服务器资源，继续本地验收，不声称真机或生产已验证。

## 固定数据与API合约

本计划新增3表，迁移202610210013_customer_addresses。CustomerAddressBook以userId为主键FK User，revision Int默认0、updatedAt显式UTC。CustomerAddress含id、userId(FK book.userId)、revision Int默认0、name、phone、region、detail、point Json?、isDefault默认false、deletedAt?、createdAt/updatedAt。CustomerAddressOperation以(userId,key)唯一，kind、requestHash、addressId(FK address)、resultAddressRevision、resultBookRevision、createdAt，**不保存联系人/电话/地址正文**。所有新FK onDelete RESTRICT；User仅增加反向关系。地址新增前原子upsert簿，再SELECT FOR UPDATE锁；raw40001/40P01转换为既有整事务有界重试，不能吞错或只重试最后SQL。

数据库部分唯一索引(userId) WHERE isDefault AND deletedAt IS NULL；CHECK deletedAt非null时isDefault=false、revision为0..2000000000，kind只能CREATE/UPDATE/DEFAULT/DELETE。point的结构由严格API白名单校验；JSON不得含任意扩展属性。20条容量通过同簿行锁计数与事务保护，不能用前端限制代替。任何版本增量超过2000000000返回409 ADDRESS_VERSION_LIMIT并整体回滚。

```ts
type AddressPoint = {
 system:'WGS84'; latitudeE6:number; longitudeE6:number;
 source:'DEVICE'|'MANUAL'; confirmedAt:string; // 严格UTC ISO，用户明确确认的声明，不是服务端核实真实地理位置
};
type AddressFields = {name:string;phone:string;region:string;detail:string;point:AddressPoint|null;isDefault:boolean};
type AddressView = AddressFields & {id:string;revision:number;deletedAt:string|null;createdAt:string;updatedAt:string};
type AddressWrite = {operation:{kind:'CREATE'|'UPDATE'|'DEFAULT'|'DELETE';addressId:string;addressRevision:number;bookRevision:number;succeededAt:string};address:AddressView;bookRevision:number;replayed:boolean};
```

name trim后1..40字，phone只接受大陆11位手机`^1[3-9][0-9]{9}$`，region trim后2..100字，detail trim后2..200字；name/region/detail禁止控制字符，不对地址做虚假真实性断言。point必填null或完整对象，confirmedAt严格`YYYY-MM-DDTHH:mm:ss.sssZ`且可往返同值、不晚于服务端当前5分钟，允许保留过去明确确认时间；改街道/地区时前端要求重新确认配送点或保存null。字段缺失、额外属性、错误类型一律400；isDefault必须boolean。Idempotency-Key必须1..120个`[A-Za-z0-9_-]`字符。路径id1..200字，非法ID400。他人/其他品牌/不存在地址统一404 ADDRESS_NOT_FOUND，未登录401，OWNER/CLERK403，不存在推测信息。

```text
GET /customer/addresses                       -> {items:AddressView[],bookRevision:number,limit:20}
GET /customer/addresses/:id                   -> {address:AddressView,bookRevision:number}
POST /customer/addresses                      {expectedBookRevision,...AddressFields}
PUT /customer/addresses/:id                   {expectedBookRevision,expectedRevision,...AddressFields}
POST /customer/addresses/:id/default          {expectedBookRevision,expectedRevision}
POST /customer/addresses/:id/delete           {expectedBookRevision,expectedRevision}
```

所有写返回AddressWrite，HTTP201(POST)或200(PUT)，遵循现有data/requestId envelope。未建簿时GET列表返回空/revision0且**不写数据库**；按id读取本人软删除地址仍返回事实供恢复，列表不含deleted。排序默认优先、updatedAt降序、id降序。请求中不允许userId/brandId。输出不含这两个字段、key/hash或内部操作id。

写事务：验证当前CUSTOMER身份→upsert簿与锁→再次读取当前身份→同userId/key查操作。重放在CAS及容量检查前，hash绑定kind/目标id/完整规范化载荷（含原expectedRevision和expectedBookRevision）；同hash返回原操作凭证和**当前**本人地址、当前bookRevision、replayed=true，不再写地址/版本/时间。新操作检查bookRevision及地址revision；冲突409 ADDRESS_CHANGED，容量409 ADDRESS_LIMIT。目标deleted时新写409 ADDRESS_DELETED。正常写对目标revision+1（CREATE为0）、簿revision+1，并写唯一操作凭证。设新默认先取消旧默认并使旧地址revision+1/updatedAt改变，再设置目标；同目标已默认也遵循一次新确认的版本增量，但一key只一次。UPDATE允许isDefault=false取消自己的默认；DELETE清isDefault并标deletedAt，不选择替代默认。操作失败、日志写失败或版本溢出整体回滚。两并发默认切换同bookRevision至多一个成功，失败者明确重读。

客户端规范：持久键`customer-address:v1:<encodeURIComponent(userId)>`，记录schemaVersion1、userId、kind、addressId(新建无)、key、method、path、body。storage缺失返回undefined；空串/null/损坏视为需核对。写前set/readback，失败不发请求；成功remove/readback，失败继续锁。只保存原尝试，非必要不缓存整份地址簿。按原身份发现记录，不能扫描/展示其他身份数据。登录过期清视图但不删原记录。

初次明确400 VALIDATION_ERROR、409 ADDRESS_CHANGED/ADDRESS_LIMIT/ADDRESS_DELETED，且此前非unknown时可取消本次未提交的attempt并保留表单及原错误；ADDRESS_CHANGED开启review，必须显式重读后再确认新版本。网络、超时、500、401/403、无效响应或恢复重放失败一律保持原pending，不凭读到相似地址解锁。`recover('read')`只读最新列表/目标，不清原pending；`recover('replay')`明确使用原key/body，确认operation与kind/id/版本匹配且当前地址归属结构有效后解锁。replayed且当前revision或deletedAt超过原结果时显示“原操作已完成，地址之后有变更，请查看最新内容”，不覆盖用户编辑稿。

## Task 1: 地址簿API、并发与增量迁移

**Files:** Create apps/api/src/modules/addresses/{addresses.controller.ts,addresses.service.ts,addresses.validation.ts,address-book.ts}；Modify apps/api/src/app.module.ts、apps/api/prisma/schema.prisma；Create apps/api/prisma/migrations/202610210013_customer_addresses/migration.sql、apps/api/tests/{customer-addresses.test.ts,customer-addresses-schema.cjs,run-customer-addresses.cjs}、docs/tasks/customer-addresses-api-report.md；API文档沿既有docs/api目录选择对应合同文件。只实现本任务，不改顾客/Web/商户源码。

**Interfaces:** 消费AuthService.user(req,tx)、Db.atomic(fn)与DomainError现有envelope；产出上述固定HTTP合同及数据库不变量，后续顾客UI只通过HTTP调用。

- [ ] **1. 聚焦RED。** 在随机test_customer_addresses_*受限schema创建真实HTTP应用，用真实CUSTOMER及另一用户/另一品牌/OWNER/CLERK夹具，断言GET200空列表、POST成功后可重读。源地址尚不存在时应实际404，使测试因业务缺失失败，记录输出。

```ts
const firstRequestBody = {expectedBookRevision:0,name:'本地验收',phone:'13800000000',region:'本地验收地区',detail:'本地验收地址一号',point:null,isDefault:true};
const first = await req('/customer/addresses', customer, firstRequestBody, 'POST', 'address-create-a');
assert.equal(first.status,201);
assert.equal(first.body.data.address.isDefault,true);
assert.equal(first.body.data.bookRevision,1);
const replay = await req('/customer/addresses', customer, firstRequestBody, 'POST', 'address-create-a');
assert.equal(replay.body.data.operation.addressId,first.body.data.address.id);
assert.equal(replay.body.data.replayed,true);
```

运行`node apps/api/tests/run-customer-addresses.cjs`，内部实际调用`node --import tsx --test apps/api/tests/customer-addresses.test.ts`。schema守卫按现有cash-shifts-schema.cjs成熟模式限定本地55432、项目标记、独有前缀和OID/owner，所有测试子进程入口先验；CREATE碰撞不能DROP非自有schema。夹具seed仅限自建隔离schema，禁止源seed。

- [ ] **2. 模型/迁移/锁。** 按固定3表及检查/索引/FK写迁移；不改任何旧列或猜填地址。生成前通知root模型已就绪，等待root精确停本项目API后才generate；不得自行停服务、源迁移或启动新API。fixture先应用到012、抓全部旧列含timestamp原始文本，再执行013并逐行比较。验证部分唯一/default删除检查、FK RESTRICT、错误revision、迁移默认时间UTC；碰撞schema原行保持。地址簿锁和完整事务重试依照既有cash-shift-ledger捕获P2010/meta40001或40P01→P2034模式，不全局放宽重试。

- [ ] **3. 验证与路由。** 按严格白名单/字段/坐标/版本及phone合同；AddressView仅投影公开字段。读无簿不写；读写只允许CUSTOMER，跨身份/品牌统一404。事务内重验身份，目标按userId查询。所有变更同簿锁、规范hash/同key先重放、CAS、修改行/版本/操作日志原子完成，异常回滚。列表不含删除，但本人详情可供恢复读取删除事实。

- [ ] **4. 真实HTTP边界GREEN。** 覆盖新增/编辑/默认/取消默认/删默认不指定替代/软删重放、同key异载荷、原成功后再编辑/删除仍返回原operation+当前事实且无再次写；两默认竞争不会双默认、并发第20/21地址容量、同key并发只一操作、旧版本409、跨用户/品牌/员工/撤权拒绝、额外字段和坐标范围/非整数/GCJ/时间/false与null边界、日志故障整体回滚及版本上限。旧业务/历史Order.address逐行保持，响应及日志不得泄露其他人电话或key/hash。

```ts
const setDefault = (address:any, bookRevision:number) => req('/customer/addresses/'+address.id+'/default',customer,{expectedBookRevision:bookRevision,expectedRevision:address.revision},'POST','default-'+address.id);
const competing = await Promise.all([setDefault(addressA,bookRevision),setDefault(addressB,bookRevision)]);
assert.deepEqual(competing.map(x=>x.status).sort(),[201,409]);
assert.equal(await db.customerAddress.count({where:{userId:customerId,isDefault:true,deletedAt:null}}),1);
const oldOperation = await req('/customer/addresses',customer,firstRequestBody,'POST','address-create-a');
assert.equal(oldOperation.body.data.operation.addressRevision,0);
assert.ok(oldOperation.body.data.address.revision>0);
assert.equal(oldOperation.body.data.replayed,true);
```

- [ ] **5. 最终验证/提交。** 运行专项源码及`CUSTOMER_ADDRESSES_TEST_BUILD=true`编译路径、`pnpm --filter @restaurant/api build`/typecheck，相关auth/domain回归一次；禁止重跑无关金融suite。完整报告写docs/tasks/customer-addresses-api-report.md，给出RED/GREEN命令和输出、真实HTTP/数据库约束/并发覆盖、旧列原时间保留及准确未覆盖范围。显式暂存本任务文件、Codex/codex@local.invalid提交，自审后返回SHA/一行测试/关注点。root独立审查通过前不应用源迁移或派Task2。

**Root gate:** 独立Approved→fresh旧列/raw时间基线→全新备份并实际恢复→旧非Session列时间对照→只应用013 development→前后所有旧列核对→API编译健康及只读空地址端点。保留全部旧备份和restore库，不切换源URL。已有21订单/14现金36806/5退款5483/3关闭班仅作当前参考，迁移前重新读取实际基线，不能拿旧数字当新事实。

## Task 2: shared恢复与顾客地址界面

**Files:** Create packages/mini-core/src/customer-addresses.mjs、tests/customer-addresses.test.mjs；Modify index.mjs导出；Create apps/customer-mini/src/addresses.js、components/{CustomerAddresses.vue,AddressForm.vue,AddressPoint.vue,AccessibleInput.vue}（AccessibleInput如需复制须抽为共用组件或使用已有共享入口，不能复制整份商户实现）；Modify customer.js和pages/index/index.vue最小集成；Create packages/mini-core/tests/customer-addresses-{customer.test,sfc.test}.mjs、docs/tasks/customer-addresses-ui-report.md。不改商户/API。

**Interfaces:** `createCustomerAddresses({state,storage,request,context:()=>({userId,identity}),key,locked})`，产出load/get/create/update/setDefault/remove/reloadForReview/recover('read'|'replay')/dispose及state；context identity为当前登录对象或稳定会话代数，不只比较同账号id。导出addressStorageKey/readAddressAttempt/validAddress。请求适配与uni储存枚举/readback沿已有mini-core成熟接口。

- [ ] **1. 控制器RED。** 覆盖真控制器挂起Promise/storage：缺失与损坏、写存失败不发POST、删后readback失败继续锁；任意写unknown原key/body、GET失败/401/403保持、刷新与同身份重新登录发现；同账号新会话/其他账号/dispose不能接受旧结果或泄漏地址。地址簿属于品牌内用户而非门店，普通同品牌切店不会产生第二份地址簿；busy/unknown期间仍按集成锁禁止切店。初次明确CAS409保留字段，显式重读再确认；unknown重放409不得清记录。replayed旧operation+当前新revision/删除事实不宣称刚保存成功。提供实际断言而非源码正则。

```js
const sent=[];const ctl=createCustomerAddresses({state,storage,request:async(path,options)=>{sent.push({path,options});throw Object.assign(Error('offline'),{code:'NETWORK_ERROR'});},context:()=>({userId:'u1',identity:session}),key:()=> 'original-address-key',locked:()=>false});
await ctl.create();
assert.equal(state.blocked,true);
assert.equal(storage.get(addressStorageKey('u1')).key,'original-address-key');
await ctl.recover('read');
assert.equal(state.blocked,true);
```

- [ ] **2. 持久恢复与身份。** 请求发送前完整保存并回读；有效响应先验证作用域/结构与operation，再发布/清记录。原尝试永不换key/body。地址锁与原订单pending/busy按OR组合，持久发现不依赖地址组件挂载；在我的及登录恢复后的主界面有明确入口。地址pending不解锁原订单、原订单pending不隐藏地址恢复；两者若同时存在，允许顺序核对而不要求新交易。登录过期先dispose清地址列表/编辑PII视图，再保留按原身份隔离的pending；其他身份不展示原记录。现有customer.js异步返回在新改集成边界后验证身份/代数，不做无关重构。

- [ ] **3. UI。** 我的→收货地址，新增/编辑/设默认/删除确认、默认标记及20上限提示、空/读失败/存储损坏/忙/原操作恢复、版本冲突保留输入与显式重读。独立组件，不将CRUD塞进index。region/detail清楚分组，手机号标签“手机号码”，姓名“收货人”；保存后重读服务端，删除默认不自动选择。配送结算从本人地址列表选已有/新增，原选择变化使quote失效；本计划仍明确提示配送待开通，不把新地址冒充已满足配送区域/费率，保留下一模块接入所需selectedAddressId/revision状态，不继续提交旧任意address JSON以绕过规则。

- [ ] **4. 定位。** `uni.getLocation({type:'wgs84'})`实际可用才调用；拒绝/失败给可继续文字地址的反馈。结果先变为proposal，明确“使用此配送点”后才记录source DEVICE、整数微度与当前UTC confirmedAt；不要按获取定位直接覆盖原点。取消proposal或旧结果晚到不改当前地址。修改region/detail清原点或要求明确重新确认；只改收货人/手机号保持原点。无地图不画假地图，不猜地区/门牌；地址可point:null保存。位置权限声明和微信manifest按实际API说明，但不能编造AppID或真机验证。

- [ ] **5. GREEN/集成/构建。** 真实useCustomer+uni fixture及实际SFC交互验证列表/表单/确认删除、两种pending恢复入口、身份过期/迟到、定位拒绝/提议/明确采用/取消/迟到、409/损坏/输入保留与390px布局；新组件≥14px/reduced-motion。相关共享与顾客旧购物车/预约/订单恢复回归一次，顾客H5/mp-weixin双构建，Web/商户仅当共享导出影响实质运行时按范围验证。报告如实区分fixture/构建与root真实UI；独立审查后root再操作源地址簿。

## Root真实验收与状态门槛

- [ ] 新建2个明确本地验收地址（测试手机号不作为真实联系人），新增/编辑/设默认/取消默认/删除默认/刷新，真实UI和源SQL一致；不删除已有个人地址。另一顾客/品牌/员工和容量/并发在隔离HTTP验证，不在源创建假账号或20条垃圾地址。
- [ ] 两顾客H5页面同身份预读版本，第一修改后第二409保留输入，显式重读才能新确认；一次真实POST提交后丢回执，记录唯一ID，刷新/离线/真实logout撤销后401/同身份重登恢复原key/body，原operation与当前事实核对。不要因工具超时重发新key。
- [ ] 浏览器真实定位拒绝流程；隔离浏览器测试经纬度注入明确标“模拟坐标”，不冒充设备真实地理位置；只验证提议/确认/保存/重读及整数一致。
- [ ] fresh源只读快照逐行保护旧21订单及金融/库存/班次/历史address不变，只允许地址/簿/操作日志与实际登录会话变化；本轮地址操作无金融写。截图实际查看、390px/min14/可达/动效；整理README/config/acceptance/requirements/ledger。
- [ ] REQ006只有地址依赖，仍in_progress；配送报价与履约独立计划继续，全90项goal active。当前未验证配送、微信定位真机/支付/生产，不能宣称全部完成。
