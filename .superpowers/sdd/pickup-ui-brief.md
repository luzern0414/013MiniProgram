# 预约自提容量与取餐号实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development task-by-task。商品规格Task3及完整页面/SQL验收通过后才执行；同一时间只派发一个实现者。

**Goal:** 补齐REQ-007的预约时段容量与凭证，并完善REQ-008即时自取的可读取餐号、叫号与核销；旧订单保持原有履约能力。

**Architecture:** 在独立pickup模块管理门店预约政策、明确日期时段、容量承诺和日取餐号。报价不预占容量；订单创建、库存预占、时段预占、凭证分配同事务。沿用现金收款及订单事件，不引入模拟付款或微信通知成功。

**Tech Stack:** NestJS11、Prisma6.19、PostgreSQL16、Vue3、uni-app与mini-core。

## Global Constraints

- 保留development/public全部已有商品、订单、库存和会话，不删库重置；迁移必须可作用于现存数据。
- 正式业务数据全部通过后端读写数据库；不得伪造成功，不得改变历史订单快照。
- 所有界面文字原则上不得小于14px，提交禁重，失败提示清晰，保留requestId。
- 商户门店经营配置仅允许当前有效OWNER且有本店授权；事务内重新核对身份及授权。取餐履约允许本店有效OWNER/CLERK。
- 不重建已有SKU/Modifier，不清零其预占；已有订单支付、履约、取消和超时释放保持可用。
- 当前没有AppID/支付/域名/服务器资源，继续本地验收，不声称微信真机或生产已验证。

## 范围与设计决策

本计划实现明确日期的预约时段及批量生成预览，不把重复周模板、节假日营业配置、堂食桌台预约或自配送一起混入。每个时段是可追踪经营记录，关闭后可恢复，已承诺的时间不随编辑漂移。可用日期及容量是数据库真值；商户可为未来日期继续新增时段，不要求先配置周期模板。

首版门店时区固定Asia/Shanghai，服务端接收带时区的ISO时间并保存UTC；无时区字符串、非法日期和客户端自行计算的余量拒绝。政策默认预约关闭、提前15分钟、最远14天；OWNER可设置提前0至1440分钟、预约1至90天。即时自取仍可用，已有`pickupMinutes`继续表示备餐估时，不混成另一份预约提前量。

每个时段长度5至240分钟，起止严格递增，不能跨本地日期；跨午夜经营拆成两个明确日期记录。容量1至1000笔订单，不按商品份数。单次批量创建最多96个时段，采用起点含、终点不含的区间，相邻不算重叠；不能相互重叠或与本店既有时段重叠；已有时段通过原ID调整或恢复。读取日期范围最多31天、按开始时间排序，不一次返回无限历史。

### 数据关系

```text
PickupPolicy {storeId PK,enabled=false,revision=0,timezone='Asia/Shanghai',
              leadMinutes=15,maxAdvanceDays=14}
PickupSlot {id,storeId,startsAt,endsAt,capacity,heldCount=0,confirmedCount=0,
            enabled=true,revision=0}
PickupReservation {orderId PK,slotId,state:HELD|CONFIRMED|RELEASED}
PickupSequence {storeId,serviceDate,lastNumber} PK(storeId,serviceDate)
Order.pickupServiceDate String?       # 新取餐号的门店当地日期，老订单null
Order.pickupOrdinal Int?              # @@unique([storeId,pickupServiceDate,pickupOrdinal])
Order.pickupWindow Json?              # 不可变日期/时段/时区快照，老订单null
```

所有新增关联删除策略Restrict；不硬删除有预约的时段或订单关系。数据库约束保持计数非负且heldCount+confirmedCount≤capacity、开始早于结束、正整数容量和版本。旧订单不补造预约记录，旧取餐号保持不变。

报价新增可选`pickupSlotId`，只适用于PICKUP；省略表示即时自取。公开报价/订单包含可读取餐窗口快照。预约报价记录slot/policy版本及时间，创建时复核门店、政策、时段、时间窗口与余量；未知旧报价字段按即时自取兼容，不改旧订单快照。

预约创建时先按现有顺序锁定加料与SKU，再条件更新时段计数并创建HELD记录；事务失败全部回滚。重复幂等请求先返回既有订单，不再次加计数。所有涉及容量和库存的写入保持统一锁顺序；通过同事务计数CAS及Serializable防止最后一个名额超售，正常库存变化不递增经营配置版本。

现金确认把HELD转为CONFIRMED、heldCount减1、confirmedCount加1。未付款取消、拒单或到期仅HELD可转RELEASED并减heldCount；重试不重复释放。已经付款或完成不归还当天已接单产能；已付款拒绝继续走现有真实退款限制，不伪造处理。配置关闭或变更不阻止已成立订单付款、履约或未付款取消；已承诺容量不可调低至计数之下。有预约记录后不允许修改时段起止，可以改容量/启停并留审计。

新PICKUP订单按门店当地履约日期在同事务递增序列：预约单使用时段开始时间的当地日期，即时单使用创建当日。显示`Q0001`、`Q0002`等（至少4位，不截断较大数）；每日从1开始，取消后的号码不回收。同日跨店可同号，查单始终带门店/履约日期上下文；取餐号是叫号标识，不能单凭号码读取其他顾客订单。原10位十六进制取餐号继续显示及履约，不重编号。

商户在READY且已付款的本店订单执行“核销取餐”，输入顾客出示的取餐号确认。复用订单状态转换事务，提交时比对订单当前号码，重复完成返回已完成结果，不增加重复完成事件。此为有权员工的领取确认，不把叫号号码当成秘密密码。通用履约API保持既有授权与兼容性，不因新增界面把旧订单锁死；新核销接口必须真实校验号码及状态。

### API合约

```text
GET /merchant/pickup-policy?storeId=...
PUT /merchant/pickup-policy {storeId,expectedRevision,enabled,leadMinutes,maxAdvanceDays}
GET /merchant/pickup-slots?storeId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
POST /merchant/pickup-slots {storeId,slots:[{startsAt,endsAt,capacity}]}
PATCH /merchant/pickup-slots/:id {storeId,expectedRevision,enabled,capacity}
GET /stores/:storeId/pickup-slots?date=YYYY-MM-DD
POST /merchant/orders/:id/pickup {storeId,pickupNumber}
POST /quotes {原有字段...,pickupSlotId?:string}
```

经营读取允许本店OWNER/CLERK，写政策/时段只允许OWNER；核销允许本店OWNER/CLERK。公开端点先用现有PublicBrand校验门店归属，仅返回可预约时段的id、startsAt、endsAt、timezone、remaining，不泄露订单或客户；过去/关闭/满额不提供可选状态。服务端始终复核，列表余量不是承诺。

迁移为现有门店写入明确关闭的PickupPolicy；显式seed中新建门店同时初始化同样政策。当前没有新增门店API，本任务不额外创建该入口；未来门店创建事务必须初始化政策，不能在GET中偷偷创建数据。若遇缺政策的异常旧门店，经营接口返回可识别的配置缺失错误，由OWNER首次PUT以expectedRevision=0显式初始化，公开列表为空且即时自取不受影响。公开政策是否可预约由列表返回，不凭前端硬编码默认成功。

严格白名单。政策/时段旧版本409 STATE_CONFLICT，时段满额409 PICKUP_SLOT_FULL，旧报价经营版本改变409 PICKUP_RULES_CHANGED，时间不再可预约409 PICKUP_TIME_UNAVAILABLE；用户参数非法400，跨门店403。保留requestId，写入未知结果不自动重发，必须真实重读。批量创建在一个事务中全成或全败，不出现半个时间表。

## Task 2: 三端时段选择、配置和实际核销

**Files:** Web新增`PickupSettings.vue`/时段编辑；merchant-mini独立配置组件/入口；customer-mini预约选择组件/状态；Web收银预约入口；双方商户订单详情/核销表单；mini-core专门预约行为及测试；`docs/tasks/pickup-ui-report.md`。README/config/需求与真实验收记录由协调器维护。

**Interfaces:** 消费Task1实际合约；使用现有会话、storeId、busy/blocked、请求错误与订单幂等恢复，不另建未隔离购物袋或假预约余量。

- [ ] 先写“时段变化清报价、旧预约保留、冲突需重读、未知创建不重发”的共享行为测试并观察RED。新选择按服务端返回时间以门店时区展示，不依赖浏览器默认时区。
- [ ] OWNER设置预约开关/提前量/天数；按日期查看时段，输入起止/间隔/容量生成可核对预览后提交。展示真实已占用/确认/剩余，容量下限和关闭影响明确；CLERK只读。提交期间锁切店/导航/关闭。
- [ ] 顾客及Web收银在PICKUP下选择“尽快取餐”或具体日期/窗口；切时段清旧报价，满额/关闭可重新查询，不偷偷改成即时自取。已成立订单展示原窗口与取餐号。
- [ ] 商户按取餐号筛选本店订单，READY订单核销要求输入顾客号码，成功真实POST后重读；错号/未付款/未出餐有可恢复反馈，连续点击不重复完成。顾客刷新看到同一完成事件。
- [ ] 执行相关行为测试、Web及双mini H5/mp-weixin构建，独立审查。协调器实际Web建时段→H5重读→顾客预约→现金收款→制作/出餐→核销→顾客刷新，SQL确认HELD→CONFIRMED且已完成仍计容量。
- [ ] 协调器实际演练最后一名并发、未付款取消/超时释放、版本冲突/关闭旧报价、跨用户/跨门店、离线与未知结果恢复；重新登录/刷新持久化一致后才更新REQ-007/008的本地验收状态，productionVerified=false。


## 客户端接口与归属补充
先读Task1最终报告 docs/tasks/pickup-api-report.md 与真实API合约，不能猜测字段。Task1尚在实现，本brief此时未派发，根会在独立审查、开发库迁移后补接口差异。
顾客状态 apps/customer-mini/src/customer.js、页面 apps/customer-mini/src/pages/index/index.vue；新时段选择与取餐窗口组件独立。Web Cashier.vue保留现有quote/idempotency/unknown cash恢复；原搭配与预约窗口都要显式校验，切换场景不能把已冻结未知订单当成新交易。Web Orders.vue与merchant-mini订单详情新增核销组件，保持旧10位取餐号兼容。不要在长页面继续堆完整配置逻辑。
使用现有owner/clerk、storeId、busy/blocked、组件卸载scope epoch约定；H5表单label必须唯一聚焦真实input，不将浏览器DOM当作微信业务依赖。先读 docs/tasks/product-options-selection-report.md，shared mini-core有选择、恢复、会话隔离行为测试和统一错误映射。
写入结果未知要保留请求和草稿，不能自动重发新批次；时段创建没有自然键时更不能由客户端猜测成功。真实GET后让用户核对服务端时段表，失败仍保持锁定。批量生成先展示完整日期、起止、容量、总时段数，不跳过预览。
根拥有运行服务、所有真实浏览器/SQL验收与README/config/requirements/acceptance/progress。你只实现三端界面及shared行为和测试/报告；不更改API/schema、跑source seed/reset或造单收款。需要重启某个开发服务器时先提供真实证据与端口，根处理。
报告写 docs/tasks/pickup-ui-report.md，含RED/GREEN、变更、测试命令与输出、五构建结果、自查、限制、提交；返回简短状态。
## Task1实际接口核对（d0d4815，审查中）
经营时段返回完整PickupSlot，包括heldCount/confirmedCount/capacity/revision；公开列表只给remaining及窗口，不含政策对象。GET政策缺失409 PICKUP_CONFIGURATION_MISSING，显式OWNER PUT expectedRevision=0可初始化，不要在读失败时自动写默认。公开列表为空须显示无可预约时段，尽快取餐仍可选，但不得默默把已选预约替换为尽快。
公开GET日期格式YYYY-MM-DD；列表范围from/to均含本地日期，最多31日。ISO写入必须有秒及数值时区或Z，客户端按Asia/Shanghai生成明确+08:00，前端预览不把本机时区假设为门店时区。每slot起止在同一当地日期、5至240分钟；相邻允许，已有停用slot仍阻止重叠。创建全成或全败；PATCH仅容量/启停，不提供更改已建立窗口的入口。
报价和订单pickupWindow={slotId,startsAt,endsAt,timezone:'Asia/Shanghai',serviceDate}或null。新订单还有pickupServiceDate/pickupOrdinal；旧字段null且旧10位号保留，不能由UI按当前日期补造窗口或改号。公开报价会剔除内部pickupBooking，不要从客户端回传内部版本；POST/quotes只传选中的pickupSlotId。
核销POST /merchant/orders/:id/pickup {storeId,pickupNumber}；对照实际合约错误和状态，自然映射PICKUP_SLOT_FULL、PICKUP_RULES_CHANGED、PICKUP_TIME_UNAVAILABLE、PICKUP_CONFIGURATION_MISSING。已有订单因后续配置关闭仍可现金付款、取消或核销，不能因公开列表不含旧slot隐藏已有订单原窗口。
此处只是接口预对齐，根独立审查如有修正会更新后再派发Task2，不将当前版本标记最终已验收。
## 独立审查与运行库迁移已通过
Task1 d0d4815独立pickup_capacity_api_review Spec compliant/Approved，无Critical/Important；仅新文件长行格式与既有Prisma config弃用提示记录Minor待整分支清理。根已读未变PublicBrand/assertStore与main全局Envelope/Errors，解决API边界outside-diff项。第8次增量迁移已仅应用development，根39表339行原列哈希完全一致；API已重启会话50198。Task2可实施，但整REQ007/008尚未验收。源最新真实交易基线8订单/5现金12740、公用4订单；不要重置或seed源库。
