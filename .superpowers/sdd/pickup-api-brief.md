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

## Task 1: 容量、序列、订单联动及真实数据库测试

**Files:** 下一编号Prisma迁移/schema、显式seed门店初始化；新增`apps/api/src/modules/pickup/pickup.{controller,service,validation}.ts`及`pickup-capacity.ts`；orders创建/现金/取消/到期/拒单/视图；app.module；`apps/api/tests/pickup-capacity.test.ts`、安全隔离runner；API合约、`docs/tasks/pickup-api-report.md`。

**Interfaces:** 产出上列端点及订单窗口字段；保留旧PICKUP和DINE_IN报价，继续拒绝未配置DELIVERY。具体序列/容量辅助方法集中在pickup模块，orders不复制三套计数逻辑。

- [ ] 先建立随机`test_pickup_*`隔离schema的真实HTTP测试，GET政策应200而当前404形成RED。模块加载时先拒绝development/public及缺省schema；清理需本轮创建成功且OID/owner一致，实际碰撞sentinel保留。
- [ ] 增量模型/迁移保留旧SKU/订单/会话/现金/旧取餐号，新增字段默认null。Prisma生成前协调器停止自有API；未审查前不迁移开发库。
- [ ] 实现独立日期/时区、区间重叠、数量、容量、政策及完整白名单校验；并发批量创建相同或重叠时段只有一方可成功，不能靠前端预检。
- [ ] Serializable事务核对实时角色/本店授权；经营配置有版本与审计。计数CAS、预约状态转换、序列分配与订单/库存交易同事务，不让失败订单留下占用。
- [ ] 用真实HTTP和SQL至少覆盖以下断言，并验证取消/超时/现金幂等、已有号兼容、跨店/角色/撤权、无时区输入、窗口边界和配置关闭：

```ts
assert.deepEqual(race.map(response => response.status).sort(), [201,409]);
assert.equal(await slotHeldCount(), 1);
await cancelWinningOrderTwice();
assert.equal(await slotHeldCount(), 0);
assert.equal(await sumInventoryReservations(), 0);
assert.deepEqual(await createdNumbers(), ['Q0001','Q0002']);
assert.equal((await createFromChangedPolicyQuote()).status, 409);
assert.equal((await reduceCapacityBelowCommittedCount()).status, 409);
assert.equal((await completeUsingWrongPickupNumber()).status, 400);
assert.deepEqual(await legacyOrderSnapshot(), beforeLegacyOrderSnapshot);
```

- [ ] 执行专项、API领域、分类/规格相关回归、独立源码与构建HTTP、tsc及diff检查；只在新变化或失败理由成立时扩展重跑。报告记录RED/GREEN、计数/库存SQL和迁移保留。独立审查通过后由协调器备份、迁移、核对旧表及重启。


## 接口与运行补充
使用现有apps/api/src/common/db.ts的Db.atomic完整事务及有界重试；时间重叠与计数并发都需真实DB证明。不要采用当前Prisma8文档的db.transaction或新错误码，本项目锁定Prisma6.19。版本核查及来源见docs/research/2026-10-20-delivery-pickup-research.md。
读取docs/tasks/product-options-api-report.md与实际orders.service.ts，保持既有配置版本、属性快照、加料/SKU锁顺序、现金幂等和库存释放。根将先完成商品规格Task3及真实交易验收，才派发本任务。根管理API进程停止/Prisma生成时机、增量迁移和保留哈希；不要未经通知生成客户端或迁移development。原保留恢复库及备份不得删除或改写。
报告写docs/tasks/pickup-api-report.md，提供RED/GREEN、迁移保护、测试命令/输出、自查、限制与提交。不要改README/config/requirements/progress/acceptance；这些由根负责。