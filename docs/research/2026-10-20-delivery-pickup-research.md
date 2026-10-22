# 商家配送与预约自提调研

日期：2026-10-20。对应 REQ-006/007/008/037/038。商品规格模块已通过本地交易验收；预约API已审查并增量迁移，三端界面及完整验收仍在推进。本文是设计依据，不代表配送或完整预约已验收。

## 本轮实际读取的依据

通过 Firecrawl developer 免登录索引搜索配送范围、运费计算与预约容量，再用 scrape 读取下列三个固定提交的完整文件。原始抓取在本机忽略目录 `.firecrawl/`，持久化的来源、摘录和本机内容哈希见 `data/research/delivery-sources.json`。这里只参考概念和明确的业务规则，没有引入新依赖或复制上游业务实现。

1. [Medusa shipping-option 文档](https://github.com/medusajs/medusa/blob/61c19c3099d58b3b3900da70d92a647c33b09bb5/www/apps/resources/app/commerce-modules/fulfillment/shipping-option/page.mdx)：分别描述 `flat`、`calculated` 价格、service zone 和条件规则。原文指出 calculated price 可以依赖购物车、地址或供应商报价；购物车更新会重新计算。也明确说明其完成购物车时不再重算，而使用已存价格。本项目继续采用自己的报价有效期及下单复核规则，不能把这项上游行为直接当作安全保证。索引许可标记 NOASSERTION，不能据此认定代码许可。
2. [Microsoft Dynamics 365 Commerce 自提时段文档](https://github.com/microsoftdocs/dynamics-365-unified-operations-public/blob/7dee2e089ec38e2e3fbb1a0bda9269f3d8890347/articles/commerce/dev-itpro/pickup-timeslots.md)：描述最早/最晚预约日期、有效日期、星期、营业时间、时间间隔和每时段容量；原文要求使用门店时区，并说明修改时段日期不影响已下订单。索引标记 CC-BY-4.0；这里只引用规则，未复制图片或实现。
3. [yshop-drink 地址服务](https://github.com/guchengwuyue/yshop-drink/blob/42f416022f5d7b51b7a581976638b1895e20407d/yshop-drink-boot3/yshop-module-member/yshop-module-member-biz/src/main/java/co/yixiang/yshop/module/member/service/useraddress/AppUserAddressServiceImpl.java)：地址包括联系人、电话、地址正文、门牌、经纬度、默认标记，列表按 uid 查询。当前读到的 `addAndEdit` 和 `setDefault` 最后使用 `updateById`，该文件内没有同时按 uid 限定被改地址；也未见这些方法上的事务声明。这里只能说此文件未证明归属校验和默认切换原子性，不能据此断言整个项目可被越权。项目已有 MIT 许可证据，但这些写法不能直接照搬。

补充索引命中 [DoorDash cart validation](https://developer.doordash.com/en-US/docs/marketplace/how_to/order_cart_validation)，区分 `CAPACITY_THROTTLING`、`STALE_PICKUP_TIME`、`INVALID_ADDRESS`、`NO_SLOTS_AVAILABLE` 和 `REQUESTED_SLOT_UNAVAILABLE`。本轮未完整抓取此页，不将索引摘录当成完整合同。索引还发现其校验超时可能被绕过；本项目的门店容量限制必须在自己的订单事务内落实，不依赖第三方预校验。

本轮另外完整读取了 [uni-app 定位文档](https://uniapp.dcloud.io/api/location/location.html) 和 [微信 getLocation 文档](https://developers.weixin.qq.com/miniprogram/en/dev/api/location/wx.getLocation.html)。两者均区分默认 WGS84 与地图使用的 GCJ-02；uni-app 明确 App/H5 的 GCJ-02 需要定位 SDK 配置，不能假定当前 H5 自带可用地图服务。微信文档要求用户授权 `scope.userLocation`，工具模拟定位也不能替代真机地理位置验收。

几何实现候选实际核查了 Turf 的 [booleanPointInPolygon](https://turfjs.org/docs/api/booleanPointInPolygon) 与 [kinks](https://turfjs.org/docs/api/kinks) 文档：前者支持凹多边形及 `ignoreBoundary`，后者返回自交点，可分别承担范围包含与自交检查。首选按需评估这些独立模块，避免从零手写几何算法；尚未安装，包版本、实际许可、间接依赖和 Node24 运行仍需在引入时核验。API 文档可读不等于依赖已经通过验证。

## 并发与版本核查补充

本轮进一步实际读取 [PostgreSQL16 序列化失败处理](https://www.postgresql.org/docs/16/mvcc-serialization-failure-handling.html)：`40001`需重试完整事务，包括决定语句和参数的全部逻辑；唯一冲突不一定是暂态，不能无条件无限重试。现有`Db.atomic`以Serializable包住完整回调、最多5次；预约计数和序号必须放入该回调，回调内不能发送不可撤销的外部通知。

实际读取 [PostgreSQL16 range约束](https://www.postgresql.org/docs/16/rangetypes.html#RANGETYPES-CONSTRAINT)，文档说明排除约束可限制同资源时间重叠，标量门店ID组合需`btree_gist`。这解决时间区间重叠，不直接解决每时段多笔订单的聚合容量。本模块继续用既有Serializable事务和计数CAS，不因示例引入未经本机验证的新扩展；相邻时段采用起点含、终点不含的区间，不算重叠，须以真实并发测试证明。

版本陷阱：本轮抓取的[无版本Prisma事务网址](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)实际已经指向Prisma8文档，描述`db.transaction`及新错误合同，不能拿来修改项目锁定的6.19实现。另行读取[Prisma6.19.0交互事务测试](https://github.com/prisma/prisma/blob/6.19.0/packages/client/tests/functional/interactive-transactions/tests.ts)，确实包含`Prisma.TransactionIsolationLevel.Serializable`与`$transaction`选项；此文件不含P2034断言，不将其说成错误码的独立证明。项目现有已执行隔离数据库测试是本机6.19运行依据，不升级依赖。该上游测试仅参考接口，没有复制代码；既有Apache2许可证据保留。

## 当前实现的真实边界

当前 `orders.service.ts` 对 DELIVERY 明确返回 503；虽然已有遗留地址及固定配送费代码，但不可据此认定配送可用。尚无地址簿、坐标、营业时段、区域或配送任务表。后续预约API实现 `d0d4815` 已增加PickupPolicy/Slot/Reservation/Sequence及不可变订单窗口，已通过隔离数据库测试和独立审查，第8次迁移保留旧39表339行；顾客及经营预约界面仍需真实操作验收。`Order.address` 和 `Order.lines` 继续为 JSON 快照，订单状态与现金/库存已有真实事务链路。预约阶段记录见[实际记录](../acceptance/2026-10-20-pickup-capacity.md)。

## 需要带入后续设计的约束

- 地址正文不能证明可配送。后端验证地址归属、经纬度范围和统一坐标系，并重新计算区域、起送额、时段和费用。应同时记录坐标来源；未配置地图服务时不能声称完成了地图检索、逆地理编码或真实路线距离验证。微信定位、国内地图与服务端几何计算不能混用 GCJ-02、WGS84 坐标。
- 半径表示直线服务边界，不伪装成骑手行驶距离；多边形按边界包含规则计算。拒绝自交、退化、重复顶点和非法坐标；跨日期变更线等不在门店服务范围的几何输入应明确限制。阶梯边界采用整数米和整数分，顺序及重叠规则必须唯一，不能因前端浮点差异出现不同费用。
- 经营规则有版本，报价保存地址、命中区域、计费规则和费用快照；创建订单重新检查当前版本与可用性。配置变更后旧报价明确要求重算，已成立订单继续按原承诺履约。编辑地址不改变历史订单联系人、地址或配送费。
- 地址的读写和设默认均在事务内检查当前用户及品牌归属；禁止只以客户端 addressId 更新。默认地址切换需要数据库约束或受锁保护的事务，避免并发出现两个默认地址。删除地址不删除订单快照。
- 预约容量按门店、模式及真实时间区间管理，明确固定 Asia/Shanghai 的首版支持范围；输入转换为 UTC 保存。预约窗口、提前量、闭店和跨午夜拆段需统一处理，不靠客户端时钟决定可下单。
- 报价只显示当前余量，不占用容量；创建订单与库存预占同事务锁定时段额度。重复提交不重复占用；未付款取消/到期恰好释放一次。已完成订单仍计入该时段的接单容量，防止完成后重复出售过去产能。已付款拒单与退款应使用相应业务链路，不能无记录释放资金或库存。
- 调小容量不得低于已经承诺的数量；取消或关闭模板不修改已预约订单的时间快照。并发争抢最后一个名额必须只有一笔成功，另一笔返回可识别的容量冲突并给用户重选入口。
- 即时自取号是叫号标识，不能作为读取任意用户订单的凭证；按门店和营业日原子分配。领取核销应在已付款、已出餐状态下由本店有权员工执行，幂等且留审计。
- 自配送任务与订单状态分开建模：待分配、待取餐、配送中、已送达、失败及重派记录。配送员必须有本店有效授权；配送中不能直接切回待取餐以掩盖失败。送达只产生一次有效完成事件；顾客订单页重新查询应可看到同一事实。
- 已支付订单履约失败不自动伪造退款成功；外部退款未就绪时给出真实处理状态。微信订阅消息未配置时，站内订单进度可用，但不得把站内更新标记成微信消息已送达。

## 后续真实验收场景

1. 商户电脑配置范围、费用和时段；商户 H5 重读；顾客选本人地址报价；边界内/外、缺坐标、停用区域、起送差一分、阶梯边界各有明确结果。
2. 已报价后修改地址或门店规则，下单拒绝过期承诺；已经创建的订单仍显示原地址及费用。跨用户地址 ID 和跨门店任务读写被后端拒绝。
3. 两个顾客抢最后一个预约名额，只一笔创建成功；取消/到期后容量仅释放一次；重复请求返回原订单；刷新三端并查询 SQL 核对。
4. 实际现金付款、备餐、出餐、自取核销，或分配员工自配送、配送失败、重派与送达；顾客端与 SQL 的状态及时间记录一致。
5. 断网及未知写入结果不自动重发，恢复后重新读取；未配置地图、微信通知或第三方配送时明确保留相应验收缺口。

以上仍需独立实施计划、接口/迁移审查及实际页面与 SQL 验收，不能仅凭调研把需求状态改为已实现。
