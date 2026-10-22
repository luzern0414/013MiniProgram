# 梧桐里餐饮多门店系统

面向同一品牌多门店的餐饮系统，包含顾客微信小程序、商户微信小程序、商户电脑后台和共用API。依据docs原始截图90项功能实施，完整范围与验收状态见 [功能台账](data/requirements/features.json)。

**当前持续开发中。** 三端已通过真实API完成点餐、现金收款、履约与数据库一致性联调；商品新增/编辑、分类排序/启停/可见门店、单位维护、营业切换、基础内容发布及员工账号/门店授权已本地联调。双小程序H5及微信产物均已构建。会员营销等后续模块尚待完成。没有生产上线，微信登录/支付/退款、配送和设备未接入。用户已确认先完成本地功能；不能将本地现金测试当成微信支付验收。

## 技术与目录

批准方案：uni-app/Vue3双小程序、Vue3电脑后台、NestJS11、Prisma6.19、PostgreSQL16、pnpm workspace。开源调研及许可依据见 [调研报告](docs/research/2026-10-20-restaurant-research.md)、[第三方声明](THIRD_PARTY_NOTICES.md)。

```text
apps/api/             已实现的HTTP API、数据库迁移及种子
apps/merchant-web/    Vue3商户电脑端
apps/customer-mini/   uni-app顾客小程序及H5
apps/merchant-mini/   uni-app商户小程序及H5
packages/mini-core/   跨小程序请求、身份、购物袋与恢复逻辑
config/               环境模板与配置说明
data/requirements/    截图90项功能与四种验收状态
data/research/        可追溯来源清单，原文缓存不入Git
data/postgres/        本项目本机数据库，不入Git
docs/                 设计、合约、实施计划、报告
scripts/              本地运行与隔离验收工具
tests/                运行时保护及真实HTTP集成验收
```

## 本机启动

已验证环境：Windows、Node24.15.0、pnpm9.15.9、PostgreSQL16.14。Node要求>=22。portable PostgreSQL只用于本项目本地开发，监听127.0.0.1:55432，不依赖系统数据库或Docker。

```powershell
pnpm install
pnpm db:start
pnpm db:verify
pnpm local:migrate
pnpm local:seed
pnpm --filter @restaurant/api build
pnpm local:api:start
```

API本地地址：http://127.0.0.1:3000/api/v1；health实际查询数据库。最后一条保持终端运行，Ctrl+C停止。改源码可用 `pnpm local:api`；Windows重新执行Prisma generate/build前先停本项目API，避免DLL文件锁。

默认读取 `config/environments/development.env.example`；自定义复制为根 `.env.local`，进程变量优先。当前交互开发schema是development，随机test_acceptance_*用于独立验收；早期public记录保留供诊断。种子数据可识别，重复seed不会重置库存或订单。

四个开发身份：customer、owner、clerk-a、clerk-b，分别为体验顾客、店主和两店店员；仅非生产且显式启用DEV_AUTH_ENABLED时可登录，服务端仍校验实际门店授权。它们不能用作生产管理员。真实配置及现有限制见 [config](config/README.md)；不要向聊天或Git提交密钥。

API启动后，在三个终端分别运行：

```powershell
pnpm local:web       # http://127.0.0.1:5173
pnpm local:customer  # http://127.0.0.1:5174
pnpm local:merchant  # http://127.0.0.1:5175
```

小程序编译使用 `pnpm --filter @restaurant/customer-mini build` 与 `pnpm --filter @restaurant/merchant-mini build`，各自生成 `dist/build/h5` 和 `dist/build/mp-weixin`。微信开发者工具导入后者；两个 `src/manifest.json` 的AppID尚为空，按各端 `.env.example` 设置 `VITE_API_BASE_URL`。本地H5已联调，尚未进行微信开发者工具和真机验收。

## 验证

```powershell
pnpm test:runtime
pnpm --filter @restaurant/api test
pnpm --filter @restaurant/merchant-web test
pnpm --filter @restaurant/mini-core test
pnpm test:integration
```

runtime验证专用数据库及所有权保护。API领域测试验证金额、数量、状态与权限。集成命令需先构建API并启动专用数据库；为每次运行创建独立schema、迁移及体验数据，启动临时API验证真实HTTP/数据库，结束自动清理；不会把测试商品或装修发布写入交互开发schema。

已覆盖报价、库存竞争、重复提交/取消/收现金、非法状态、跨店权限、价格快照、CMS草稿发布冲突和过期订单释放。既有验收记录中运行时22项（含备份专项11项）、API领域9项、员工真实DB3项、管理员初始化4项、独立HTTP11项、Web18项、共享小程序29项已通过。三端实际点击与SQL证据见 [本地验收](docs/acceptance/2026-10-20-local-r1.md)，另有 [API报告](docs/tasks/api-report.md)、[Web报告](docs/tasks/web-report.md)、[小程序报告](docs/tasks/mini-report.md)、[员工界面报告](docs/tasks/staff-ui-report.md)。分类/单位接口专项6项、双端界面独立审查及真实页面/SQL验收通过，包含旧报价拒绝、版本冲突及保存响应丢失恢复，见[目录验收](docs/acceptance/2026-10-20-catalog-settings.md)。规格/属性/加料API专项10项及独立审查通过，第7次增量迁移后34张旧业务表非时间字段哈希及业务SQL一致，早期时间哈希限制见阶段记录；双端经营编辑与顾客/收银选择均经独立审查及真实页面/SQL验收：必选口味、购物袋分行/合并、旧报价409、现金履约、停用后取消释放及三端历史快照通过；最新共享59项/Web20项通过，见[规格阶段记录](docs/acceptance/2026-10-20-product-options.md)。微信真机、真实支付和生产验收尚未执行。

预约自提与即时取餐已完成本地三端页面和SQL验收：按履约日分号、时段容量、现金确认、核销、旧号精确查询、取消/到期释放，以及版本冲突和丢回执恢复。真实验收发现的付款期限时区问题已修复，009后43张业务表392行的非时间字段哈希一致；后续真实恢复009前备份，221条含时间旧行的原值一致（恢复会话清空不参与对照）。原超时订单已自动关闭且仅释放一次；证据见[预约验收](docs/acceptance/2026-10-20-pickup-capacity.md)。专项8项、预约7项、共享79项、Web20项及五端构建在对应任务报告通过；微信订阅消息叫号、设备播报和真机未验证。

现金部分/全额退款已完成两商户及顾客界面、本地真实页面/SQL验收和独立审查。新单验证1分钱、剩余全退、已完成全退、丢回执原请求恢复、登录失效、权限拒绝和收银凭证刷新，原收款、库存及已确认预约保持。共享行为最终96项通过，Web22项和五构建证据见任务报告。010迁移保留43张旧表399行全部原列（含时间），备份均完成真实隔离恢复。证据见[退款阶段记录](docs/acceptance/2026-10-20-cash-refunds.md)；完整财务对账继续实施，挂取单与现金交班见后续记录，微信退款未接入。

挂单与取单已完成本地验收：011新增草稿表，本地迁移前后44张旧表437行全部原列及时间保持，且全新备份已实际恢复。挂单保存不占库存、预约或取餐号，转单沿原订单事务只预占一次。Web保存→商户H5取单编辑→Web旧版409及明确重载→手机转单/现金/履约已真实执行，原18订单及金融记录逐行保持，SKU与加料各只扣2份。手机丢回执原key/body恢复同ID、刷新发现、离线与真实401后重登恢复、390px换行和真实商品名称复验通过，所有Important已独立复审关闭。见[挂单阶段记录](docs/acceptance/2026-10-20-cashier-drafts.md)；仅本地Web/H5范围，微信真机与生产仍未验，现金交班结果见后续记录。

现金交班API及012增量迁移已独立审查：新备份实际恢复核对通过，45张旧表500行全部原列及时间保持，旧12笔现金/4笔退款保留未归班。双商户均已独立复审并完成本地真实开关班、找零收款、版本冲突和SQL验收；跨端收款归A班、跨班退款归B班、A关闭快照保持，mini丢回执/刷新/离线/真实401后原请求恢复已核对。新收退款必须有活动现金班次，旧幂等重放沿原凭证。当前90项台账为13项本地完整验证、15项实施中、62项待实施，生产验证0；现金子集不表示各渠道和应收交班全部完成。进度见[交班阶段记录](docs/acceptance/2026-10-21-cash-shifts.md)。

## 运行与维护边界

停止API后可 `pnpm db:stop`，再次 `pnpm db:start` 保留数据。数据库不可用先检查本项目端口和data/runtime日志；工具检测到其他实例或所有权不符会拒绝写入，不能通过删除保护文件绕过。迁移使用 `pnpm local:migrate`；升级前用`pnpm db:backup`备份整个本地库，再用`pnpm db:restore -- <database.dump绝对路径>`恢复到自动生成的新库并验证。命令及私人文件权限见[配置说明](config/README.md)，隔离PG16演练见[备份报告](docs/tasks/backup-report.md)。

首位管理员离线初始化已通过隔离CLI/HTTP/SQL验收，真实OWNER与员工共用凭据登录；命令及受限密码文件准备见[配置说明](config/README.md)。没有默认密码或公开OWNER注册；已有管理员不能重复初始化，OWNER密码恢复尚待实施。生产数据库、HTTPS域名、微信身份、支付密钥、备份和监控均尚未部署。生产模板不代表已经可上线。完整剩余范围见批准的 [设计](docs/superpowers/specs/2026-10-20-restaurant-design.md) 和 [实施计划](docs/superpowers/plans/2026-10-20-restaurant-r1.md)；每项分别记录已编写、已运行、已验证、已上线。
