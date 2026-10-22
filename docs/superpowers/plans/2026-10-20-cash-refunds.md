# 现金退款与真实返款统计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development task-by-task。预约自提完整验收后再执行，同一时间只有一个实现者，每任务独立审查。

**Goal:** 为已确认的现金交易提供有权限、可追踪、可恢复的部分/全额返款，并让三端详情及经营统计读取同一真实返款凭证；继续推进REQ-010/011/012/015等相关能力。

**Architecture:** 原现金收款凭证保持，新增不可变返款记录及累计退款计数，返款与订单事件、审计同事务。财务返款独立于商品退库；预约确认产能遵循已实现政策，不因退款回收。后续交班/对账使用这一账本，不在前端拼凑财务真值。

**Tech Stack:** NestJS11、Prisma6.19、PostgreSQL16、Vue3、uni-app、mini-core。

## Global Constraints

- 保留development/public全部已有商品、订单、库存和会话，不删库重置；迁移必须可作用于现存数据。
- 正式业务数据全部通过后端读写数据库；不得伪造成功，不得改变历史订单快照。
- 所有界面文字原则上不得小于14px，提交禁重，失败提示清晰，保留requestId。
- 现金返款写入仅允许当前有效OWNER且有本店授权，事务内重验；CLERK可读授权门店的订单和凭证，不得确认返款。
- 金额使用整数分；不修改原收款amountFen/tenderedFen/changeFen、原订单菜品/金额快照或旧状态事件。
- 当前没有AppID/支付/域名/服务器资源，继续本地验收，不声称现金凭证代表微信原路退款、真机或生产已验证。

## 业务决定与数据边界

此任务提供现金退还事实的登记；经营者须已经把现金交还给顾客，再点击确认。顾客不能直接返款，相关微信退款接口保持未接入状态。无需现金退还时不建立成功凭证。不以外部支付沙盒或虚假回调绕过该规则。

允许正整数分部分退款，多笔累计不超过原入账amountFen。可退额=amountFen−refundedFen，不能以tenderedFen作为上限，不能扣除找零两次。全退由服务端按原入账及累计判断，客户端不能自行提交状态或累计值。

新模型：

```text
CashPayment.refundedFen Int default0
CashRefund {
  id, paymentId FK CashPayment RESTRICT,
  staffId, amountFen, reason, createdAt,
  idempotencyKey, requestHash
  UNIQUE(paymentId,idempotencyKey)
}
```

数据库约束0≤refundedFen≤amountFen及退款amountFen>0；原收款记录在同一个Serializable事务中按旧refundedFen条件更新，与退款行、订单当前状态、事件和审计同时提交。根不允许源库迁移前自作主张重算历史统计或凭证。读取来源payment→order→store进行品牌、门店和顾客归属判断，不接受客户端传paymentId来转移别店交易。

请求header `Idempotency-Key`，长度和规则沿用既有订单现金请求。作用域为原收款paymentId；摘要包括订单、storeId、整数amountFen及规范化reason。同key同载荷返回原成功凭证，不新增事件/审计；同key异载荷409 IDEMPOTENCY_CONFLICT；不同key竞争余额由事务裁定，超额409 REFUND_EXCEEDS_REMAINING，非现金或未收款409 CASH_REFUND_UNAVAILABLE。实时身份/授权检查必须先于幂等返回，撤权后不能凭旧key读取经营凭证。

返款成功后order.refundStatus为PARTIAL或SUCCEEDED，零退款保持NONE。paymentStatus保留PAID表示原收款事实；三端明确同时展示累计退款/剩余实收，不能只显示“已付款”掩盖已返款。全额退款将尚未完成的订单关闭为CANCELLED并追加现金全额退款原因；已完成订单仍保留COMPLETED及旧完成事件。部分退款不静默结束履约。所有合法动作必须基于当前订单，已关闭全退单不能再制作、收款或核销。

本计划不自动退回商品或加料库存。金额无法证明食物可重新销售，也不能推断行数量；页面确认区明确“退款不增加商品库存”。需要补充可售量由现有有权限的库存入口独立处理并审计。不得将settleInventory再次调用到已现金结算的库存。已确认预约保留CONFIRMED容量，不因全额退款关闭订单就转换为RELEASED；无退款的HELD取消/到期仍沿用预约模块原规则。

## API与展示

```text
POST /merchant/orders/:id/cash-refunds
 {storeId, amountFen, reason}
 header Idempotency-Key
 -> 当前订单视图，包含cashReceipt、cashRefunds、refundedFen、netPaidFen

现有GET顾客/商户订单详情与列表
 -> cashReceipt.refundedFen；cashRefunds:[{id,amountFen,reason,createdAt}]
    refundedFen、netPaidFen
```

顾客视图不得返回staffId、幂等键、请求摘要、员工账号或无关门店信息；商户订单视图也不需要暴露幂等内部字段。历史未退款现金单读取退款[]、累计0、净入账原amountFen；无现金凭证为0，不为未付款单生成虚拟凭证。退款列表稳定按createdAt/id排序，沿现有订单授权边界。

overview收入继续按CashPayment.createdAt与amountFen汇总，退款改为CashRefund.createdAt/amountFen按门店Asia/Shanghai日期聚合；净额=收入−退款。禁止使用订单创建日、订单totalFen或任意refundStatus布尔累计来代替退款凭证。当天可净流出，不能截成0。取出统一日期范围辅助逻辑供未来财务页复用；不扩写完整对账/交班页。

## Task 1: 现金返款账本、权限与统计

**Files:** 下一编号Prisma迁移/schema；独立 `apps/api/src/modules/finance/cash-refunds.{controller,service,validation}.ts`、现金日期汇总辅助模块；orders视图及必要状态规则；merchant overview；app.module；`apps/api/tests/cash-refunds.test.ts`与安全隔离runner；API合约、`docs/tasks/cash-refunds-api-report.md`。

**Interfaces:** 消费现有CashPayment、OrdersService授权、Db.atomic及预约CONFIRMED政策；产出上述返款端点与详情字段，保持原收款及旧订单兼容。

- [x] 随机test_cash_refunds_*安全隔离schema真实HTTP先观察新端点404形成RED。模块加载拒绝development/public和缺省schema；所有嵌套CREATE失败/碰撞不得清理旧对象，清理须确认本轮创建成功及OID/owner。
- [x] 增量迁移保留原字段和全部行，refundedFen默认0，新增约束及Restrict关联；根停自有API才生成Prisma，未独立审查前不迁移源库。
- [x] Serializable内重验OWNER/品牌/门店/原现金支付，验证正整数分/原因/白名单/幂等；退款累计CAS防超额，订单状态、事件、审计同事务。领域逻辑不要塞进merchant controller。
- [x] 订单三端读取同一凭证，详情汇总来自真实退款；overview按各自发生日期聚合收入与支出，负净额保留；不自动返库存或释放CONFIRMED预约。
- [x] 真实DB/HTTP覆盖部分→剩余额全退、并发最后可退额、同key重放、异载荷409、超额/非法金额、CLERK/跨店/跨品牌/撤权、未收款/非现金、已完成及未完成全退、旧凭证原值、库存不变、CONFIRMED预约计数不变，以及安全清理碰撞。

```ts
assert.deepEqual(lastBalanceRace.map(r=>r.status).sort(), [201,409]);
assert.equal(await refundSum(), originalAmountFen);
assert.deepEqual(await originalCashFields(), beforeCashFields);
assert.equal(await sameKeyRefundCount(), 1);
assert.equal(await cancelledFullRefundOrderCanFulfill(), false);
assert.equal(await confirmedPickupCapacity(), beforeConfirmedCapacity);
assert.deepEqual(await allInventory(), beforeInventory);
```

- [x] 跨日与时间边界仅在隔离夹具设定，证明昨日收款今日返款不重写昨日收入。执行专项、API领域、原现金/预约/规格相关回归、构建HTTP及tsc/diff检查；报告命令输出、自查和限制。根审查后备份/迁移/比较旧列再恢复运行API。

## Task 2: 两商户返款入口与顾客凭证

**Files:** Web独立`CashRefund.vue`、merchant-mini独立返款组件，Orders各入口；customer详情；mini-core返款请求恢复状态及测试；`docs/tasks/cash-refunds-ui-report.md`。根维护README/config/requirements及实际验收记录。

**Interfaces:** 消费Task1实际详情与POST合约；沿用现有权限、mutation/blocked、会话隔离及未知写入恢复，原现金收款流程保持。

- [x] 行为测试先RED：金额上限是入账减已退，1分钱有效、超额拒绝；请求未知结果保持同一key/金额/原因；读取失败不解锁；确认返款凭证后清除当前尝试，切换用户/门店不泄露上一单。
- [x] OWNER现金订单详情显示原收款、累计退款、净实收及明细；返款表单填本次金额/原因，默认不直接全额提交。展示此次与剩余金额，确认“已向顾客退还现金”才提交；期间锁切店/关闭/导航。CLERK只读，无写入口。
- [x] 未知结果展示自然文案，保存原尝试，真实重读订单确认；查询无匹配不能自动认定原请求未提交，应保留同key恢复入口。已确定400/409拒绝允许核对更新可退额再修改新请求，不丢弃已成功的退款记录。
- [x] 顾客与商户详情刷新显示同一退款额、原因及时间，历史收款/菜品快照保持。全额退款闭单后无接单/核销动作；已完成订单仍显示原完成状态和已全额退款，不将历史改成未交易。
- [x] 相关行为测试、Web及双mini H5/mp-weixin构建、独立审查；根实际造可识别现金单→Web部分退→H5重读→H5退剩余→顾客/SQL核对，实际演练丢回执及重复请求、超额/越权与离线恢复。旧现金单及原预约容量保留。
- [x] 根记实际订单/凭证/库存/统计及偏差；仅该子能力验收，不据此把完整REQ-011财务对账、REQ-090交班或微信退款标记完成。

## 依据

来源及采用边界：[现金退款调研](../../research/2026-10-20-cash-refund-research.md)。Task1及Task2已通过独立审查，迁移保留与真实三端/SQL验收见退款阶段记录；完整财务导出、人工差异对账、班次、现金盘点和其他支付退款随后独立推进。
