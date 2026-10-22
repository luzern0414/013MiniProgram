# 现金退款与对账调研

日期：2026-10-20。此文为后续财务/收银模块准备，未实现或验收退款。当前预约自提仍在独立实施，不能将调研计入需求完成。

## 实际来源与复用边界

通过 Firecrawl developer 搜索后读取完整来源，抓取文件哈希见 `data/research/cash-refund-sources.json`。不引入新运行依赖，不复制未核查许可的源码。

- [Medusa 固定提交的订单付款文档](https://github.com/medusajs/medusa/blob/61c19c3099d58b3b3900da70d92a647c33b09bb5/www/apps/user-guide/app/orders/payments/page.mdx)：支持部分/全额退款，金额、原因与备注；原文为“Refunding payments is irreversible.”。退款可以独立于退货建立，不能把返款与恢复库存视为同一步。索引许可NOASSERTION，只参考流程，不复制实现。
- [Medusa #16964](https://github.com/medusajs/medusa/pull/16964)：本轮完整读取页面，明确显示Merged。说明退款status与idempotency_key，并以同一个key重试退款，而非建立新的退款。其失败记录soft-delete是上游实现选择；本项目需要不可变审计，不能因为读取该PR便采用删除失败轨迹的行为。这里只确认描述与合并状态，没有运行上游代码，也不将索引issue地址误当未合并issue。
- [Frappe Books POS文档](https://docs.frappe.io/books/transactional-entries.md)：本轮完整读取的页面包括开班现金、销售、退货和交班。原文为“Expected is the opening amount, plus the POS payments in the shift, minus the refunds.”，并要求设备在线关班。可复用计算关系和明确现金差额的交互；不把“账面应有”自动写成“实点一致”。这是可变在线文档，以本次哈希固定阅读证据，未复制实现。
- [ERPNext #25638](https://github.com/frappe/erpnext/issues/25638)仅取得索引中的历史缺陷描述：expected amount包含找零造成错误。它是回归场景线索，未阅读合并修复，不据此判断当前ERPNext仍有缺陷。GPL-3.0索引信息不授权将代码直接纳入当前项目。

一次抓取 `https://docs.frappe.io/erpnext/user/manual/en/pos-closing-entry` 实际返回 Stock Closing Entry，内容是库存结转；已排除为POS交班依据，不能仅凭输入URL给它错误归类。另有 POS Awesome GPL-3.0 README命中，只作为候选，未采用其源码。

## 现有代码与后续设计约束

本轮只读核查当前 `CashPayment`：保留应收amountFen、实收tenderedFen、找零changeFen，一单一笔唯一记录；订单现金收款及库存结算同事务。`MerchantController.overview`收入已经按现金记录的createdAt归属营业日，退款当前却按订单createdAt及refundStatus汇总totalFen。现在没有真实退款记录所以尚无错误金额实例；加入部分退款或跨日退款前必须改成真实返款记录归属日聚合，不能只设置一个SUCCEEDED标签继续复用旧查询。

后续实现应保持以下关系：

1. 原收款凭证不可改写或删掉。退款单独保存正整数分金额、原收款/订单关系、门店、确认员工、原因、时间、幂等键及请求摘要；同键同载荷返回原凭证，同键异载荷409。
2. 退款累计不得超过原入账amountFen；不得使用tenderedFen作为可退上限，因为实收现金已经含应找零。最后一笔可退额的并发竞争在数据库事务内裁决，不能只比较页面剩余金额。
3. 现金退款必须由授权员工明确确认已经交还顾客现金，系统记录此事实。顾客不能直接调用经营返款端点；所有端按同一真实凭证显示退款进度，不把记录现金交还声称为微信原路退款。
4. 金钱返款、取消履约与库存处理分别定义。餐饮已制作食物不能默认回到可售库存；若后续增加未制作退库，应显式限定状态、SKU/加料数量、唯一退库标记及审计。金额部分退款无法推导商品份数，不自动按比例退库。
5. 已付款预约的CONFIRMED容量按当前预约政策保留，财务返款不自动删除预约记录或重复释放产能；是否停止履约必须通过有记录的订单规则。历史已完成订单不抹除完成事件。
6. 所得收入按收款时间，返款按返款时间，净额=收入−返款。同一营业日统计不依赖订单创建日，跨日可出现当天净流出。交班应有=期初+净现金入账−现金退款+其他已确认现金流，实点与差额另存；当前未实现其他现金流时不能虚构为0已核对。
7. 未知写入结果保持同一退款请求和幂等键，允许真实查询恢复，不能换新键重做；过期会话或查询失败不能证明上次退款没有建立。

## 需执行的验收

真实页面创建可识别本地现金单→部分返款→另一端重读→剩余额全退；SQL原收款不变、两返款累计等于原amountFen，实际库存符合明确规则。另验证同键重试、异载荷冲突、两人竞争最后可退额、跨店/角色撤权、断网及已提交丢回执恢复。跨日夹具只能在安全随机隔离测试库中设置时间，不改运行库历史凭证。三端详情、统计和后续导出用同一现金账本复算。

这些是后续计划的约束和验收候选，目前不将REQ-011/012/090等标为已实现。
