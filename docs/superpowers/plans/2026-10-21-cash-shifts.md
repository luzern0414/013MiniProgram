# 现金班次与交班实施计划

> REQUIRED SUB-SKILL: subagent-driven-development。挂取单Task3及root跨端验收收尾后才派发，同时一个实现者；每任务提交后独立审查。本计划三任务及root本地验收已完成，具体证据见docs/acceptance/2026-10-21-cash-shifts.md；其他渠道和应收仍另行实施。

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

## Task 1: API、班次归属及增量迁移

**Files:** 新建apps/api/src/modules/finance/cash-shifts.service.ts、cash-shifts.controller.ts、cash-shifts.validation.ts、cash-shift-ledger.ts（事务级锁/归属/汇总），修改prisma/schema.prisma、下一序号增量迁移、app.module.ts、orders/orders.service.ts、finance/cash-refunds.service.ts；HTTP/迁移/并发专项夹具及原受影响fixtures。报告docs/tasks/cash-shifts-api-report.md。不将整套交班塞OrdersService。

- [x] **1. RED和夹具。** 独立随机数据库/受限schema，创建真实brand/store/owner/clerk/customer及另一店权限夹具。源库拒绝门禁贯穿所有子进程，CREATE碰撞不能DROP非自有库。先写HTTP断言：无班新收款/退款409且财务/库存不变；店主0期开班；店员读可、开关禁；同店两开只一成功；同key同载荷1班1审计，异载荷409；跨店/顾客/撤权重放拒绝。记录真实RED命令/输出。
- [x] **2. 模型和迁移。** 新CashShift及关系/检查/索引；OPEN条件唯一约束，state/关班字段一致、期初实点范围、revision非负。CashPayment/Refund各添nullable shiftId及RESTRICT，不能回填旧凭证。时间采用项目UTC显式默认。fixture保留迁移前全部旧列原始timestamp文本，对照默认null、FK删除限制、部分唯一、错误状态拒绝；前后旧原列含时间完全相同。generate先请求root精确停自有API，不擅自停服务或源迁移。
- [x] **3. 幂等/读/开关。** 写前校验严格白名单，事务内授权、规范化摘要；同key检查在副作用之前。列表数据库过滤排序分页并返回total，详情OPEN一致聚合/CLOSED固定快照。close锁指定班次后核对原key，再expectedRevision及OPEN，重算真实金额，写快照/状态/revision/审计原子完成。差额非0须原因，不生成金额调整。大汇总/版本溢出明确拒绝并回滚。
- [x] **4. 集成原金融事务。** 原现金重放在授权后沿原单返回；新现金必须锁活动班次后才结算库存、写带shiftId的CashPayment、递增revision。退款按本次活动班次挂CashRefund，与payment.refundedFen/事件/审计同事务，不改原收款shiftId。两处锁顺序一致；重放不要求当前OPEN，不附加审计。raw锁只将P2010/meta40001或40P01转成现有有界事务重试，覆盖实际可复现SQLSTATE，未强制触发的不得声称通过。
- [x] **5. GREEN与交付。** 实际HTTP专项源码/编译两种执行：收6160/交7000/找840，应有只加6160；同班退款减少一次；关闭后原付款重放不重归，新退款归第二班；历史null凭证退款归新班；两设备不同closekey只一次关班，旧版本409保留事实；关闭和收款/退款竞争只能合法序列且闭班无迟到流水。日统计按发生日与班次快照各自正确。用真实日期边界隔离夹具，不改源浏览器时钟。原domain、cash/refund/pickup/options/drafts相关HTTP和tsc，更新受影响fixture显式开班且不削弱旧断言。追加HTTP/原列保留/约束/审计/限制报告，自审显式提交。

**Root gate:** 独立Approved后，运行fresh原列基线/新备份/实际新库恢复/原列含时间对照；只部署下一迁移，重读旧金融null归属及原业务全保留，恢复API健康。未通过不得开始源金融写入。源码夹具不代替源迁移或真实UI。

## Task 2: shared恢复及Web交班

**Files:** packages/mini-core/src/cash-shifts.mjs、index导出、tests/cash-shifts.test.mjs；apps/merchant-web/src/CashShifts.vue及小型适配/行为测试，App导航/会话锁、金融错误文案最小改动。报告docs/tasks/cash-shifts-web-report.md。

- [x] **1. RED。** 真控制器可控制Promise/存储夹具：不存在/空串/null/损坏，set或readback失败不发写，remove回读失败继续锁；同身份跨店唯一pending，refresh可发现；身份/门店/dispose拒迟到；create/close原key原body显式恢复；401/403/GET离线保留锁；close409不自动用新revision重关、实点原因保留；多金融锁OR。
- [x] **2. 页面。** 可发现交班导航，活动班及历史分页；店主开班表单、实点/差额预览和明确关闭；店员只读，禁止仿造权限。金额用真实summary；CLOSED固定快照/历史null标记清楚。未知时有恢复入口；跨店/导航/退出/beforeunload与现有订单/退款/草稿锁OR合并。不要以切换交班绕过未知现金。无活动班新收款/退款显示先开班，保留原单/金额，不自动收或退。

  新收款/退款界面先读取活动班次，可明确提示店主开班再返回原订单。若首次新请求确定返回SHIFT_REQUIRED且服务端事务未提交，不得遗留无法导航开班的假unknown锁；清除本次未发送成功的attempt时仍保留订单与实收/退款输入。原本已经unknown的请求后来返回SHIFT_REQUIRED则不能推断第一次未入账，须GET核对原凭证再决定，保留原key/载荷；禁止不区分首次和恢复而一律解锁。添加两种实际controller/useMerchant行为回归。
- [x] **3. GREEN。** shared/Web行为及类型/构建一次最终验证，测聚合/差额/非零原因/权限、焦点与恢复行为。独立审查后root真实Web开班→新现金→预览→关班；原记录不改。真实一笔slow/lost-receipt、离线GET和刷新发现、旧revision409，再只读SQL核对。截图实际查看，窄屏/14px/reduced-motion及键盘。

## Task 3: 商户小程序交班与跨端闭环

**Files:** merchant-mini/components/CashShifts.vue、cash-shifts.js适配、merchant.js及index最小入口/OR锁、相应行为测试；必要共享兼容。报告docs/tasks/cash-shifts-mini-report.md。

- [x] **1. RED。** uni storage keys区分不存在与损坏，onBackPress/H5 beforeunload/导航切店退出锁OR；不同账号/门店与dispose；samekey恢复和close409保留输入；零差额/负应有/有差异必填；已有未知现金不能被班次恢复解锁。
- [x] **2. 页面与适配。** 工作台可发现交班；店主开关、本店店员读；共享控制器，14px及reduced-motion，实际读取活动/历史/快照；待核对恢复跨reload和重登可发现，不能把GET失败当作关闭失败。index仅接入口，不堆状态机。顾客无班次入口。
- [x] **3. GREEN。** 相关merchant/shared测试、Web及双mini H5/mp-weixin五构建/diff检查，报告与独立review。root实测Web开A班→mini现金→Web刷新应有→Web关闭→mini读取关闭原快照→mini开B班→真实退A班独立验收订单部分款，B只记退款、A快照不变。明确新订单来源和金额，不能为测试退任意旧单。并测跨设备close冲突、请求丢回执原key恢复、顾客/跨店403、旧金融重放不重归，SQL校验所有旧业务及新增账本。

## root最终门槛

汇总每轮独立审查、fresh源只读SQL、真实请求/响应/ID/版本/审计、截图及刷新/重登证据至docs/acceptance/2026-10-21-cash-shifts.md，更新README/config/requirements/progress。REQ-087是否完整verified_local按班次与旧收款证据复核；REQ-090仍需其余渠道/应收，准确标现金子集进度。接着推进90项中其余本地模块，不将本计划完成当全goal完成。
