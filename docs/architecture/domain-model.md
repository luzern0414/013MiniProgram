# 领域模型、数据约束与事务边界

状态：完整目标领域设计；R1子集已迁移，实际模型以 `apps/api/prisma/schema.prisma` 为准，下表不表示全部已实现。配套 [主设计](../superpowers/specs/2026-10-20-restaurant-design.md)。

## 数据表职责

全部业务写入由 API 执行。ID 使用不易枚举的 UUID；可读单号单独生成、建立唯一索引；金额用 BIGINT 整数分并限制可序列化范围，API 输出安全整数；时间为 timestamptz/UTC。所有客户数据表保留 brand_id；门店经营数据同时保留 store_id。组合外键或事务检查确保门店属于品牌，不能仅靠代码约定。

| 领域 | 表 | 核心约束与职责 |
| --- | --- | --- |
| 品牌/门店 | brands, stores, store_hours, store_service_modes, store_groups, store_group_memberships, regions, store_tags, store_tag_assignments | 门店归属单一品牌；时段有效；门店可暂停；组/标签关系按品牌校验 |
| 身份 | users, auth_identities, sessions, privacy_consents | (provider, app_id, open_id) 唯一；union_id 缺失时不自动合并；session token 哈希落库，可撤销 |
| 员工权限 | staff, roles, permissions, role_permissions, staff_brand_roles, staff_store_roles | 品牌角色与门店角色独立；禁止跨品牌绑定；禁用员工立即拒绝访问 |
| 会员 | members, member_levels, member_level_events, member_tags, member_tag_assignments, memberships, membership_purchases | (brand_id,user_id) 唯一；历史等级权益存快照；付费权益受已确认支付单驱动 |
| 账户/余额 | wallet_accounts, wallet_holds, wallet_entries, recharge_orders, receivables, receivable_settlements | 余额账户按品牌与会员唯一；entry(source_type,source_id,event_type) 唯一；借贷/余额版本不可任意改写；本金和赠额分账；挂账与实收分开 |
| 积分 | point_accounts, point_entries, daily_checkins, reward_redemptions | 同会员本地日期仅一次签到；积分事件唯一；积分兑换与库存同事务 |
| 商品 | categories, units, products, product_media, product_options, option_values, skus, sku_option_values, modifier_groups, modifiers | 分类/单位属品牌；SKU 组合去重；属性和加料分别配置必选/多选；引用过的记录归档而非破坏历史 |
| 门店销售 | store_products, store_skus, store_modifier_stock, inventory_reservations, inventory_entries | (store_id,sku_id) 唯一；价格覆盖独立；available/reserved/sold 为非负；预占行与订单行关联，释放只能执行一次 |
| 购物车/报价 | carts, cart_lines, quotes, quote_lines, quote_discounts | 购物车按用户+门店+履约模式隔离；组合指纹含 SKU、属性、加料；报价有有效期与规则版本 |
| 订单 | orders, order_lines, order_line_modifiers, order_discounts, order_status_events, order_addresses | 服务类型校验；订单状态只能合法转换；金额和行快照不可被商品编辑更改；版本字段支持条件更新 |
| 支付/退款 | payment_orders, payment_transactions, payment_callback_events, refunds, refund_line_allocations, refund_callback_events | (provider,mchid,out_trade_no) 唯一；provider transaction id 唯一；回调 event id 唯一；退款业务号唯一；累计已退+处理中不超原实收 |
| 优惠券 | coupon_templates, coupon_store_scopes, coupon_product_scopes, coupon_batches, member_coupons, coupon_reservations, coupon_events, coupon_pack_orders | 批次预算有限；每人限领靠原子计数/锁，不靠查询后插入；单券仅一个活跃预占；有效期和状态校验；套餐权益支付后幂等发放 |
| 营销 | promotions, promotion_rules, promotion_scopes, reward_grants, birthday_claims, new_customer_claims | 活动规则版本化；优惠互斥组明确；相同订单/活动/权益唯一；品牌新客资格并发保护 |
| 桌台 | dining_areas, dining_tables, table_codes, table_sessions, table_session_members, table_session_order_links | 桌码不是访问所有桌单的通行证；同桌唯一活跃会话；服务端加入会话；桌码可撤销轮换；多人加菜用版本控制 |
| 收银 | cashier_sessions, pos_drafts, pos_draft_lines, price_adjustments, cash_receipts, shift_reports | 草稿持久化及 version；班次不可跨门店；改价抹零有额度/原因；现金记录 tendered、change、net；挂账写应收，不计入现金 |
| 预约 | reservation_policies, reservation_slots, reservations, reservation_events | 时段+桌型占用容量非负；预占与确认有到期规则；押金绑定支付单及独立退款 |
| 排队 | queue_types, queue_daily_counters, queue_tickets, queue_events | 取号按门店营业日+桌型唯一递增；会员/匿名会话至多一个活跃号；过号及重新排队策略可追踪 |
| 配送 | delivery_policies, delivery_zones, delivery_quotes, delivery_jobs, delivery_events, delivery_callback_events | 供应商订单号唯一；创建/取消幂等；回调按事件去重；乱序不回退已完成状态；地址快照受限访问 |
| 打印/通知 | devices, print_routes, print_jobs, print_attempts, notification_jobs, notification_attempts, subscription_grants | 请求接受与打印完成区分；补打记录原单；消息仅依据有效订阅授权；设备归门店 |
| 页面/内容 | assets, cms_pages, cms_page_versions, cms_publications, articles, theme_versions | JSON Schema 校验；版本不可变；发布指向已验证版本；URL/图片域名白名单；门店可覆盖品牌模板 |
| 卡券/寄存 | voucher_batches, voucher_codes, voucher_redemptions, storage_accounts, storage_entries | 兑换码高熵且哈希保存；单次核销；寄存流水不直接覆盖数量；过期和跨店策略明确 |
| 财务 | ledger_accounts, ledger_transactions, ledger_postings, reconciliation_runs, reconciliation_items, settlement_rules, settlement_statements | 借贷相等；账务事件唯一；冲正替代修改；交易账单与本地支付/退款双向匹配；抽成是内部应付/应收，不等于外部转账 |
| 基础设施 | idempotency_records, outbox_events, job_attempts, audit_events | 幂等键绑定身份+路由+body hash；outbox 与业务事务同提交；claim lease 支持恢复；审计敏感字段脱敏 |

## 关键索引

- orders(brand_id,store_id,status,created_at DESC,id)、orders(user_id,created_at DESC,id)。
- store_skus(store_id,sku_id) 唯一；查询门店可售商品覆盖 store_id、category_id、is_available。
- inventory_reservations(order_id,order_line_id,sku_id) 唯一；(status,expires_at) 用于释放任务。
- member_coupons(member_id,status,expires_at)，coupon_reservations(coupon_id) 针对活跃预占唯一约束。
- payment_transactions(provider,provider_transaction_id) 唯一；refunds(payment_order_id,status) 支持总额检查。
- outbox_events(status,available_at,id)，任务 claim 使用 FOR UPDATE SKIP LOCKED 和有期限 lease。
- queue_tickets(store_id,business_date,queue_type_id,number) 唯一；活跃票的 member/guest subject 部分唯一索引。
- wallet_entries(account_id,created_at,id)，point_entries(account_id,created_at,id)，source event 唯一。
- 关键关联以复合唯一键 (brand_id,id)/(brand_id,store_id,id) 建模，避免引用到其他品牌的实体。

## 创建订单事务

1. 检查用户、品牌、门店营业/服务模式与幂等键。幂等记录绑定身份、路由、请求体哈希。
2. 报价未过期，且 menu/pricing/coupon 版本有效；读服务端 SKU 与费用。
3. 按固定的 SKU/加料 ID 顺序条件更新：只有 available >= requested 才可 available -= requested、reserved += requested。不同订单共享门店库存，不能用全局互斥锁阻塞所有门店。
4. 原子预占优惠券；写订单快照、预占记录、事件与 outbox。
5. 提交事务后调用外部支付；支付下单失败可重试原支付业务号，不撤销已成功创建的订单事实。订单仍可再次支付或主动取消。
6. API 响应丢失后客户端带相同 key 查询/恢复，不创建第二张订单。

这借鉴 litemall 的条件减库存，而扩展为本项目的门店可售/预占模型。Redis 不是库存权威；库存更新回滚由数据库保证。

## 支付入账事务

回调先验签和解密，在事务内按 provider event 唯一键写入受限事件元信息。锁支付单与订单，校验 appid、mchid、币种、订单总额、业务单号。用户实付和平台优惠作为独立字段保存。更新支付状态、写交易账本和 outbox。已取消单到账转异常已支付处理并请求退款，不把真实到账忽略。

支付下单和回调均在服务端；前端传入 paid=true 无效。现金收银只能由授权收银员执行，独立记录现金单，不能伪造微信交易号。

## 退款与余额

退款申请事务锁定 payment_order，计算可退余额并预留本次申请金额，生成固定 out_refund_no。外部请求不放在长数据库事务里，超时先查原退款号。只有实际退款成功事件才能写已退账务、撤销应退权益。库存是否回补依据制作状态和门店处理原因。

品牌钱包由不可变分录和汇总余额组成；账户加锁、余额校验、订单支付记账在同事务。充值本金、赠额、退款和跨店归属分别记录。收银员只知道会员手机号不足以扣款，必须会员确认/受限一次性支付码等二次凭据。未启用储值时没有可用余额支付入口。

## 业务日、统计与对账

存储 paid_at/refunded_at 为真实事件时间；营业日根据门店时区和营业日截点映射，避免夜店跨午夜错报。

至少区分下单金额、已付订单金额、实际收款、已退款、净收款、应收挂账、储值充值、储值消费。充值不重复计作餐饮销售；会员余额消费不当作新的第三方现金流；退款按实际到账日计现金流，经营分析另外支持回溯订单日。

总部看全品牌，店长看门店，收银员看自己的授权班次。图表点击可跳到底层交易/订单明细，金额能复算。对账差异产生待处理项，禁止静默修改真实金额使账单“看起来一致”。

## 数据生命周期

业务引用记录用停用或归档；订单快照和账本采用明确保留策略，客户删除请求通过去标识化与依法保留记录区分处理。地址、手机号、生日、支付原始报文只给必要角色。日志不可输出私钥、令牌、完整密码、完整地址与敏感支付报文。备份和生产数据不进入 Git。

