# 挂单与取单实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development task-by-task。现金退款UI及真实验收完成后才派发本计划；同时只有一个实现者，每个任务独立审查。此文是后续计划，不表示已实施。

**Goal:** 完成REQ-079/080的服务端持久化挂单、跨设备取单、版本冲突和一次性转正式订单，推进REQ-015收银。

**Architecture:** 草稿与订单分开建模，报价和转单复用现有OrdersService及同一Serializable事务。草稿仅保存选择及用于识别的服务端展示快照，不预占商品、加料、预约，不取Q号，不生成现金或应收。转订单成功后草稿绑定唯一orderId，之后沿现有收款/履约流程。

**Tech Stack:** NestJS11、Prisma6.19、PostgreSQL16、Vue3、uni-app、mini-core。

## Global Constraints

- 保留development/public全部已有商品、订单、库存和会话，不删库重置；迁移必须可作用于现存数据。
- 正式业务数据全部通过后端读写数据库；不得伪造成功，不得改变历史订单快照。
- 所有界面文字原则上不得小于14px，提交禁重，失败提示清晰，保留requestId。
- 当前有效OWNER/CLERK且具有本店授权可以创建、读取和编辑本店草稿；顾客、跨店、跨品牌和已撤权身份拒绝，每个写事务内重验权限。
- 挂单不改变库存、预约HELD、取餐序号、现金和财务统计；取单重新计价，不能悄悄替换失效选项。
- 草稿转正式订单与绑定orderId在同一事务且受唯一性/状态条件保护；重复转单不能重复预占。
- 当前没有AppID/支付/域名/服务器资源，继续本地验收，不声称真机或生产已验证。

依据：已批准总体设计、[细化设计](../specs/2026-10-20-cashier-drafts-detail.md)、[开源业务调研](../../research/2026-10-20-cashier-drafts-shifts.md)。复用流程原则及现有本项目选择/计价/幂等代码，不复制未知许可上游代码。本计划不实现挂账、抹零、会员扣款、交班或设备打印。

## 固定合约

```ts
type DraftSelection = {
  mode: 'PICKUP' | 'DINE_IN';
  tableCode?: string;
  pickupSlotId?: string;
  note: string;
  lines: {
    skuId: string;
    quantity: number;
    modifierIds: string[];
    attributeOptionIds: string[];
  }[];
};
type DraftWrite = {storeId: string; name: string; selection: DraftSelection};
type DraftEdit = DraftWrite & {expectedRevision: number};
type DraftVersion = {storeId: string; expectedRevision: number};
type DraftView = {
  id: string; storeId: string; name: string;
  revision: number; state: 'DRAFT' | 'CONVERTED' | 'CANCELLED';
  selection: DraftSelection;
  display: {lines: {skuId: string; productName: string; skuName: string;
    modifierNames: string[]; attributeNames: string[]}[]};
  orderId: string | null; createdAt: string; updatedAt: string;
};
```

```text
GET  /merchant/cashier-drafts?storeId=&state=DRAFT&page=1&pageSize=20
     -> {items:DraftView[],total,page,pageSize}
GET  /merchant/cashier-drafts/:id?storeId= -> DraftView
POST /merchant/cashier-drafts {storeId,name,selection}
     header Idempotency-Key -> DraftView
PUT  /merchant/cashier-drafts/:id {storeId,name,selection,expectedRevision}
     -> DraftView
POST /merchant/cashier-drafts/:id/cancel {storeId,expectedRevision}
     -> DraftView
POST /merchant/cashier-drafts/:id/quote {storeId,expectedRevision}
     -> 现有报价视图 + cashierDraft:{id,revision}
POST /orders {quoteId}, header Idempotency-Key
     -> 现有订单视图；服务端识别该报价的草稿绑定并同事务转换
```

列表使用当前授权门店及state数据库谓词，再排序updatedAt DESC/id DESC分页；page正整数，pageSize1–50，返回真实total。不得先取整个历史的前2000条再前端筛选。state允许DRAFT/CONVERTED/CANCELLED，默认DRAFT；未知字段、非整数和超范围参数400。

name trim后1–60字符，note最多500字符且可空，1–100行，每行数量1–99；modifierIds最多20项并去重稳定排序；attributeOptionIds最多50项、重复项拒绝并稳定排序；标识符最多200字符且必须为字符串。不接受价格、总价、状态、revision赋值、orderId或display。DINE_IN核对本店tableCode；PICKUP不携带tableCode，DINE_IN不携带pickupSlotId；配送拒绝。保存核对所选SKU、加料、属性及预约对象所属门店/商品，允许仍存在但停用或过期的原选择留在草稿；报价时必须执行当前完整可售/属性/预约规则。当前无法解析的已删除选择不自动丢弃，保留原服务端草稿与本地输入，提示重新核对后再保存。

创建幂等作用域(storeId,createKey)，requestHash覆盖创建者身份及规范化原输入；先事务内重验权限。同key同载荷返回已绑定草稿当前事实，不再新增审计；同key异载荷409 IDEMPOTENCY_CONFLICT。更新/取消/报价只对DRAFT生效并复核expectedRevision；冲突409 DRAFT_CHANGED，原输入保留。重复取消已取消草稿返回现有事实、不加事件；CONVERTED不能编辑或取消，409 DRAFT_ALREADY_CONVERTED，客户端GET获取授权订单链接。已转换草稿不因订单取消、过期或退款自动回到DRAFT。

## Task 1: 持久化草稿与原子转单API

**Files:** 新建apps/api/src/modules/cashier-drafts/cashier-drafts.{controller,service,validation}.ts及draft-conversion.ts；修改apps/api/src/modules/orders/orders.service.ts、apps/api/src/app.module.ts、apps/api/prisma/schema.prisma；新增下一编号迁移；新建apps/api/tests/cashier-drafts.test.ts、cashier-drafts-schema.cjs和run-cashier-drafts.cjs；更新docs/architecture/api-contract.md及docs/tasks/cashier-drafts-api-report.md。

**Interfaces:** 消费AuthService.staff、Db.atomic、现有quote/create/库存/预约逻辑；产出上面的HTTP合约和DraftView。内部报价入口明确为OrdersService.quoteInTransaction(req,body,tx,draftBinding?)，tx是Prisma.TransactionClient，draftBinding为{id:string,revision:number}。公共POST /quotes不接受draftBinding。不能另复制一套计价或在外层事务内开启独立事务制造部分成功。

- [ ] **1. 真实HTTP先RED。** 新安全runner只允许随机test_cashier_drafts_* schema，模块加载即拒绝缺省/development/public/错误DB；复用既有所有权校验方式。CREATE碰撞或失败不清理旧对象，本轮创建成功且OID/owner一致才清理。先在随机schema运行下列实际断言，观察新端点404而不是因导入/配置失败形成RED。

```ts
const before = await inventoryCapacitySequenceCash();
const saved = await req('/merchant/cashier-drafts', owner,
  {storeId, name: '隔离验收挂单', selection}, 'POST', 'draft-create-1');
assert.equal(saved.status, 201);
assert.equal(saved.body.data.state, 'DRAFT');
assert.equal(saved.body.data.revision, 0);
assert.deepEqual(await inventoryCapacitySequenceCash(), before);
```

fixture须提供req(path,token,body?,method?,key?)、owner/另一有效本店staff/customer/其他店身份、合法selection及inventoryCapacitySequenceCash()；该快照实际读取全部SKU/加料stock/reserved、预约计数、日序号、订单/现金数量和金额，不用mock替代数据库。

- [ ] **2. 增量模型。** CashierDraft含id/storeId/name/selection/display/state/revision/createdById/updatedById/createKey/createHash/orderId/createdAt/updatedAt。store、创建/编辑员工关联RESTRICT；orderId唯一且FK Order RESTRICT。CHECK限制revision非负、state三值、CONVERTED才且必须有orderId。默认DRAFT/revision0；新建时间默认明确UTC，updatedAt由服务端写入UTC。增量只建新表/索引/关系，不改旧现金、订单快照或历史日期。generate前报告root精确停自有API，独立审查前不得源库迁移。

- [ ] **3. CRUD与授权。** 实现合约、规范化/hash、白名单和门店关系验证，display只从当前服务端数据产生。写事务重验身份/启用/品牌/门店权限。更新CAS revision+1，保存/取消审计同事务；创建幂等返回前也重验权限，不暴露createKey/hash/员工账号。失败保存不把原输入或原草稿删掉。

- [ ] **4. 复用报价和订单事务。** 提取现有quote事务体到quoteInTransaction，不改变普通顾客/收银报价语义。草稿quote在同一tx检查revision/state后调用该入口，snapshot保存服务端cashierDraft绑定。OrdersService.create识别绑定，在同一个既有Serializable事务内重验staff/门店、草稿DRAFT与revision、报价归属/有效性和当前商品/预约，再预占、创建订单、CAS绑定orderId并置CONVERTED、revision+1、审计；任一步失败全部回滚。公共下单不能绕过绑定；原key已成功返回前仍重验当前staff/门店权限。不同key/不同报价第二次转换409，GET草稿返回已建立orderId。相同原key恢复不新建订单或重复预占。

```ts
const quotes = await Promise.all([quoteDraft(owner, draft), quoteDraft(otherStaff, draft)]);
const race = await Promise.all([
  createOrder(owner, quotes[0].id, 'draft-convert-a'),
  createOrder(otherStaff, quotes[1].id, 'draft-convert-b'),
]);
assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
const actual = await getDraft(owner, draft.id);
assert.equal(actual.state, 'CONVERTED');
assert.ok(actual.orderId);
assert.equal(await createdOrderCountForDraft(draft.id), 1);
assert.deepEqual(await inventoryCapacitySequenceDelta(), expectedOneOrderDelta);
```

- [ ] **5. GREEN及兼容。** run-cashier-drafts.cjs执行源码与编译HTTP专项，覆盖跨设备读取、同key/异载荷、失权幂等、并发CAS、旧草稿报价后修改409、两员工不同报价转单竞争、普通POST /orders同样受草稿绑定、原key丢回执重放、取消幂等、已转订单后来取消不复活、停用/改价/库存/属性/预约失效保留选择、未授权列表及跨店/跨品牌/顾客拒绝。迁移夹具含全部旧列原始时间保留和CREATE碰撞守卫。运行原domain/现金退款/预约/规格相关覆盖及tsc，不重复无关suite；报告RED/GREEN命令/输出/审计/约束/限制后显式提交。

**Root gate:** 独立审查Approved后新原列基线（保留timestamp原文本）、新备份及恢复验证、仅下一增量迁移、全部旧列比对，再恢复本地API。Task2不得假定未实施的额外API。


## 派发及报告约束

本brief为后续单任务实施需求。只有root明确派发时才开始；现金退款UI真实验收未结束前不得自行启动。源码/测试/合约由实现者负责，README/config/requirements/源库真实操作由root负责。首读D:/Codes/开发规范.txt、test-driven-development、systematic-debugging（发现问题时）、verification-before-completion；不再派子代理。

不得向development/public业务写、造单、seed、reset、迁移；本任务新增专项及迁移夹具仅在受本轮CREATE成功/OID/owner保护的随机test_cashier_drafts_*schema。必要既有现金/预约/规格回归继续使用各自原有受保护runner及原随机前缀test_cash_refunds_*/test_pickup_*/test_product_options_*，不得为统一名字放宽旧guard。Prisma generate前报告root，root精确验证并停止自有API、确认端口释放后才授权；不要自行停止服务或扩大停止范围。源迁移须独立审查Approved后由root新备份/原列原时间基线/迁移/对照再启动。

只显式暂存本人API/schema/迁移/测试/合约和docs/tasks/cashier-drafts-api-report.md，不碰root文档及两份旧catalog reviewdiff。Git身份Codex/codex@local.invalid。报告包括RED/GREEN命令原输出、合约、事务与锁顺序、身份/幂等顺序、兼容/时间保留、隔离清理、测试/构建、自查、限制及提交；返回DONE+commits+一行验证或明确concerns。
