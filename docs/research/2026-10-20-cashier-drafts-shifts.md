# 挂单、取单与交班调研

日期2026-10-20。现金退款Task1正在实施；本文是后续收银模块准备，不代表挂单、取单或交班已开发。搜索及实际阅读内容保存在.firecrawl，摘要哈希清单data/research/cashier-drafts-shifts-sources.json；只复用业务原则，没有复制上游代码或引入运行依赖。

## 阅读来源和适用范围

- [Frappe Books POS文档](https://docs.frappe.io/books/transactional-entries.md)已完整读取。原文区分“Submit unpaid”与“Hold”：前者提交未付款发票，后者留待稍后从Held恢复；另明确每笔销售属于班次。不能把本项目挂单做成已付款订单，也不能通过收款按钮保存草稿。其Expected=opening+payments-refunds，现金实点与差额分别记录，关闭需在线。文档中的自动write-off是上游会计处理，当前项目不能未经权限和原因确认就抹平差异。
- [Medusa Draft Order创建文档](https://docs.medusajs.com/user-guide/orders/draft-orders/create)完整读取，说明先创建草稿、后编辑商品/配送、准备好再转正式订单。其Region、Sales Channel与货币税项是通用电商场景，本项目当前单品牌餐饮门店不照搬额外多币种配置。采用草稿与正式订单分开、服务端计价的流程概念，不直接复用其前端或代码。
- [Medusa #5198](https://github.com/medusajs/medusa/issues/5198)完整读取，旧v1.16.1场景手动草稿预留后转单可能重复预留同一商品；页面标Closed/completed，但本次未追溯合并修复或运行上游，不推断当前版本有缺陷。用它制定本项目回归条件：挂单不预占库存；转正式订单只走现有唯一库存预占事务；重复转单不再扣一次。
- [Microsoft Dynamics 365固定提交文档](https://github.com/microsoftdocs/dynamics-365-unified-operations-public/blob/7dee2e089ec38e2e3fbb1a0bda9269f3d8890347/articles/commerce/shift-drawer-management.md)完整读取，索引标CC-BY-4.0。定义shift为时间两点间的POS交易集合，账面应有与实点分开；区分固定钱箱、流动钱箱、共享班次、挂起、结束和总部按日汇总。当前不一口气照搬全部权限/打印/钱箱设备；先确定每笔现金收退款明确归属班次，跨班历史不混入另一班账。
- Odoo #68879只读取了开发者索引片段，涉及多个POS班次余额串入后一个班次；没有完整读取或验证最新状态，只列为隔离回归线索，不作已证明的当前上游bug。POS Next README索引标AGPL-3.0，出现跨设备恢复草稿，仅为候选，未读取和复制其源码。

首轮通用“park/resume/concurrent”查询返回很多工作流而非POS项目，已排除为餐饮业务依据；后续收窄Medusa和ERPNext主题，不能把无关命中数当成有效调研量。

## 对当前项目的设计约束

1. REQ-079挂单为服务端持久化草稿，包含门店、经营者、商品选择与数量、模式、备注及必要服务上下文；页面当前估价可展示但不是付款凭证。挂单不改变库存、预约HELD、取餐序号、现金和财务统计。
2. REQ-080取单恢复原选择后以当前菜品状态、规格、价格、库存、预约时段与权限重新报价。原选择失效要逐项解释并保留可核对草稿，不能悄悄换默认规格、去掉必选项或改成即时取餐。
3. 草稿用revision条件更新，两个设备编辑冲突返回409并保留当前输入；读取最新不自动覆盖用户未保存内容。改门店不能把旧草稿当新门店购物袋；仅授权店员可访问，顾客和跨品牌不能读。
4. 草稿转正式订单与绑定orderId在同一事务且受唯一性/状态条件保护。两个报价、两个设备及丢回执都只能转换一次；使用原订单幂等键恢复。服务端报价要绑定草稿版本，草稿修改后旧报价不可转单。
5. 退款凭证发生在哪个班次就归哪个班次；跨日或跨班退旧销售，不能回写原销售班次账面。旧现金凭证在引入班次时保留为历史未归班，不能凭时间猜配给新班次。
6. 班次应有现金=期初+该班入账现金-该班退款+已确认现金加入-已确认现金支出。实收tendered已经含找零，不可再次用它算收入。已有流水只实现收/退款时，其他钱箱现金流必须明确不支持或单独记录，不能虚构自动核对。
7. 关闭班次保存原交易汇总、实点、差额、原因、操作者和时间；已关闭禁止新流水挂入，现金写入/关闭并发需同一事务边界裁定。读最新金额与关闭快照之间发生新交易应409重读，不使用过期画面强行结算。
8. 挂单与挂账分别建模：挂单没有形成收款或应收，挂账才是明确应收。REQ-089标记收款不能造现金流水；相应实收统计仍为0，后续真实结清须记录独立凭证。

当前范围仍保留所有90项；现金退款完成后依赖本调研另行细化挂取单及班次实施/真实验收计划。

## 后续班次模块的源码接入核对

挂单 Task1 实施期间重新阅读当前代码；本节只是后续设计输入，不表示已实现交班，也不改变 REQ-090 的 planned 状态。

- `apps/api/src/modules/orders/orders.service.ts` 的 `cash` 已在 `Db.atomic` 内重验员工和订单权限、检查原现金凭证、付款期限和实收金额，然后结算库存并创建一笔 `CashPayment`。班次归属应在首次新建凭证的同一事务里确定；原现金重放应返回原归属，不把旧凭证重新分配给当前班次。
- `apps/api/src/modules/finance/cash-refunds.service.ts` 先在写事务里重验 OWNER 权限，再检查 `(paymentId,idempotencyKey)` 和请求摘要，累计退款 CAS 与新退款凭证、订单事件及审计同事务提交。后续班次应绑定新的 `CashRefund` 发生时的班次，不能继承被退销售的旧班次。退款重放同样不能再追加钱箱支出。
- `apps/api/src/modules/finance/cash-summary.ts` 目前按收款/退款各自发生日统计门店金额，不能拿订单创建日或收款累计退款值反算当班现金。跨日退旧单需要保留每日原口径，另外按显式班次归属聚合。
- 当前 `CashPayment` 和 `CashRefund` 都没有班次外键，只有实际凭证金额、操作者及发生时间。迁移时既有凭证应显式保留“历史未归班”，不能依时间推测并回填到新班次；源库原时间、金额、操作者和快照继续逐列保留。
- 当前 `Db.atomic` 对事务级序列化冲突做有界重试。班次关闭与新现金写入要使用一致的行锁顺序与事务边界；若原生 SQL 错误被 Prisma 包装，需依据实际 SQLSTATE 复现后精确处理，不吞未知数据库错误。挂单模块的局部锁冲突处理仍待该模块独立审查，不能提前视作班次可直接复用的已验证实现。

后续实施须先写明一店一共享班次还是独立钱箱、开关班权限、无活动班次时能否收退款，以及关闭差异原因的规则，再按 API/界面/真实跨端核对分别实施。当前仅现金渠道真实可用；微信、会员及挂账没有凭证时应显示未开通或无流水，不能伪造交班渠道汇总。REQ-090 的“各渠道实收、退款、应收”完整验收仍依赖后续渠道与应收模块。

## 挂单接口通过后补充的检索证据

Firecrawl developer HTTP索引实际执行了宽泛和限定仓库查询，原结果保存为 `.firecrawl/prisma-raw-lock-sqlstate.json`、`prisma-raw-lock-focused.json`、`pos-cash-closing-followup.json`、`pos-closing-pr59514.json`，哈希清单见 `data/research/cashier-drafts-followup-sources.json`。这是索引片段阅读，不冒充完整源码审计：

- Prisma宽泛查询返回官方错误代码文档片段，`P2010`定义为“Raw query failed. Code: {code}”。限定 `prisma/prisma` 查询只得到 [#30580](https://github.com/prisma/prisma/issues/30580) 且passages为空；其标题谈adapter-pg提交冲突，与本项目6.19 query engine的原始行锁不是同一个已证明场景。没有用该issue为代码修复背书。当前本项目P2010/meta40001的根因及完整事务重试效果以挂单报告中的真实RED/GREEN、源码/编译HTTP和独立审查为依据。
- [ERPNext #23125](https://github.com/frappe/erpnext/issues/23125) 的历史片段用销售400、交500、找100说明交班应有现金为400而不是500；[#25638](https://github.com/frappe/erpnext/issues/25638)及关联修复[#25868](https://github.com/frappe/erpnext/pull/25868)片段也涉及找零。只用于构造测试，不宣称当前版本仍有该缺陷。
- [ERPNext #59514](https://github.com/frappe/erpnext/pull/59514) 的索引片段进一步描述多支付方式共用账户时，每个方式都减同一份找零，以及班中账户变动导致找零未扣的问题。片段所述修正按每张发票分配一次找零后再按支付方式汇总，且明确这些值仅填expected列、不产生GL过账；索引还出现backport[#60297](https://github.com/frappe/erpnext/pull/60297)。未核实完整PR及合并状态，不能把标题、机器人评分或backport片段当成已验证发布。
- 对本项目的回归输入是：当前CashPayment.amountFen本来就是净入账销售额，不能再减一次changeFen；tenderedFen才包含顾客交付现金与找零部分。若未来支持混合支付，需要每个凭证明确渠道及找零归属，同一找零只计一次；不能用一个支付账户的找零减所有渠道，也不能将expected汇总当成新增资金流水。

工具限制也如实记录：全局firecrawl命令不在PATH，默认npx缓存的zod文件损坏；使用本项目忽略的独立runtime缓存启动CLI1.26.15成功，未改项目依赖或全局工具。随后两项完整PR scrape均因keyless免费额度限制退出1，因此停止抓取，没有登录、没有索要密钥、没有声称读过未取得的正文。现有 `.firecrawl/erpnext-pos-closing.md` 实际重定向到Stock Closing Entry，仍排除为POS现金交班依据。
