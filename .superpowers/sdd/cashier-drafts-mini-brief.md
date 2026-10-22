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

## Task 3: 商户小程序跨设备取单和收银

**Files:** 新建apps/merchant-mini/src/components/CashierPanel.vue、CashierDrafts.vue、CashierSelection.vue；必要时将面板状态拆apps/merchant-mini/src/cashier.js；修改pages/index/index.vue、merchant.js中的入口及锁、共享controller适配与行为测试；报告docs/tasks/cashier-drafts-mini-report.md。不要将完整购物袋/金融状态机塞进index.vue。

**Interfaces:** 复用Task2共享草稿controller与Task1 API、mini-core现有商品selectionLine/cartSelectionIssue/selectionKey、预约选择及现金恢复。商户移动端当前只对已有订单收现金；本任务补独立选菜购物袋及DINE_IN/PICKUP核价、转单，不能用假下单按钮代替。顾客小程序无员工草稿入口。

- [ ] **1. RED。** 真正测试共享controller的uni storage适配与账号/门店切换；跨设备取单保留全部选项、手机改草稿后Web旧revision409；转换丢回执同quote/key核对且不会再次建单；保存/取单/转换期间与原退款/取餐/收款busy合并。覆盖1份/99份、库存不足、无可用必选项、堂食桌码及预约失效。
- [ ] **2. 移动收银。** 在商户端新增可发现“收银”入口，授权店主/店员可使用；独立选菜组件复用当前SKU/属性/加料选择规则，显示真实菜单和待核价金额。购物袋可挂单、取单、编辑、取消草稿、保存并核价及转正式订单。原有订单现金确认入口负责实际入账，遵守实收/找零与未知写恢复，未付订单不能显示已收款。CONVERTED草稿进入真实订单，不重建。
- [ ] **3. 双端异常一致。** 原选项失效显示原因与可编辑输入，保留服务器草稿；冲突不自动覆盖；非空袋替换确认。onBackPress、切店、切页、退出与所有现有写锁合并，存储失败先阻止发送，reload有待核对入口；dispose后响应不能污染新用户/门店。文案/金额/日期与Web一致，14px及reduced-motion。
- [ ] **4. GREEN与实际验收。** 共享及商户行为suite，Web、双mini H5/mp-weixin五构建和diff检查；独立审查后root真实Web保存→商户H5取单编辑→Web旧版本冲突/重读→H5或Web转换/收现金→顾客不可访问员工草稿。核对源库草稿状态、唯一订单、库存/容量/序号只变一次，刷新/重新登录保持。追加超额库存、失效报价、丢回执、跨店/顾客/撤权与转换竞争（真实两个员工或明确标隔离夹具）证据。


## 派发和集成边界

这是准备好的 Task3 单任务 brief，只有 root 在 Task2 独立审查及 Web 实际验收后明确派发才开始。Task1/2 的实际接口以 docs/architecture/api-contract.md、docs/tasks/cashier-drafts-api-report.md、docs/tasks/cashier-drafts-web-report.md 为准；先阅读 D:/Codes/开发规范.txt、TDD 与 verification-before-completion，异常用 systematic-debugging，不再派子代理。

- 复用 Task2 的 packages/mini-core/src/cashier-drafts.mjs，共享恢复协议和存储载荷。不要新增第二套挂单状态机。若共享接口无法满足移动端要求，报告 root 并以最小兼容扩展解决，保留 Web 调用。
- uni storage 适配先用实际键集合判断存在性；不存在返回 undefined，已存在空字符串或 null 属损坏。不能直接把 getStorageSync 的空值当无记录，读写及清除回读失败均继续锁定；键遵守共享控制器的按身份跨店唯一待核对格式。
- 承接 Task2 复审后的异步取单提交门：慢取单期间取消不仅不能替换购物袋，也不能让迟到响应改当前 remote/edit/quote/order。若选择在读取时禁止取消，弹窗关闭与返回必须一致锁定。恢复其他员工转出的真实订单必须按实际金额重新明确确认实收；不得沿用无关旧报价/旧冻结实收，也不得解除已有未知现金收款的原金额和原key保护。
- 移动收银面板应拆选菜、草稿列表和业务适配，index.vue 仅接入口及导航写锁，禁止把完整金融状态机再堆进该文件。沿现有视觉体系，全部计算字号至少14px，展开/保存反馈动效尊重 reduced-motion。
- 原商品 SKU/属性/加料、DINE_IN 桌码、PICKUP 预约与 note 完整保留；已停用/失效/缺失的原选择保留 ID 和可核对展示，明确标记问题，不默认换即时自取或默认规格。顾客端不出现员工挂单入口。
- 转正式订单后只显示服务端真实 orderId，并由原现金入口明确收款；转换回执未知时读取草稿和订单及原 quoteId/orderKey 恢复，只核对建单结果，不能自动收现金。已有订单/未知现金/退款/核销不能被挂单解锁。
- 创建/更新/取消/转换的未知结果均须有持久可发现入口、可靠写前存储及回读校验，401/403/GET失败不能证明原请求没发生；不提供丢弃未知结果后新建的绕过路径。恢复按身份和门店隔离，旧响应与 dispose 不污染新上下文。GET成功清旧错误但不提前清未知锁。
- 非空购物袋取单必须明确确认替换或取消；CAS冲突保留用户输入与远端版本，不自动覆盖。保存并核价对有本地变更的草稿先 CAS 更新再草稿 quote。
- 共享草稿 busy 与原收款/退款/取餐/其他写锁用 OR 合并，任一 false 不能解另一锁。慢写与未知期间锁切店/切页/返回/退出，onBackPress 与 reload 恢复入口均遵守同一事实。

实施者不得直接源库业务写、造单、退款、停服务、generate、迁移或改依赖版本；真实跨设备 UI 和只读 SQL 由 root 完成。只显式暂存本人 merchant-mini/shared 必要兼容改动、对应行为测试和 docs/tasks/cashier-drafts-mini-report.md；不要暂存 root README/config/需求台账/验收，也不要碰两个旧 catalog review diff。报告准确 RED/GREEN 命令和输出、存储/兼容/恢复/锁/构建/限制及提交；返回 DONE+commits+一行验证或具体 concerns。任务后独立审查，不能把构建当作真机或业务验收。
