# 餐饮小程序业务与开源调研

日期：2026-10-20；范围：用户确认的同一品牌多门店。结论依据公开文档、GitHub 仓库元数据、许可证原文及选定源码；没有将 README 的宣传描述当作运行验收。

## 调研结果和证据范围

本次保存 **136 个来源记录，129 个 HTTP 200，7 个失败记录**。记录包括 26 个仓库、5 次 GitHub 搜索、20 份许可证请求、20 份 README、12 份业务源码、5 份提交版本、5 份代码目录、3 份构建配置，以及微信/支付/数据库/框架/行业文档。每个记录包含 URL、时间、HTTP 状态和 SHA256（成功抓取时），详见 [source-manifest.json](../../data/research/source-manifest.json)。

**这不是 129 个全部深度审计的独立项目。** 多个记录来自同一仓库或网站；仅选定文件做源码分析，未克隆运行所有候选。仓库 stars、pushed_at 是抓取时快照，不保证代码质量或维护承诺；pushed_at 也不等于默认分支最新提交日期。raw 抓取结果在 data/research/raw/ 本地缓存并被 Git 忽略。

Firecrawl CLI 未认证且免费额度受限，未获得搜索内容，已停止重复调用；后续使用公开 GitHub Search API、raw.githubusercontent.com 和官方网页。一次通用中文网页搜索返回不相关结果，已排除，没有用无关网页支持结论。

部分网站返回 HTTP200 但只有动态空壳：美团餐饮、达达/京东秒送、顺丰开放平台、飞鹅部分页面仅确认平台入口存在，不能声称已经拿到完整接口协议。微信旧小程序码 URL 重定向到接口目录，不能据此断言具体参数限制。微信运营规范旧地址404后改为官方产品页并读到了规范正文。有赞餐饮旧页404后抓取官网，但没有据此声称当前具备某项特定餐饮能力。

## 需求理解

截图需求不是单纯外卖列表，而是品牌门店经营链路：点餐与支付、前厅/厨房协作、会员权益、营销、配送、预约排队、收银和总部管理。用户要求微信为主要渠道；截图的支付宝/抖音渠道仍在台账中作为独立后续适配。

“自提”和“自取”截图分别出现，建议共用 PICKUP 履约，细分预约时段与即时叫号，避免开发两套重复订单。“智慧桌码”是入口上下文与桌台会话，不是仅生成二维码图片。“收银”须同时记录资金事实、付款渠道、班次、挂账与价格调整，不等于一个支付按钮。“页面装修”须有草稿和发布版本，不是把业务数据写在前端常量。

## 开源方案比较

| 项目 | 读取时 stars / 活跃信息 | 已核查许可 | 适合复用的能力 | 采用方式与边界 |
| --- | --- | --- | --- | --- |
| [yshop-drink](https://github.com/guchengwuyue/yshop-drink) | 1,604；默认分支研究提交42f4160，2026-10-15 | LICENSE 原文 MIT | 多门店、SKU、点餐/自取、优惠、收银领域拆分 | 深入读订单、券、门店服务；作为业务参考及方案B候选，A中不直接搬整个Java后台 |
| [bee](https://github.com/woniudiancang/bee) | 4,574；研究提交edb27ed | GitHub API NOASSERTION，但 LICENSE 原文是 MulanPSL-2.0 | 小程序点餐、桌码、订单入口和叫号流程 | 原生小程序交互参考；README依赖api工厂和apifm-wxapi，不能误认为所有后台已自带 |
| [bee-api](https://github.com/cocktail18/bee-api) | 132；研究提交e75d297，2026-03-12 | Apache-2.0 原文 | Go后端订单、券、支付通知和打印适配器 | 分析事务与通知流程；不在TS后台混入另一套Go服务 |
| [litemall](https://github.com/linlinjava/litemall) | 20,391；默认分支研究提交a1ef964，2025-10-05 | MIT 原文 | 订单快照、库存条件更新、后台权限/订单组织 | 复用成熟模式，扩展本项目门店维度、幂等和支付v3；不沿用旧UI和支付示例 |
| [CRMEB](https://github.com/crmeb/CRMEB) | 9,426；pushed_at 2026-09-05 | Apache-2.0 原文 | 会员、券、积分和商城管理的信息结构 | 参考业务设计，不把其他收费版本能力当作该仓库现成功能 |
| [likeshop](https://github.com/likeadmin-likeshop/likeshop) | 1,588；2026-09-24 | Apache-2.0 原文 | 会员、商城后台和配置组织 | 参考PHP项目业务边界，不同时引入两种后台栈 |
| [mall](https://github.com/macrozheng/mall) | 84,932；2026-09-15 | Apache-2.0 原文 | 电商订单、营销、权限与库存思路 | 零售电商不等于餐饮，桌台/取餐/制作仍需餐饮模型 |
| [fuint](https://github.com/fushengqian/fuint) | 1,793；2026-10-20 | AGPL-3.0 | 储值、积分、卡券、门店会员业务 | 产品流程参考；不未经评估直接引入到预期闭源系统 |
| [fuintCatering](https://github.com/fushengqian/fuintCatering) | 430；2026-10-20 | API无识别许可；根LICENSE404；README声明商用购买授权/学习交流 | KDS、餐饮卡券、收银产品范围 | 不复制其源码；完整商业权限未核实 |
| [orderFood-wxCloud](https://github.com/yangxiaohan168/orderFood-wxCloud) | 340；2026-07-28 | API无license；根LICENSE404 | 小程序云开发、桌码/打印界面范围 | 没有清晰许可不复制代码；“免费开源”文案不等于确定许可 |
| [URY](https://github.com/ury-erp/ury) | 391；2026-10-19 | AGPL-3.0 原文 | 餐饮前厅厨房、桌台、ERP业务思路 | 作为业务参照，不引入ERPNext全栈作为当前项目基础 |
| [yipin](https://github.com/WHaveFun/yipin) | 152；2020-12-30 | Apache-2.0 | 早期uni-app门店模板 | 版本较旧，不直接作为当前构建基线 |

保留对旧仓库/迁移仓库的真实 canonical 路径：prisma/prisma 已返回 prisma/orm，unibest-tech/unibest 返回 feige996/unibest。不能把移动过的项目当成多个独立候选。

## 实际源码分析与本项目采用规则

### 1. 库存条件更新

litemall 的 [GoodsProductMapper.xml](https://github.com/linlinjava/litemall/blob/a1ef964a718b7277925b19ea26afe78ea3a1d325/litemall-db/src/main/resources/org/linlinjava/litemall/db/dao/GoodsProductMapper.xml#L9) 使用更新条件 number >= num，再执行 number -= num；订单服务 [WxOrderService.java](https://github.com/linlinjava/litemall/blob/a1ef964a718b7277925b19ea26afe78ea3a1d325/litemall-wx-api/src/main/java/org/linlinjava/litemall/wx/service/WxOrderService.java#L425) 检查影响行数。

本项目采用数据库条件更新+事务，并增加 store_id、库存预占/释放流水、幂等事件及固定锁顺序。它直接防止“先读库存足够，再并发扣成负数”。这属于成熟技术模式的适配，不能声称已复制整个库存系统或完成其测试。

### 2. 全局锁与失败路径

yshop [AppStoreOrderServiceImpl.java](https://github.com/guchengwuyue/yshop-drink/blob/42f416022f5d7b51b7a581976638b1895e20407d/yshop-drink-boot3/yshop-module-mall/yshop-module-order-biz/src/main/java/co/yixiang/yshop/module/order/service/storeorder/AppStoreOrderServiceImpl.java#L186) 在所读版本里使用固定LOCK_KEY并在 tryLock() 分支里检查库存和计算金额；未获得锁的分支在该段没有抛出失败。仅此局部阅读不足以判定全项目实际漏洞，但说明不能未经验证直接复用。

本项目使用门店SKU级数据库原子性，锁失败/竞争失败显式返回可理解错误，不继续用零金额/未校验结果创建订单。避免所有门店竞争一把全局锁。

### 3. 优惠券的所有权与状态

同文件213–224行按传入券ID读取并检查门槛、修改状态；从该局部不能证明完整的持有人、门店范围、过期、预算和并发检查。

本项目把券检查集中在服务端，核对会员、品牌、门店/商品范围、有效期、状态、发券预算和互斥规则；报价不消耗券，订单事务预占，取消只释放一次。不能仅因看见@Transactional就推断所有优惠逻辑正确。

### 4. 支付验签与金额语义

bee-api [pay.go](https://github.com/cocktail18/bee-api/blob/e75d2973eb2ad551c8e03bee101a8a9ef625de42/bee-api/service/pay.go#L49) 展示回调验签、公钥选择、APIv3解密和重复支付状态检查。108行起的局部把payer_total用于与本地金额比较，需要结合营销优惠和支付语义审查，不能直接沿用为全部金额校验。

本项目核验订单 total、币种、appid、mchid、业务订单号，并单独记录用户实付及平台优惠。支付通知幂等必须由数据库唯一约束和状态条件更新共同保证。

### 5. 前端与远端后台耦合

bee 的订单页引入apifm-wxapi，README要求在api工厂创建后台账号。复用前端页面不自动获得可自托管后台；直接替换域名也不能证明字段与业务规则兼容。本项目使用自己的已定义API合约。

## 微信官方约束和落地决定

| 官方依据 | 查证内容 | 设计决定 |
| --- | --- | --- |
| [小程序登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html) | wx.login临时code交服务器换OpenID/可选UnionID/session_key；code只能用一次，session_key不可下发 | 双应用分别校验身份，服务端建立短期会话，不把用户传入角色当权限 |
| [wx.requestPayment](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html) | 前端调起支付参数由服务端签名；API v3使用RSA | 前端成功回调仅触发后端查询，不直接标订单已付 |
| [小程序下单](https://pay.weixin.qq.com/doc/v3/merchant/4012791896) / [接入准备](https://pay.weixin.qq.com/doc/v3/merchant/4015459512) | AppID、商户号、支付能力、订单与签名等实际条件 | 配置不足明确不可用；不得编造商户号或体验支付成功 |
| [支付成功通知](https://pay.weixin.qq.com/doc/v3/merchant/4012791861) | 需验签；文档要求5秒内应答；通知可重复，不能只靠回调，应结合查单 | 持久化事件后快速应答，事务outbox异步处理打印/权益；回调去重与主动对账 |
| [退款申请](https://pay.weixin.qq.com/doc/v3/merchant/4012791862) | 同退款号重试只退一笔；受理成功不代表最终到账；部分退款次数和节流有条件 | 退款状态独立，固定业务退款号、查单/回调确认，限制并发可退总额 |
| [隐私开发指引](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html) | 收集的隐私类型需在后台声明，相关隐私接口按授权流程 | 菜单浏览无需强制手机号/定位；配送等必要场景再请求相应信息 |
| [订阅消息](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/subscribe-message.html) | 用户选择授权，消息模板/语音提醒有类目与条件限制 | 不承诺所有商家都能持续免费播报；云喇叭和订阅消息是独立能力 |
| [运营规范](https://developers.weixin.qq.com/miniprogram/product/) 5.1/5.12/5.16/5.17 | 规范限制强制/暗示/利益诱导分享、隐私滥用、过度营销和红包类行为 | 分享券不得强迫分享才能点餐；原截图“瓜分红包”需重新设计和复核 |
| [Page onAddToFavorites](https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html) | 可观察收藏触发事件，但仅此不证明服务端存在可信的长期收藏状态 | 收藏奖励不默认判定真实完成，不以伪造toast骗过验收 |

“无痕广告”原截图解释为口令自动截流，含义不清。方案仅预留透明渠道归因和明确活动，不实施隐蔽截流或绕审核。此项保留在台账等待业务含义与平台能力确认。

## 框架与组件复用

- uni-app：[官方文档](https://uniapp.dcloud.net.cn/)、Apache-2.0，采用Vue3版本；所有@dcloudio包锁同一编译器版。
- [Wot Design Uni](https://github.com/Moonofweisheng/wot-design-uni)：MIT；已读README、LICENSE、package.json，适配组件可复用。读取时1.14.0，构建兼容性需实际验证。
- [Element Plus](https://github.com/element-plus/element-plus)：MIT；电脑端表单、表格、弹窗等，主题按品牌调整。
- [NestJS](https://github.com/nestjs/nest)：MIT；模块、守卫、异常管理。README根路径404不影响license核实，技术指南已实际抓取。
- [Prisma](https://github.com/prisma/orm)：Apache-2.0；Schema和版本化迁移，事务控制配合PostgreSQL；不以ORM取代数据库约束。
- [unibest](https://github.com/feige996/unibest)：MIT；作为工程结构/路由/transport组织参考，不整包引入其非必要依赖。
- [微信官方示例](https://github.com/wechat-miniprogram/miniprogram-demo)：MIT；API能力验证参考。
- [wechatpay-java](https://github.com/wechatpay-apiv3/wechatpay-java)：Apache-2.0，官方SDK可作为服务端签名/回调实现的权威参考；当前TS后台不因此引入JVM。
- [PostgreSQL显式锁](https://www.postgresql.org/docs/current/explicit-locking.html) 和 [Prisma事务](https://www.prisma.io/docs/orm/prisma-client/queries/transactions) 支持本项目状态机和并发设计。
- [Redis分布式锁](https://redis.io/docs/latest/develop/use/patterns/distributed-locks/) 只作为辅助，不承担唯一资金/库存正确性保障。

以上“计划使用”与“已安装复用”应在实际lockfile和NOTICE中分别记录。当前已实际安装开发数据库运行组件embedded-postgres（MIT wrapper，PostgreSQL16.14原生二进制）、pg、TypeScript、tsx、Vitest；API依赖按实际lockfile记录。许可证清单随安装更新，不宣称依赖安全审计已经全部完成。

## 第三方能力的实际条件

配送不能根据截图逐个展示“已接入”。达达当前公开入口为京东秒送开放平台；名称、合同和服务城市可能变化。点我达、蜂鸟、顺丰同城、闪送、UU、曹操送须分别核实当前可签约产品、接口、回调验签、配送范围、计费和取消规则。

打印要区分“API受理”“设备在线”“真实打印完成”；重试可能重复出纸，需供应商幂等ID或先查询原任务再补发。语音播报不等同于手机后台必然能播声音。厂商网页为空壳时，拿到真实设备和接口文档后再做适配与测试。

## 调研后确定的优先级

先保证选店—菜单—报价—事务下单—真实收款—接单—备餐—取餐/送达，以及顾客/员工/门店权限和持久化。之后扩展会员/营销和完整收银，再接外部履约、硬件、其他小程序平台。所有截图项目保留编号，不以“有入口”当作“已完成”。

