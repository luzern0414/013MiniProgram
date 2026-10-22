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

## Task 2: 电脑收银挂单/取单与恢复

**Files:** 新建apps/merchant-web/src/CashierDrafts.vue、packages/mini-core/src/cashier-drafts.mjs及tests/cashier-drafts.test.mjs；修改apps/merchant-web/src/Cashier.vue、types.ts、会话/导航锁相关最小入口、packages/mini-core/src/index.mjs；新增apps/merchant-web/src/cashierDrafts.test.mjs；报告docs/tasks/cashier-drafts-web-report.md。

**Interfaces:** 消费Task1合约。共享模块提供draftSelection(cart,context)、hydrateDraft(draft,catalog)、createDraftController({state,request,storage,userId,storeId,onChange})；hydrateDraft保留skuId/数量/全部选项ID，无法解析的行给出issue和原display，不替换或删除。controller实现load/get/create/update/cancel/quote/recover/dispose，具体异步写锁与恢复载荷校验在一个模块内，供下一任务复用。

- [ ] **1. 行为RED。** 原选择恢复、不静默替换必选项、创建失回执同key恢复、CAS冲突保留本地输入、未知转换保留原quoteId/orderKey、存储失败不发写、账号/门店隔离和dispose后不回写。包含下列业务断言，使用可控制Promise的真实controller接口测试，不用源码字符串替代。

```js
const original = {skuId:'sku-a',quantity:2,modifierIds:['egg'],attributeOptionIds:['hot']};
const value = hydrateDraft(draftWith(original), catalogWithoutOption('hot'));
assert.deepEqual(value.cart[0].attributeOptionIds, ['hot']);
assert.ok(value.cart[0].issue);
await controller.update();
assert.equal(state.error.code, 'DRAFT_CHANGED');
assert.equal(state.edit.name, '当前未覆盖草稿名');
assert.equal(state.remote.revision, 2);
```

- [ ] **2. 挂单入口。** 当前未形成订单的购物袋支持输入挂单名并保存；成功后显示真实版本与时间，用户可开始下一单。草稿列表按授权店真实分页，展示模式/行数/更新时间/状态；不将估价当已付。已有正式订单/未知收款/未知退款锁时不能把其另存草稿或用挂单绕过锁。
- [ ] **3. 取单编辑。** 点击取单前，非空本地购物袋须明确“取消”或“替换当前购物袋”，用户可先保存当前袋，不能静默丢弃。显示已取草稿及revision，保留SKU/规格/口味/加料/数量/堂食桌码或预约选择/备注。按当前菜单标明失效行，不能自动改成即时自取。已选草稿有本地改动时，“保存并核价”先CAS保存，再调用草稿quote端点；不得用旧服务端草稿报价掩盖本地未保存选择。
- [ ] **4. 转单/异常。** 使用同一/orders及原orderKey，正式订单与草稿绑定是唯一事实；已转换从真实orderId进入授权订单，不能再转换或覆盖。未知写入保留原请求；创建显式同key重放，更新GET显示远端事实供用户明确核对/重新载入或保留输入后新版本保存，不能自动覆盖。转换未知时保留原quoteId/key，通过真实草稿和订单读取核对；不自动确认收款。GET失败继续保留，401/403不能作为之前写未发生的证明。pending入口可发现，存储损坏fail closed。保存慢/未知锁导航、切店、退出、beforeunload；与原收款/退款/预约锁合并。
- [ ] **5. GREEN/交付。** 执行mini-core/Web相关suite、Web类型检查与构建，保留已有收款、退款、预约、规格流程；独立审查。root真实Web挂单/刷新/恢复/409/慢写/离线，以及只读SQL证明保存前后零库存/容量/序号/现金变化；暂不把REQ-079/080标全部已验证，待商户端跨设备闭环。


## 派发和集成边界

这是准备好的Task2单任务brief，root明确派发且Task1独立审查/源库迁移成功后才开始。不要实施Task3商户mini收银，Task3会复用本任务共享controller。实现前阅读D:/Codes/开发规范.txt、TDD、verification-before-completion；发现问题用systematic-debugging，不再派子代理。

Task1实际合约以独立审查后的docs/tasks/cashier-drafts-api-report.md和docs/architecture/api-contract.md为准，若与本计划冲突先报告root，不能伪造服务端字段。Cashier.vue已有实际现金恢复、规格/属性、预约和现金退款凭证，保留这些行为；跨上下文和旧恢复格式必须兼容。

- 仅未形成正式订单的可编辑购物袋能保存草稿。草稿不可成为未知订单/现金/退款的解锁路径；生成正式订单后的草稿绑定不可清空后重转。现有正常用户明确点击的“下单并确认现金收款”可沿原流程，但未知转换后的恢复只读取/核对原订单，不因GET或原创建重放成功自动调用现金收款；先显示真实待付款事实，再由用户明确确认收现金。
- draftSelection保留skuId/quantity/modifierIds/attributeOptionIds及mode/tableCode/pickupSlotId/note；hydrateDraft优先消费现有selectionLine/cartSelectionIssue等。选项不存在时保留原ID/display和issue，不能用initialSelection默认值替代；服务方式、桌台和预约失效同样保留待处理选择。
- 新建独立CashierDrafts.vue承担草稿列表/详情/替换确认/版本冲突和恢复提示。Cashier.vue仅负责购物袋及收银联动；共享controller是create/update/cancel/quote/recover/dispose和载荷恢复的唯一来源，供下一任务复用，避免两端各一套状态机。
- 每项写入首次发送前可靠保存原方法、载荷、用户/店/草稿/expectedRevision及必要key；回读校验失败不发。原创建请求unknown时只显式同key同载荷重放；修改/取消unknown不能自动再发CAS，GET读远端事实供用户选择核对/重新载入或保留本地输入后保存新版本。GET失败不解锁；401/403不能证明此前写未成功。冲突保留本地输入与服务端当前版本。
- 恢复记录按身份隔离，启动时能发现原店待核对入口。未知不可提供“丢弃并新建”；损坏/空值/unsupported版本fail closed。与原收款/退款/核销锁采用OR合并，任一false不得解另一锁；dispose/身份/门店/草稿切换后的迟到响应不覆盖新上下文。真实成功后清旧错误，不能重复上次NETWORK残留问题。
- 挂单成功需真实GET和版本/时间后可开始下一单。当前购物袋非空取单必须显式取消或替换，不能丢未保存输入；取单后有本地变更，保存并核价先CAS保存再草稿quote。已转换只读订单链接只用真实orderId。
- 页面沿现有暖白/深绿/橙风格，细微展开/保存/冲突反馈动效，尊重reduced-motion；计算字号至少14px，原生输入标签、错误和键盘操作完整。普通用户不应看到expectedRevision/quoteId/key/hash等开发词；真实order编号和requestId排查编号可显示。

实施者不得源库业务写/造单/退款、停服务、generate或迁移。root负责实际页面与SQL，不要把内存测试/构建等同验收。只显式暂存本人前端/shared/types/tests及docs/tasks/cashier-drafts-web-report.md；保留root的README/config/台账/验收及两个旧catalog reviewdiff。报告准确RED/GREEN、命令原输出、存储/恢复/锁/兼容/限制和commits；返回DONE+commits+一行验证或明确concerns。实现过程中有具体歧义先报告root，不通过放松约束绕过。
