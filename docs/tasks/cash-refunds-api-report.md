# Task 1：现金返款 API 实施报告

日期：2026-10-20。需求以 `.superpowers/sdd/cash-refunds-api-brief.md` 为准；任务基线 `ab2dc1811e72c1fb1ddec7ded17259c7f5ffa85a`。实现提交：`cad869794ffebd8f5b501754fe6a02fef6315f45`（`feat: add cash refund ledger and real cash summaries`）。本报告另作一次文档提交；期间 root 的其他文档提交不属于本任务实现。

状态：**Task 1 API 已实现、已运行并通过本地隔离 DB/HTTP 验证，等待独立审查及 root 源库迁移**。本任务没有实施 UI，没有源库迁移、seed/reset、历史重算或 API 重启，没有声称微信、真机或生产验证。

## 接口与实现

- 新增 `POST /merchant/orders/:id/cash-refunds`：白名单 `{storeId,amountFen,reason}`，必填 `Idempotency-Key`；金额为正整数分，原因去首尾空白，key 沿原订单非空/120字符规则。只允许当前有效且有本店授权的 OWNER；顾客/CLERK不可写，CLERK保留原订单读取权限。
- 独立 finance controller/service/validation；复用 `AuthService.staff`、`OrdersService.authorize`、`Db.atomic`。Serializable 内先重验会话/启用/角色/品牌/门店及原订单归属，随后查原 CashPayment 和幂等记录，不能以旧key绕过撤权，也不接受客户端传 paymentId。
- 幂等作用域 paymentId；摘要包含 orderId/storeId/amountFen/trim后reason。同key同载荷只返回当前订单及原凭证，同key异载荷409 `IDEMPOTENCY_CONFLICT`。累计 CAS、返款、订单事件、状态和 `CASH_REFUND` 审计同事务；余额不足409 `REFUND_EXCEEDS_REMAINING`，非现金或未收款409 `CASH_REFUND_UNAVAILABLE`。
- 余额按原 `amountFen-refundedFen`，不使用 tenderedFen，不重复扣找零；部分为 PARTIAL，全额为 SUCCEEDED。原 paymentStatus 保留 PAID，未完成全退订单为 CANCELLED，已完成仍保留 COMPLETED 和旧完成事件。全退关闭单不能再次现金收款、制作或核销；其他原现金重放兼容。已收款取消/拒单继续拒绝直接取消，提示联系门店/由店主处理实际返款。
- 订单公共视图统一新增 `cashReceipt.refundedFen`、`cashRefunds`、`refundedFen`、`netPaidFen`；详情/列表/写入响应共用同一 include/view。返款严格只返回 id/amountFen/reason/createdAt，稳定按 createdAt/id；不返回 staffId、员工账号、幂等键或摘要。旧现金单为 []/0/原实收，无现金单为 null/[]/0/0。
- `cash-summary.ts` 复用既有上海日期规则，统一财务日期范围和现金汇总。overview收入按 CashPayment.createdAt/amountFen、支出按 CashRefund.createdAt/amountFen；不依赖订单创建日、totalFen或refundStatus模拟退款，净额可为负。
- 没有调用库存结算或预约释放。全退不增加 SKU/Modifier 库存，预约 CONFIRMED 状态、confirmedCount 和原窗口保留。009付款截止规则未改动。
- API合约已更新，明确现金返款仅登记经营者实际交还现金的事实；微信支付/退款仍未接入。未知结果需真实重读，不能用同金额/原因推断某次提交成功；必要时以原key及原载荷显式重放确认。

## 迁移与保护

010为显式 `BEGIN/COMMIT` 增量迁移：CashPayment仅增加 refundedFen default0及范围CHECK；新增 CashRefund 正金额CHECK、paymentId/key唯一索引、日期索引及原收款RESTRICT外键。原 amountFen/tenderedFen/changeFen/staffId/createdAt不变。

旧002的订单CHECK原本不允许PARTIAL或CANCELLED/PAID，因此010在保留全部旧合法状态组合的基础上，扩展PARTIAL及仅CANCELLED/PAID/SUCCEEDED组合。否则真实部分退款会由DB拒绝为500。未放宽PENDING_PAYMENT/UNPAID、原履约/PAID等规则。

新CashRefund SQL默认明确为 `now() AT TIME ZONE 'UTC'`，Prisma schema相同。直接SQL在Asia/Shanghai session的默认时间曾实际偏移28800秒，新增测试先观察RED；修正后UTC与Asia/Shanghai均为0秒。旧表默认/旧行不在本任务重算范围。

根先核对并停止自有源API3000进程PID29824后，分别明确授权两次Prisma generate：第一次新增模型，第二次同步新退款UTC默认；两个命令均退出0。实现者没有停止任何源进程，没有迁移development/public，没有重启源API。

测试入口 `cash-refunds-schema.cjs`：模块加载时拒绝production、development/public、缺省schema及非法名称；runner固定本项目本地数据库并核对项目数据库marker/目录/PG16。每个新schema严格匹配 `test_cash_refunds_*`。所有主/嵌套schema都仅在本轮CREATE成功、OID/owner相同后清理；CREATE碰撞不DROP已有对象。故障注入函数和触发器也记录创建成功及对象身份再清理。子测试解除继承的NODE_TEST_CONTEXT，避免HTTP测试被跳过。

最终逐次运行均完成自有schema清理；在最后编译HTTP运行结束后只读查询 `pg_namespace WHERE nspname LIKE 'test_cash_refunds_%'`，结果 **0**。无删除任何备份或恢复库，也未暂存两个遗留catalog reviewdiff。

## RED / GREEN 与执行记录

所有命令在 `D:/Codes/013MiniProgram` 执行，所有migrate均由安全runner显式设置随机测试schema。生成命令不连接或迁移源库。

| 命令 | 观察结果 |
| --- | --- |
| `node apps/api/tests/cash-refunds-runner.cjs`（首次，仅首个HTTP测试） | test_cash_refunds_748fdd90ba12；端点404，`404 !== 201`，0/1，正确RED |
| `node apps/api/tests/cash-refunds-runner.cjs --test-name-pattern '^HTTP'`（扩展测试，未实现） | test_cash_refunds_16e0544e7f6b；5项未通过，端点/视图缺失；统计测试也暴露尚无生成模型，未将其当作有效功能RED |
| `node apps/api/node_modules/prisma/build/index.js generate --schema apps/api/prisma/schema.prisma`（两次，均在root授权停API窗口） | Prisma6.19 client生成成功，exit0 |
| 专项实现首轮 | 新返款路径500，定位002 Order CHECK未接受新退款状态；010扩展后部分/全退通过；不修改错误信封掩盖DB失败 |
| `node apps/api/tests/cash-refunds-runner.cjs --test-name-pattern '^010'`（UTC默认修复前） | 直接SQL实测 `deltaSeconds=28800`，0/1 RED；根因是timestamp without timezone接受CURRENT_TIMESTAMP的当地时间 |
| `node apps/api/tests/cash-refunds-runner.cjs --test-name-pattern '^HTTP partial then full'`（更新旧提示前） | `/联系门店/` 与旧“真实退款尚未接入”提示不匹配，0/1 RED；改为实际返款指引后完整专项GREEN |
| `node apps/api/tests/cash-refunds-runner.cjs`（最终完整专项） | test_cash_refunds_504583f5821d；**10/10，0 fail，exit0** |
| `node apps/api/tests/cash-refunds-runner.cjs --regression` | test_cash_refunds_regression_950c6d1a8e33；原领域9项+原现金/权限/报价/库存/幂等/CMS真实HTTP1项，**10/10，exit0** |
| `node apps/api/tests/pickup-runner.cjs` | test_pickup_68948f4e1ec1；预约/SQL历史检索/日期/迁移/碰撞，**7/7，exit0** |
| `node apps/api/tests/payment-deadline-runner.cjs` | test_pickup_deadline_3ca7661eba5b；009 UTC期限、旧截止污染、并发过期/预约保留等，**8/8，exit0**；HTTP deltaMs=900000，两SQL时区deltaSeconds=900 |
| `node .superpowers/sdd/product-options-runner.cjs` | test_product_options_942f2163d645；原规格配置/库存下单/权限/迁移/碰撞，**10/10，exit0** |
| `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json` | 编译实际dist产物，exit0，无错误输出；generate已在root窗口完成，因此不调用会隐式generate的build脚本 |
| `$env:CASH_REFUNDS_TEST_BUILD='true'` 后 `node apps/api/tests/cash-refunds-runner.cjs --test-name-pattern '^HTTP'` | test_cash_refunds_8a154965c4bb；真实加载dist/src/main及对应provider，**6/6，0 fail，exit0** |
| `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit` | 最终exit0，无错误输出 |
| `git diff --check`、`git diff --cached --check` | exit0，无diff错误；仅仓库既有CRLF→LF提示 |

回归runner首轮错误继承 PUBLIC_BRAND_ID，使旧integration在新增第二品牌时期待503而得到200；这是夹具环境不符。只在 `--regression` 模式去除此变量，重新运行10/10，未改业务逻辑。现有预约/期限/规格runner因模块自带前缀guard，按root明确授权使用各自随机test_pickup_*/test_pickup_deadline_*/test_product_options_*隔离schema。

专项的一个预期500来自隔离DB审计触发器故障注入：响应仍有requestId与INTERNAL_ERROR，原收款累计、订单状态、返款、事件、审计全量回滚；移除本轮触发器后原key重试成功。日志仅输出受控错误类型/请求ID，该500不是遗留失败。

关键最终输出：

```text
cash refund HTTP status= 201
tests 10; pass 10; fail 0
010 old-column SHA256 unchanged: 1e64f91c42497a7a95e97bc741d754568830e55cac0c398452dde792e9ce1a8e
Direct SQL refund default UTC deltaSeconds= 0
010 old-column snapshot unchanged; refundedFen default=0; CHECK/UNIQUE/RESTRICT enforced
Remaining cash-refund schemas: 0
```

上述010哈希由本轮旧schema所有表的全部旧列逐行稳定序列化获得，前后精确相等；夹具有原商品/规格/加料库存、现金、报价、订单、事件、会话和品牌/门店/用户。不是对源库的迁移或重算；源库旧列比较仍由root在独立审查后完成。

## 自查与边界

- 部分→剩余全退：原实收3100、实付4100、找零1000；累计上限按3100，旧收款字段不变，原订单金额/菜品/创建时间等快照不变。
- 同key并发两次201但只有1返款/事件/审计；不同key抢最后余额状态精确为[201,409]，退款sum等于原amountFen。不同payment复用key成功。同key异金额/原因409，不新增记录。
- 未完成全退CANCELLED/PAID/SUCCEEDED且阻止全部履约/收款/核销；已完成全退仍COMPLETED，旧完成事件原样保留。部分退款不结束履约。
- 顾客、CLERK、跨店、跨品牌（含伪跨品牌membership）、撤权/降级/停用，及预检通过后事务前撤权均被拒绝；失败不写账本。其他顾客不能读取凭证。
- 未付款/已付款但非现金、超额、非法金额/原因/key/未知字段均拒绝，所有HTTP响应有requestId；详情和列表对顾客/店员/店主返回同一脱敏凭证集合，时间相同按id排序。
- 整库SKU/Modifier数组前后相等；预约slot及CONFIRMED reservation整行前后相等。退款未调用settleInventory/settlePickup，未回收产能。
- 隔离夹具昨日收款、今日返款；四个边界start−1ms/start/end−1ms/end只计中间两笔，当日收入0、退款500、净额−500；昨日收入不变。订单创建于三天前仍按各凭证发生日统计。
- 没有未解决的API正确性问题。源环境010待root独立审查后新备份、增量迁移、旧列比较与重启；UI展示/交互留给Task2；无AppID、微信支付、域名或服务器资源，验证范围仅本地真实DB/API与编译HTTP。
