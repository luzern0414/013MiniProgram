# 付款期限 UTC 修复报告

- 日期：2026-10-20；基点：`cd6a15b`。
- 提交：本报告与 `fix(api): enforce UTC payment deadlines and cap legacy expiry` 修复同一提交；最终 SHA 见交付消息或该文件的 Git 历史。
- 范围：订单付款期限、009 默认值增量迁移、隔离真实 HTTP/SQL 回归。单一实现者，未派生子 agent。Root 负责独立审查和 source 运行验收。

## 根因证据

Root 的 source 只读证据：`output/playwright/pickup-expiry-stored-text.mjs`，数据库会话 `TimeZone=Asia/Shanghai`；Q0001 的原始 `createdAt=2026-10-20 13:20:06.167`，`paymentExpiresAt=2026-10-20 21:35:06.155`，相差 `08:14:59.988`。

应用创建订单省略这两个字段。Prisma 写入的创建时间是 UTC，而 `paymentExpiresAt` 的 `now()+15min` 默认值从 timestamptz 转成无时区 timestamp 时依赖数据库会话。旧专项直接指定期限，未覆盖真实默认值。

隔离 RED 进一步确认同一根因：Prisma 实际会话仍为上海，真实 HTTP 新订单的 SQL 日期相差 `29,699,989ms`，而预期是 `900,000ms`。另有独立现金和扫描 RED，排除了只修改新默认值便能修复历史 pending 的错误假设。

## 实现

`payment-deadline.ts` 集中定义 15 分钟和 UTC 毫秒计算。创建事务用同一个 `createdAt` 写入 `paymentExpiresAt=createdAt+15min`。现金检查、扫描事务重验共用 `effectivePaymentDeadline=min(storedDeadline,createdAt+15min)`，不延后更短期限，不回写历史期限。

扫描候选增加 `createdAt<=now-15min` 的 OR 条件，保留每批 100、原有 `paymentExpiresAt/id` 排序，过滤已经释放库存的记录；原串行化事务内继续重验状态、付款状态、释放标记与有效期限。原库存、HELD 释放和审计规则继续复用。已收款返回原凭证，已完成 CONFIRMED 订单不被扫描修改。

009 唯一语句：

```sql
ALTER TABLE "Order" ALTER COLUMN "paymentExpiresAt"
SET DEFAULT ((now() AT TIME ZONE 'UTC') + '00:15:00'::interval);
```

Prisma schema 的 dbgenerated 表达式同步；没有新增字段、修改旧迁移、修改原列类型或更新原行。未运行 Prisma generate。API 继续隐藏 `paymentExpiresAt`，requestId 和错误状态码保持。

## TDD RED

实现修改前执行：

```text
node apps/api/tests/payment-deadline-runner.cjs --test-name-pattern "HTTP new orders|legacy polluted"
Prisma session timezone: [{"TimeZone":"Asia/Shanghai"}]
HTTP deadline SQL: 2026-10-20T13:41:54.353Z 2026-10-20T21:56:54.342Z deltaMs=29699989
FAIL HTTP order deadline must use the same UTC creation instant +15min
actual=29699989 expected=900000
FAIL expired legacy/short deadline cash must be rejected
actual=201 expected=409
tests 2, pass 0, fail 2; exit 1

node apps/api/tests/payment-deadline-runner.cjs --test-name-pattern "legacy sweeper"
FAIL legacy createdAt+15min must be included by candidate query
actual=0 expected=1
tests 1, pass 0, fail 1; exit 1
```

两次 RED 都在随机 `test_pickup_deadline_*` schema 中部署当时的 001–008；结束后仅删除自己成功创建且 OID/owner 一致的 schema。未使用 source 时间、造单或数据修改。

## GREEN 与回归

```text
node apps/api/tests/payment-deadline-runner.cjs
Prisma session timezone: [{"TimeZone":"Asia/Shanghai"}]
HTTP deadline SQL: 2026-10-20T13:46:14.369Z 2026-10-20T14:01:14.369Z deltaMs=900000
Legacy guard: instant/spec/booking/short deadline rejected; 4 closures, repeat=0;
inventory +4 once; CONFIRMED completed unchanged; stored deadlines unchanged
Pre-009 Asia/Shanghai SQL default seconds=29700
009 old-row SHA256 unchanged:
4bc1bd52c65fe41fd2d1ed007896dd5d1316b91ffc728742187384a11af91f05
Post-009 direct SQL timezone=UTC deltaSeconds=900
Post-009 direct SQL timezone=Asia/Shanghai deltaSeconds=900
tests 8, pass 8, fail 0; exit 0

node apps/api/tests/pickup-runner.cjs
tests 7, pass 7, fail 0; exit 0

pnpm --filter @restaurant/api test
tests 9, pass 9, fail 0; exit 0

pnpm --filter @restaurant/api exec tsc -p tsconfig.json
exit 0

git diff --check
exit 0（仅已有 CRLF 转换提示，无 whitespace 错误）
```

新专项覆盖：

1. 共享规则在 UTC 跨日时的毫秒边界、保留较短截止、压缩污染长截止；HTTP 新订单创建时间和期限精确相差 15 分钟，截止前 1ms 不关闭、精确截止关闭，重复 0。
2. 仅隔离夹具回填旧创建时间与污染的 8h15 期限：旧纯即时、含规格和加料即时、预约 pending，以及自带更短期限全部现金 409/STATE_CONFLICT、无凭证；扫描正确选择并关闭 4 单，库存和加料各返还 4、HELD 仅释放一次，重复扫描 0，事件和审计各一条。
3. 独立遗留扫描回归使用两个并发 sweeper，合计仅关闭 1 单、重复扫描 0；原 storedDeadline 保留。
4. 正常未来 pending、已收款完成的 CONFIRMED 订单与预约容量保留；旧已付凭证重试仍 201。API 详情仍隐藏内部截止，所有 HTTP 响应检查 requestId。
5. 独立迁移夹具部署 001–008，以原默认值在上海会话造旧行，再只应用 009。对所有旧表的所有行规范排序、计算完整 row_to_json 文本 SHA256，009 前后相同。之后原生 SQL 在 UTC/Asia/Shanghai 两个会话均得到 900 秒。
6. 拒绝 development/public/缺失 schema 后不连接；runner 与独立迁移夹具均保留碰撞 sentinel。创建成功标记、OID/owner 身份校验后才清理。

原预约专项同时覆盖现金并发幂等、规格/即时/预约库存生命周期、权限、历史查询与迁移 008 保留；没有运行可能 generate 的 API build。

## 自查与限制

- 仅显式暂存本修复七个文件；root 的 acceptance 改动、brief、两个旧 reviewdiff 不碰。
- 没有连接 source 做任何写入，没有 seed/reset source，没有迁移 development/public，没有停止或重启运行服务。测试 seed 和迁移仅在已验证的随机隔离 schema 执行。
- 009 是默认值修改；部署前后的真实旧列 hash、备份、仅009迁移和精确重启由 root 完成。真实 Q0001 必须由已真实过去的 15 分钟触发服务规则关闭；本报告不宣称 source 验收已完成。
- 保留既有 30 秒定时扫描和每批 100；历史有效期限的修复在运行时执行，不批量回写历史期限。
- 自查确认无客户端结构更新需求，无新字段，无原历史金额、菜单、取餐号、旧期限重写，无额外 API 字段泄露。独立审查交 root。
