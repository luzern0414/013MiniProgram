# 现金班次与交班实施计划

> REQUIRED SUB-SKILL: subagent-driven-development。挂取单Task3及root跨端验收收尾后才派发，同时一个实现者；每任务提交后独立审查。此文件是准备计划，不表示已实施。

**Goal:** 显式现金班次归属、准确应有/实点/差额、版本化关班和跨端恢复，推进REQ-087/090。其他渠道和应收另行实现，不能把现金子集标完整REQ-090已验。

**Architecture:** 每店一个共享OPEN班次；新现金收退款在原事务中锁班次、归属凭证、递增revision；闭班保存不可变快照。旧凭证保留nullable shiftId且不按时间猜填。独立模块及shared控制器，复用原权限/订单/现金及退款恢复。

**Tech Stack:** 现有NestJS11/Prisma6.19/PostgreSQL16、Vue3、uni-app、mini-core，不升级依赖。细节见[设计](../specs/2026-10-21-cash-shifts-design.md)、[来源与回归依据](../../research/2026-10-20-cashier-drafts-shifts.md)。

## Global Constraints

- 保留development/public全部已有商品、订单、现金、退款、库存、草稿和会话，不删库重置；迁移必须可作用于现存数据，旧金额/时间/操作者/快照不可改写。
- 正式业务数据全部通过后端读写数据库；不得伪造成功，不能用关班差额修改历史订单或生成虚假收退款。
- 所有界面文字原则上不得小于14px，提交禁重，失败提示清晰，保留requestId。
- 店主开班/关班/退款，本店有效OWNER/CLERK可读班次及收款；顾客、跨店、跨品牌、停用或撤权身份拒绝；每个写事务重验权限。
- 每门店最多一个OPEN；新现金收退款须归属活动班次，已关闭不得新增凭证，旧幂等重放不改原班次、不增加revision或审计。
- 当班应有=期初+sum(amountFen收款)-sum(amountFen退款)，不能用tenderedFen或重复扣changeFen；跨班退款归实际退款班次，旧shiftId=null保持。
- 开班/关班未知结果持久保留原key/载荷，GET失败或401/403不能解锁；不得自动开下一班或自动确认现金。
- 当前没有AppID/支付/域名/服务器资源，继续本地验收，不声称真机或生产已验证。

## 固定合约

```text
GET /merchant/cash-shifts?storeId=&state=OPEN|CLOSED|ALL&page=1&pageSize=20
    -> {items:ShiftView[],total,page,pageSize}
GET /merchant/cash-shifts/current?storeId= -> {shift:ShiftView|null}
GET /merchant/cash-shifts/:id?storeId= -> ShiftView
POST /merchant/cash-shifts {storeId,openingFen}, Idempotency-Key -> ShiftView
POST /merchant/cash-shifts/:id/close
    {storeId,expectedRevision,countedFen,reason}, Idempotency-Key -> ShiftView
```

列表query严格白名单，state默认ALL，page正整数、pageSize1..50。标识符非空字符串最多200；幂等key非空最多120；数值不接受字符串或数组。期初/实点0..2000000000整数分；revision0..2000000000，计数/版本溢出须明确失败，不溢出数据库字段；非零差额reason trim后1..500字、零差额可空。所有写未知字段拒绝，包括shiftId/status/操作者/时间及客户端汇总金额。

```ts
type ShiftView = {
 id:string; storeId:string; state:'OPEN'|'CLOSED'; revision:number;
 openingFen:number; openedBy:{id:string;name:string}; openedAt:string;
 closedBy:{id:string;name:string}|null; closedAt:string|null;
 summary:{paymentCount:number;refundCount:number;paidFen:number;refundFen:number;
   netFen:number;expectedFen:number;countedFen:number|null;differenceFen:number|null;reason:string|null};
};
```

不返回幂等key/hash、登录账号或凭据。汇总用安全整数分，金额数据库BIGINT，JS序列化前检查范围；OPEN的counted/difference/reason为null，CLOSED读已存快照。错误代码：SHIFT_REQUIRED（无活动班收退款409）、SHIFT_ALREADY_OPEN409、SHIFT_CHANGED409（状态/版本变化，GET再明确确认）、SHIFT_TOTAL_TOO_LARGE409（汇总超安全整数）、IDEMPOTENCY_CONFLICT409；普通参数400、权限403、未登录401、缺失404继续现有合约。成功幂等重放返回原班次当前事实，接口状态沿Nest原POST201；不可伪称再次开/关。

## Task 2: shared恢复及Web交班

**Files:** packages/mini-core/src/cash-shifts.mjs、index导出、tests/cash-shifts.test.mjs；apps/merchant-web/src/CashShifts.vue及小型适配/行为测试，App导航/会话锁、金融错误文案最小改动。报告docs/tasks/cash-shifts-web-report.md。

- [ ] **1. RED。** 真控制器可控制Promise/存储夹具：不存在/空串/null/损坏，set或readback失败不发写，remove回读失败继续锁；同身份跨店唯一pending，refresh可发现；身份/门店/dispose拒迟到；create/close原key原body显式恢复；401/403/GET离线保留锁；close409不自动用新revision重关、实点原因保留；多金融锁OR。
- [ ] **2. 页面。** 可发现交班导航，活动班及历史分页；店主开班表单、实点/差额预览和明确关闭；店员只读，禁止仿造权限。金额用真实summary；CLOSED固定快照/历史null标记清楚。未知时有恢复入口；跨店/导航/退出/beforeunload与现有订单/退款/草稿锁OR合并。不要以切换交班绕过未知现金。无活动班新收款/退款显示先开班，保留原单/金额，不自动收或退。

  新收款/退款界面先读取活动班次，可明确提示店主开班再返回原订单。若首次新请求确定返回SHIFT_REQUIRED且服务端事务未提交，不得遗留无法导航开班的假unknown锁；清除本次未发送成功的attempt时仍保留订单与实收/退款输入。原本已经unknown的请求后来返回SHIFT_REQUIRED则不能推断第一次未入账，须GET核对原凭证再决定，保留原key/载荷；禁止不区分首次和恢复而一律解锁。添加两种实际controller/useMerchant行为回归。
- [ ] **3. GREEN。** shared/Web行为及类型/构建一次最终验证，测聚合/差额/非零原因/权限、焦点与恢复行为。独立审查后root真实Web开班→新现金→预览→关班；原记录不改。真实一笔slow/lost-receipt、离线GET和刷新发现、旧revision409，再只读SQL核对。截图实际查看，窄屏/14px/reduced-motion及键盘。


## 派发和报告边界

API已提交1d873cf并独立Approved，报告docs/tasks/cash-shifts-api-report.md、最终合同docs/architecture/api-contract.md。兼容追加cashReceipt.shiftId:string|null、cashRefunds[].shiftId:string|null。UI用真实字段标识历史未归班，不能按订单或现金日期猜测归属；旧幂等恢复不能重新归当前班次。root已完成审查后fresh45表500行、全新备份实际恢复43张非Session表485行原列时间核对、仅012迁移及旧列完全保留；API已恢复health connected。真实GET current返回shift:null、历史total0，原12现金34803分/4退款5383分shiftId全部null。尚无班次业务写或UI验收。

这是Task2实施brief，只在root明确派发后执行。固定合约无额外变更，API已部署本地，根代理仍独占源业务验收。用户批准总体方案，先完成本地功能，不添加外部服务或索要微信资源。

遵循D:/Codes/开发规范.txt、TDD、verification-before-completion和implementer contract；不派子代理。报告docs/tasks/cash-shifts-web-report.md，root负责README/config/需求台账/源验收。只改shared/Web及相应测试；API/DB/schema/merchant-mini/顾客不在本任务范围，如现有共享export需要兼容同步须明确说明。

复用现有uni/浏览器storage与staff会话锁模式，不能重写第二套金融恢复状态机；当前草稿和现金/退款已有OR锁，加入班次不得解锁其他unknown。必须复查首次SHIFT_REQUIRED明确拒绝与原unknown恢复的区别，不能让店主因假unknown锁无法导航去开班，也不能因恢复时的SHIFT_REQUIRED清掉此前未知收款。源历史凭证不分配到新班次。

root范围澄清：上文实际controller/useMerchant回归在Task2覆盖真实shared退款控制器和Web Cashier；merchant-mini/useMerchant实际回归保留Task3。现有Web Orders现金动作没有持久pending，可最小接到既有Cashier恢复入口，保留原订单/实收、不自动收款；busy/blocked不能覆盖既有attempt，GET服务端订单为准。用实际SFC行为覆盖此handoff及金额保留，不另建一套Web金融状态机。

根代理独占源浏览器/业务/数据库/服务及迁移。不得reset/seed/generate/源SQL写或停服务，不使用source业务造夹具，不新增依赖。测试transport/storage隔离，真实SFC行为优先，别以CSS源码正则测试替代交互；相关suite及类型/构建一次最终验证，发现新失败再聚焦。报告真实RED/GREEN命令与输出、自查、兼容和限制。显式提交本人范围，标准身份Codex/codex@local.invalid，不暂存两份旧catalog-api untracked diff。完成返回DONE等状态、SHA、一行验证和报告路径；不要把构建当真实页面/微信真机验收。
