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

## Task 3: 商户小程序交班与跨端闭环

**Files:** merchant-mini/components/CashShifts.vue、cash-shifts.js适配、merchant.js及index最小入口/OR锁、相应行为测试；必要共享兼容。报告docs/tasks/cash-shifts-mini-report.md。

- [ ] **1. RED。** uni storage keys区分不存在与损坏，onBackPress/H5 beforeunload/导航切店退出锁OR；不同账号/门店与dispose；samekey恢复和close409保留输入；零差额/负应有/有差异必填；已有未知现金不能被班次恢复解锁。
- [ ] **2. 页面与适配。** 工作台可发现交班；店主开关、本店店员读；共享控制器，14px及reduced-motion，实际读取活动/历史/快照；待核对恢复跨reload和重登可发现，不能把GET失败当作关闭失败。index仅接入口，不堆状态机。顾客无班次入口。
- [ ] **3. GREEN。** 相关merchant/shared测试、Web及双mini H5/mp-weixin五构建/diff检查，报告与独立review。root实测Web开A班→mini现金→Web刷新应有→Web关闭→mini读取关闭原快照→mini开B班→真实退A班独立验收订单部分款，B只记退款、A快照不变。明确新订单来源和金额，不能为测试退任意旧单。并测跨设备close冲突、请求丢回执原key恢复、顾客/跨店403、旧金融重放不重归，SQL校验所有旧业务及新增账本。


## 派发和报告边界

Task1 API及012源迁移已完成，Task2 f4bbb69/c5e0108独立复审Spec compliant / Approved，root Web真实验收已完成，详见docs/acceptance/2026-10-21-cash-shifts.md。使用Task2的真实shared控制器，不复制另一套开关班状态机。当前无活动班，源20订单/13现金34926分/4退款5383分，旧凭证保留null；本轮W单已COMPLETED/PAID，班次已关闭，不得重写或退款。

共享导出packages/mini-core/src/cash-shifts.mjs：shiftStorageKey(userId)、shiftLocked(...locks)、shiftAmount(text)、validShift(view,storeId,shiftId?)、readShiftAttempt(storage,userId)、createCashShiftController({state,storage,request,context,onChange?,key?})。storage get缺失必须undefined；request(path,{method,headers,data})返回真实envelope.data，错误保留code/status/requestId。controller方法current/load/get/open/close(true)/recover('read'|'replay')/dispose；context返回userId/storeId/owner。退款shared支持beforeNew和checkNew，仅新操作先读活动班，原unknown沿原恢复。报告docs/tasks/cash-shifts-web-report.md记录最终89项受影响行为与实际SFC组合恢复。

必须吸取Web复审边界：锁发现不能只靠交班组件挂载时发busy。useMerchant初始化/refresh/relogin应独立读持久shift pending或损坏，与原cash/refund/draft unknown按OR组合；不能把shift路由强行提到原现金恢复前，也不能让清一个pending清另一个锁。保留原操作恢复路径，并在原操作核对后提供明确转交班入口；无导航hint、跨店也要可达。原下单unknown恢复出订单后不得顺势发新现金。用真实useMerchant/适配/SFC行为验证，避免只手动设busy或源码正则。

只改商户小程序组件、适配、merchant.js和入口以及受影响测试；API/数据库/Web/顾客不在范围。必要shared兼容最小改动须明确说明；不升级依赖，不派子代理。遵循D:/Codes/开发规范.txt、TDD和verification-before-completion；root独占源浏览器/SQL/业务写及服务，不得reset/seed/generate/源迁移或自行停服务。

uni存储必须区分不存在与空串/null/损坏，沿已有uniDraftStorage模式enumerate keys；set和remove均readback，存储失败不能发写或伪装解锁。班次busy/blocked与现有现金、退款、草稿、预约及auxiliary锁按OR组合，不能因某个控制器恢复成功而清掉其他未知交易。身份/门店/dispose拒绝迟到响应。

无活动班时先读取并提示店主开班，保留原订单/实收/退款输入。首次新请求确定返回SHIFT_REQUIRED与此前unknown恢复时收到SHIFT_REQUIRED必须分开处理；后者不能推断第一次未入账，要核对原凭证并保持原key/载荷，不得一律清锁。行为回归用真实useMerchant/适配及SFC组合，不以源码正则替代交互。

历史凭证用cashReceipt.shiftId及cashRefunds[].shiftId真实nullable关系，不能按日期推断；界面说明历史未归班。金额用服务端summary，实点差额预览不是关班完成。新款找零只计一次，跨班退款只归本次班，CLOSED展示固定快照。字号至少14px，窄屏操作可达、动效尊重reduced-motion。

报告docs/tasks/cash-shifts-mini-report.md，含真实RED/GREEN命令及输出、相关测试/五构建、自查、兼容及限制；不要将构建说成微信真机或完整真实UI验收。显式提交本人文件及报告，身份Codex/codex@local.invalid，不暂存两份旧catalog-api diff或root文档。返回状态、SHA、一行验证及报告路径。
