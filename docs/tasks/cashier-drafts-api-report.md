# Cashier drafts API implementation report

状态：Task 1 已实施并在隔离 PostgreSQL 上通过源码、编译 HTTP 与相关回归；等待 root 独立审查及源库迁移关卡。未实施 Task 2/3 前端。

## 范围、基线与数据保护

- 首读并记录 BASE：`48a1c21e78563a7bdc63def7f5b481334411e372`。实施遵循 `.superpowers/sdd/cashier-drafts-api-brief.md`、`D:/Codes/开发规范.txt`、implementer 契约及 TDD / systematic-debugging / verification-before-completion 技能。
- 源 `development` / `public` 无业务写、seed、reset、迁移或清理；已有 001–010 与源业务数据全部留给 root 维护。未向源 API 发送造单请求。未停止任何进程、未启动或重启源 API。
- root 确认精确停止其 API PID 28108 并确认 3000 释放后，明确授权本次 `Prisma generate`；只有该授权后才执行生成及直接 tsc 构建。未调用包含隐式 generate 的 workspace build。
- 新增测试及迁移夹具仅用本轮 CREATE 成功的随机 `test_cashier_drafts_*`；必要原回归按 root 明确确认，继续使用其原安全 runner / 原随机前缀，不放宽旧 guard。
- root 同期提交准备文档 `74ccdf6`、`57b7e1e`，实施未覆盖或暂存这些工作；两份旧 catalog review diff 未动。仅显式暂存本任务文件，以 Codex / codex@local.invalid 提交。

## 实施内容与合约

- 新增 `CashierDraft` 模型及 011 纯增量迁移；草稿与订单分开，保存 selection 及服务端 display，不预占、不生成取餐号、订单、现金或应收。
- 新增 `cashier-drafts.controller/service/validation.ts`、`draft-conversion.ts`，注册六个合约端点。`DraftView` 严格投影，不暴露 key/hash/员工账号。API 类型、参数、错误及权限已写入 `docs/architecture/api-contract.md`。
- 列表按授权 storeId/state 的 SQL 谓词筛选、真实 count、updatedAt DESC/id DESC 分页；测试插入 2001 条时间更新的 CANCELLED 历史后仍能查到 DRAFT，状态总数正确。page 正安全整数，pageSize 1–50；超出末页直接返回空项而不把超大 offset 传给 Prisma Int。
- name trim 后 1–60、note 必须字符串且至多500、1–100行、数量1–99；标识符字符串至多200。modifierIds 最多20输入项、去重排序；attributeOptionIds 最多50、重复拒绝并排序。所有层级白名单拒绝金额、状态、display、orderId及未知字段。
- 保存核对本店 SKU、同商品加料/属性、桌码及预约时段归属，允许仍存在的下架、停用、缺货或过期选择保存。无法解析的删除选项返回400并保留原草稿，不自动丢弃。报价再执行现有完整当前规则与当前价格。
- 创建 key 作用域 `(storeId,createKey)`；SHA256 覆盖当前创建者ID及规范化原请求。重放返回当前事实；异载荷或另一创建者409 `IDEMPOTENCY_CONFLICT`，不新增审计。更新/取消 CAS revision+1；旧版本或非 DRAFT409 `DRAFT_CHANGED`。重复取消已 CANCELLED 返回事实；CONVERTED 编辑/取消409 `DRAFT_ALREADY_CONVERTED`。
- 将原报价事务体提取为 `OrdersService.quoteInTransaction(req,body,tx,draftBinding?)`，普通 `/quotes` 仅打开一个原有 `Db.atomic` 并复用该方法。草稿报价在同一事务中检查状态/版本并调用该入口，快照绑定 `{id,revision}`；公共 `/quotes` 白名单禁止传入绑定。
- 现有公共 `POST /orders` 自动识别服务器快照绑定，转单与绑定/审计在同一原有下单事务提交。成功后草稿 revision+1/CONVERTED/orderId；订单后续取消不复活草稿。并发不同报价与不同 key 只有一笔成功；原成功 key 可恢复已取消的原订单且不再预占。

## 事务、权限、幂等与锁顺序

1. 新建/更新/取消/报价先做结构校验和外层当前 staff 检查；每次 `Db.atomic` 回调内重新 `AuthService.staff(req,storeId,false,tx)`，复核有效会话、enabled、OWNER/CLERK、同品牌及本店授权。列表/详情在同一只读 Serializable 快照内复核权限和查询。
2. 新建在事务内权限检查后计算 hash、查 `(storeId,createKey)`；同 hash 才返回当前草稿。首次保存选择归属、display、草稿及 `CASHIER_DRAFT_CREATED` 审计一起写入。并发同 key 通过既有 P2002/P2034 整体重试恢复同一事实。
3. 更新/取消/草稿报价在权限检查后参数化 `SELECT ... FOR UPDATE` 锁定指定 store 的草稿行，再检查 state/revision；修改通过 id/storeId/state/revision CAS，更新时间及审计同事务。取消已取消状态在权限和行归属之后返回，不新增事件。
4. 下单先在事务内重验 user、查询其现有 idempotency key。若原订单有草稿关联，**先重验当前 staff/门店/品牌**再原订单授权/hash及幂等返回，阻止原创建员工降为顾客、撤权或停用后恢复回执。
5. 新下单校验报价所有权后，对绑定调用事务内 staff 复核、草稿行锁、DRAFT/revision检查，然后沿用报价有效期、门店、商品、属性、分类、价格、预约检查。新转单的写锁顺序为：草稿行 → 排序 Modifier IDs → 排序 SKU IDs → PickupSlot CAS → 门店日期 PickupSequence → Order/Event → PickupReservation → 草稿 CAS/orderId → 审计。未加入第二套计价、预占或嵌套独立事务。
6. 每个失败都回滚同一事务，包括预占、HELD、Q序号、订单/事件、草稿绑定和审计。数据库 orderId 唯一/FK以及状态+版本 CAS双重保护一次转换。

### 实际发现的序列化错误与修复

首次源码 GREEN 尝试中两员工竞争得到 `[201,500]`。按 systematic-debugging 在测试边界临时捕获 metadata，focused 再现命令：

```text
node apps/api/tests/run-cashier-drafts.cjs --test-name-pattern 'two staff'
raw lock error metadata {
  code: '40001',
  message: 'could not serialize access due to concurrent update'
}
API error { ... type: 'PrismaClientKnownRequestError', code: 'P2010' }
AssertionError ... actual: [201,500], expected: [201,409]
Exit 1
```

原因是 Prisma 对原始 SELECT FOR UPDATE 的 PostgreSQL SQLSTATE 40001 使用 P2010，原 `Db.atomic` 只识别 P2034/P2002。修复局限在草稿行锁函数：仅 P2010 且 meta.code 为40001或40P01转为 P2034；其他错误原样抛出，不做泛化重试、不改通用 Db。`Db.atomic` 因此重试完整回调，所有事务内身份检查、报价及草稿状态检查都会重新执行。临时诊断日志已移除；真实竞争在最终源码及编译 HTTP 中均得到201/409，失败方为 `DRAFT_ALREADY_CONVERTED`。

```text
node apps/api/tests/run-cashier-drafts.cjs --test-name-pattern 'two staff|inactive'
✔ HTTP two staff quotes compete for exactly one atomic conversion and original key replays after cancellation
✔ HTTP saves inactive selections but re-quotes prices and rejects changed inventory/options/slots without destroying draft
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

40P01 分支按同一 PostgreSQL事务回滚语义处理；本次真实竞争直接观察到的是40001，未另人为制造死锁。

## TDD：真实 HTTP RED

最先只加入受保护 runner/schema及真实 HTTP夹具与保存断言，在任何生产功能实现前运行：

```text
node apps/api/tests/run-cashier-drafts.cjs
Datasource "db": PostgreSQL database "restaurant_dev", schema "test_cashier_drafts_29e4a6980a86" at "127.0.0.1:55432"
10 migrations found in prisma/migrations
All migrations have been successfully applied.
cashier drafts HTTP status= 404
✖ HTTP saves durable draft without reserving inventory, capacity, sequence, orders or cash
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
404 !== 201
actual: 404
expected: 201
Exit 1
```

失败来自新端点尚未实现，非配置、导入或数据库连接错误。夹具是真实 Nest HTTP + Prisma/PostgreSQL：提供owner/本店另一staff/customer/他店身份、合法选择和req；快照读取全部SKU/加料 stock/reserved、预约计数/预约状态、日序号、订单/现金/退款计数及金额，不以mock替代数据库。runner失败后仍按本轮所有权清理。

## 最终 GREEN / 回归原输出

生成与构建命令（均 exit0）：

```text
node apps/api/node_modules/prisma/build/index.js generate --schema apps/api/prisma/schema.prisma
✔ Generated Prisma Client (v6.19.0) ... in 259ms
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json
[无输出，exit0]
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
[无输出，exit0]
```

最终源码 HTTP（`test_cashier_drafts_030bda990cff`）：

```text
node apps/api/tests/run-cashier-drafts.cjs
cashier drafts HTTP status= 201
✔ HTTP saves durable draft without reserving inventory, capacity, sequence, orders or cash
✔ HTTP create idempotency canonicalizes input, returns current facts and rechecks staff access
✔ HTTP strict whitelist, limits, relationships, pagination and store/brand permissions
011 old-column/text-time SHA256 unchanged: 429031f334bcfd40010d107adc8b54bb76d0fb0ac23f355c5a1b971c10628587
Draft direct SQL UTC deltaSeconds= 0
011 defaults/CHECK/UNIQUE/RESTRICT enforced; old tables preserved
✔ 011 migration preserves every old row/column and original timestamp text with new constraints
✔ draft module rejects unsafe schema and wrong database before access
✔ draft runner CREATE collision preserves prior schema/OID/owner
✔ draft migration fixture CREATE collision preserves prior schema/OID/owner
✔ HTTP competing edits use CAS and stale quotes cannot convert
✔ HTTP two staff quotes compete for exactly one atomic conversion and original key replays after cancellation
✔ HTTP saves inactive selections but re-quotes prices and rejects changed inventory/options/slots without destroying draft
✔ HTTP rechecks authorization inside write transaction and conversion audit failure rolls all effects back
ℹ tests 11
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8028.5903
```

最终编译 HTTP（确实加载dist的createApp/AuthService/OrderExpiryService，schema `test_cashier_drafts_fda0b8694950`）：

```text
$env:CASHIER_DRAFTS_TEST_BUILD='true'; node apps/api/tests/run-cashier-drafts.cjs
[与源码相同11项通过，旧列/原时间SHA256及UTC deltaSeconds同上]
ℹ tests 11
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7811.0502
```

专项检查还包括：同key并发只创建一次、跨设备staff读取、创建者身份hash、创建key恢复编辑/取消后当前事实、失权重放、两版本CAS、旧草稿报价修改后409、公共/orders两员工不同报价竞争、报价归属拒绝、精确一订单的SKU/Modifier/HELD/Q号/现金差异、原订单key丢回执恢复、取消不复活、角色降为CUSTOMER及enabled=false拒绝原key、属性删除后原草稿保留、改价重报及旧价格下单拒绝、失效选项/预约保留、2001历史分页与真实total、无授权和跨品牌拒绝。审计故障测试捕获并核对一条脱敏500日志/requestId，确认所有效果回滚；不会把预期故障日志混入最终专项输出。

原相关回归（各自随机 schema、原runner CREATE/OID/owner保护，合计37/37）：

| 命令 | 随机schema | 真实结果 |
| --- | --- | --- |
| `node apps/api/tests/cash-refunds-runner.cjs` | `test_cash_refunds_ee9e184db820` | tests10 / pass10 / fail0，duration_ms7866.9243 |
| `node apps/api/tests/pickup-runner.cjs` | `test_pickup_59af9ac76082` | tests7 / pass7 / fail0，duration_ms8948.2944 |
| `node .superpowers/sdd/product-options-runner.cjs` | `test_product_options_80889d2d6e61` | tests10 / pass10 / fail0，duration_ms9149.4097 |
| `node apps/api/tests/cash-refunds-runner.cjs --regression` | `test_cash_refunds_regression_cd5335038f93` | domain+integration tests10 / pass10 / fail0，duration_ms3769.8744 |

回归原输出摘录：

```text
cash refund HTTP status= 201
✔ HTTP partial then full refund preserves payment, snapshots, inventory and CONFIRMED pickup capacity
✔ HTTP completed orders preserve completion; competing keys cannot overdraw the last balance
✔ HTTP revalidates authorization inside the transaction and rolls back all ledger writes on audit failure
[该原suite预期注入故障产生一条原有API error脱敏日志；无非预期失败]
Direct SQL refund default UTC deltaSeconds= 0
010 old-column snapshot unchanged; refundedFen default=0; CHECK/UNIQUE/RESTRICT enforced
Lookup SQL: 2001 unrelated histories; exact new/legacy lookup, Shanghai half-open boundaries, 104 collisions, permissions and malformed queries passed
Migration 008 preserved Store/Product/Sku/Modifier/Order/Quote/Session/CashPayment; old number and snapshots unchanged
✔ product options HTTP validates complete trees, revisions, permissions and inventory-backed ordering
✔ database-backed security, quotes, inventory, idempotency, cash and CMS
```

仅运行上述必要回归，未扩展无关suite。Git diff --check仅有仓库既有CRLF转换提示，退出0，无空白错误。

## 迁移、时间与隔离清理证据

- 011显式BEGIN/COMMIT，只新建表、索引/FK；revision>=0，state三值，CONVERTED当且仅当orderId非空，orderId唯一且Order FK RESTRICT，Store及创建/编辑User FK RESTRICT。Prisma关系与SQL一致。
- 新表createdAt默认 `(now() AT TIME ZONE 'UTC')`，应用create/updatedAt使用JS Date写UTC。无旧表ALTER/UPDATE、无历史日期默认更改；测试在Asia/Shanghai数据库会话下直接SQL创建草稿，UTC差0秒。
- 迁移夹具先部署001–010，造旧商品/库存、报价/订单、现金/退款、会话、事件及审计；枚举全部旧表和全部旧列，以SQL `row_to_json(... )::text`保留原timestamp字符串，不经JS Date转换。迁移前后文本及SHA256完全一致。约束测试实际触发23514/23505/23503；创建者缺失、编辑者删除等受FK阻止。
- 模块加载即检查DATABASE_URL为本地project数据库且schema匹配新前缀；缺省、development/public、错误DB/端口在任何连接前拒绝。外层runner及嵌套夹具先验证project marker、data_directory及PG16；仅成功CREATE后记录OID/nspowner，本轮created且标识仍一致才DROP。CREATE失败或碰撞不会清理旧对象。
- runner与迁移夹具分别真实碰撞现有schema；原OID/owner及sentinel=42保持。临时审计函数/trigger只放在本轮自有外层schema，最终由该schema的OID/owner清理关卡统一清理，不删除未知旧对象。
- 所有已执行runner均返回退出码0或预期RED退出1；没有异常清理失败。源库真实备份、恢复、旧列/原时间基线比对及仅011迁移须由root在独立审查Approved之后执行，实施者未执行。

## 自查、限制与提交

- 逐项复核brief固定合约、数值、创建者hash、权限在幂等前、数据库列表谓词、CAS、唯一性及事务边界。发现并修复P2010/40001重试差异；修正测试夹具过短预约窗口（原5分钟最小CHECK），没有改变既有规则。无未解决的已知功能缺陷。
- OrdersService原文件已有大量履约逻辑，当前294行；本次只提取报价事务体并在原create加入绑定处理，未重构其他职责。新模块按计划四文件分工，未另建平行计价服务。
- 只证明本地隔离API/PostgreSQL行为；未验证前端、真机、AppID、微信支付、域名或生产部署。尚未源库部署，源API继续由root管理维护窗口。重放普通订单时也会查询新CashierDraft关系，因此恢复新编译API前必须由root完成011关卡。
- 实施提交：`f09cc45` — `feat(api): persist cashier drafts and atomically convert orders`（12个明确任务文件，614行新增/7行删除）。本报告单独文档提交，最终SHA见交付消息。
- 变更文件：`apps/api/prisma/schema.prisma`、`apps/api/prisma/migrations/202610200011_cashier_drafts/migration.sql`、`apps/api/src/app.module.ts`、`apps/api/src/modules/orders/orders.service.ts`、`apps/api/src/modules/cashier-drafts/{cashier-drafts.controller,cashier-drafts.service,cashier-drafts.validation,draft-conversion}.ts`、`apps/api/tests/{cashier-drafts-schema.cjs,cashier-drafts.test.ts,run-cashier-drafts.cjs}`、`docs/architecture/api-contract.md`、本报告。
