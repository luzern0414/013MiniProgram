# 真实到期验收发现付款期限时区错误 — 修复需求

Root在source真实顾客H5创建Q0001，2026-10-20T13:20:06.167Z；实际等待超过15分钟，仍PENDING_PAYMENT/HELD。只读SQL证据 output/playwright/pickup-expiry-stored-text.mjs：服务器TimeZone Asia/Shanghai，createdAt原文本2026-10-20 13:20:06.167，paymentExpiresAt原文本2026-10-20 21:35:06.155，差08:14:59.988。Prisma普通now()由client时间写UTC，dbgenerated now()+15默认由数据库本地时区cast到无时区timestamp，产生8小时偏移。现有隔离用例直接设定期限，漏测真实默认值。不能修改source时间造通过。

## 约束
- 本修复基于当前cd6a15b之后，仅修付款期限；使用TDD/systematic-debugging。一个实现者，不另派子agent。
- 不源库写入、seed/reset/迁移/生成Prisma/停止进程/造单/收款；root维护运行/备份/迁移/真实验收。备份、恢复库、development/public全部历史保留。
- 保留历史订单菜品/金额/事件/库存/取餐号及既有paymentExpiresAt原值，不能批量回写历史期限；正常到期状态转换可由真实服务规则执行。

## 修复要求
1. 集中定义15分钟付款期限的UTC业务规则，不复制cash与expiry不同计算。新order在创建事务明确写createdAt和paymentExpiresAt=同一UTC时刻+15min，避免DB session时区依赖。已有订单（含被错误默认污染的pending）生效截止取 stored paymentExpiresAt 与 createdAt+15min 较早者，现金迟付拒绝与自动到期共用；不能延后更短既有期限。已收款/已完成旧订单不动。
2. 新增009仅ALTER Order.paymentExpiresAt默认值为明确UTC now AT TIME ZONE 'UTC' +15min，Prisma schema dbgenerated一致；不改原列/原行，不改旧迁移。没有新字段，客户端无需结构更新；不能擅自generate。迁移前后保留全部旧列hash由root负责。
3. expire候选查询必须把已创建15分钟以上的pending纳入（仅按污染storedDeadline会永久漏掉），实际事务内重验有效期限、状态、inventoryReleased；采用既有有界batch/order，库存及HELD只释放一次，CONFIRMED不释放。cash检查同规则。旧纯即时、规格与预约均兼容。
4. API视图仍不泄露内部付款时限；requestId/状态码保持。

## TDD与验证
已有安全随机test_pickup runner/新独立safe runner中真实HTTP+SQL先观察RED：非UTC(Asia/Shanghai)会话/当前DB已有该时区，创建order deadline与createdAt实际差应15min，原代码差8h15m。新增正常未来订单不提前关闭；遗留错误8h15默认pending（仅隔离夹具）在created+15截止能被sweeper选择/释放一次、重复扫描0；现金同截止拒绝且无凭证，早于自带更短截止也拒绝。确认预约CONFIRMED完成容量不因扫描改变；oldstoredDeadline本身不回写。
验证009 direct SQL默认独立于sessionTZ、UTC/AsiaShanghai两种均为UTC+15，迁移旧行不变。只在随机test_* schema执行fixture、迁移及清理，保持现有schema创建身份/OID保护。
跑相关API专项、领域、build仅tsc（pnpm --filter @restaurant/api exec tsc -p tsconfig.json）、diffcheck；必要隔离原收款HTTP回归。不要调用API build含prisma generate。报告写docs/tasks/payment-deadline-fix-report.md，含RED/GREEN命令输出、时区证据/旧行保留、测试、自查、提交及限制。
显式暂存自己文件，root acceptance/progress等不碰，两个旧reviewdiff保留。返回DONE、提交、测试简述。Root独立审查通过后先backup再仅009迁移，精确重启后原Q0001应按真实已经过去的15分钟自动关闭；不改source时间。
