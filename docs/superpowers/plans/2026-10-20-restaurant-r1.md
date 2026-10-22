# 餐饮 R1 交易基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 交付可运行的品牌多门店数据库、API、用户/商户双小程序与商户 Web 第一批真实经营闭环，并保留90项功能的准确状态。

**Architecture:** pnpm workspace；NestJS + Prisma/PostgreSQL 模块化 API；uni-app Vue3 双小程序；Vue3/Element Plus 管理后台；统一 API 合约。先实现 R1，不以空页面或假成功填满 R2/R3。

**Tech Stack:** Node>=22、实际 pnpm9.15.9、TypeScript5、NestJS11、Prisma6.19.0、PostgreSQL16、Vue3、Vite、uni-app、Vitest、Playwright CLI。

## Global Constraints

- 金额全部使用整数分，人民币 CNY；时间存 UTC，营业日按 Asia/Shanghai。
- 所有正式业务数据通过 API 读写真实数据库，生产不注入体验数据。
- 所有员工接口服务端校验品牌与门店授权，顾客只看本人订单。
- 三端遵循 `docs/architecture/api-contract.md`；UI正文与辅助文案均至少14px。
- 应用数据加载失败时明确展示错误，不能回退成写死商品或伪造成功。
- 外部微信登录、支付、配送、设备未真实联调则不可标记已验证。
- 关键业务先写有意义的失败测试，再实现，再运行验证。
- 每个任务记录实现、运行、测试、上线四种不同状态。
- 原截图90项保留在 `data/requirements/features.json`，R2/R3不在R1假装完成。

## File structure and ownership

控制器负责 root package/config/scripts/data/research/docs/tests/integration；API 任务独占 apps/api 和其 Prisma 目录；Web 任务独占 apps/merchant-web；小程序任务独占 apps/customer-mini、apps/merchant-mini、packages/mini-core。接口和依赖变更通过消息协调，不让实现者改 root lockfile。子任务依次实施和独立审查，控制器同时完成不依赖该任务的调研/运行环境。

### Task 1: Workspace and PostgreSQL runtime

**Files:** Create root package.json, pnpm-workspace.yaml, tsconfig.base.json, scripts/db.mjs, config/environments/development.env.example, config/environments/production.env.example；修改.gitignore。
**Interfaces:** database URL 指向127.0.0.1:55432/restaurant_dev；API启动读取环境；完整合约见 api-contract.md。

- [x] 建立新仓库实施分支与配置，记录用户设计确认，不创建空白应用冒充功能。
- [x] root devDeps固定 prisma/tsx/typescript/vitest/pg/embedded-postgres，portable postgres限定development。
- [x] 编写数据库启动验证：新建表、事务写入再回滚、查询结果为0；它不改任何已有项目数据库。
- [x] 运行 `pnpm db:start`、`pnpm db:verify`；期望真PostgreSQL连接成功，回滚保持0行。
- [x] 提供 db:stop，停止仅本项目已记录的进程；数据保存在 data/postgres 且不入Git。

### Task 2: API and transactional restaurant core

**Files:** apps/api/package.json, src/main.ts, src/app.module.ts, src/common/*, src/modules/{auth,stores,catalog,orders,merchant,cms}/*, prisma/schema.prisma, prisma/migrations/*, prisma/seed.ts, tests/*。
**Consumes:** DATABASE_URL和API合约；**Produces:** /api/v1 所有R1合约接口，端口3000。

- [x] 首先编写金额/状态/授权/库存相关测试。示例：`expect(canTransition('COMPLETED','ACCEPT')).toBe(false)`；`expect(assertPositiveQuantity(0)).toThrow()`。运行看到功能缺失失败。
- [x] 实现 Prisma schema/迁移、门店品牌/员工/商品/SKU/加料/报价/订单快照/库存预占/现金流水/审计/CMS和开发会话。
- [x] 实现固定开发身份与明确环境保护；生产缺少微信配置必须诚实报不可用。
- [x] 实现服务端报价、带门店校验的条件库存更新、同事务订单与事件、幂等键绑定用户与请求哈希、取消只释放一次。
- [x] 实现员工授权、商品编辑、订单状态机和真实现金收银；改价不能影响历史订单。
- [x] 实现数据库聚合统计、会员/员工真实查询、CMS草稿发布与版本冲突。
- [x] 运行 `pnpm --filter @restaurant/api test`、`pnpm --filter @restaurant/api build`；运行迁移和隔离开发seed，提供API结果与测试报告。
- [x] 外部能力尚未实现的明确限制必须写入报告，不以503作为已完成微信支付功能。
- [x] 独立review审查权限/事务/幂等/边界，修复重要问题后再完成本任务。

### Task 3: Merchant desktop application

**Files:** apps/merchant-web/{package.json,index.html,vite.config.ts,src/*}。
**Consumes:** API合约；**Produces:** 5173的真实API经营后台，不使用静态业务数组。

- [x] 先写一个金额与错误展示/登录环境保护的行为测试并运行失败；纯样式无需镜像测试。
- [x] 以深墨侧栏、暖白工作区和克制橙色构建导航、登录、真实门店选择和加载/失败/空态。
- [x] 工作台、订单、商品、收银、桌台、会员/员工、门店设置、页面内容编辑，全部入口连接实际接口。
- [x] 商品表单支持真实新增、编辑、SKU价格库存；订单支持状态操作及现金收款，按钮按状态/权限控制并处理后端拒绝。
- [x] 收银购物车从catalog选择，调用quotes/orders/cash-payment，挂账/扫码等未实现能力不显示伪操作。
- [x] CMS支持保存草稿、发布、预览当前已发布内容和版本冲突反馈；不声称实现完整拖拽装修。
- [x] 接入短促过渡、骨架、提交禁重、键盘焦点、减少动态效果设置；14px最小文案和移动宽度可用。
- [x] 运行test/build；之后Playwright真实点击新增商品、编辑库存、下单现金收款、刷新验证及跨店权限。
- [x] 独立review后修复并提供可核查报告。

### Task 4: Customer and merchant mini programs

**Files:** apps/customer-mini/*, apps/merchant-mini/*, packages/mini-core/*。
**Consumes:** API合约；**Produces:** H5联调端5174/5175，微信dist/dev/mp-weixin构建产物。

- [x] 使用同一锁定版uni编译器，不混用@dcloudio包版本；创建两个独立manifest/pages文件。
- [x] 客户端真实选店、分类菜单、SKU/加料弹层、购物车、报价、订单提交、订单详情/取消、我的。
- [x] 商户端登录门店授权、工作台、订单状态操作/现金收款、商品售罄、营业开关。
- [x] 共享transport处理网络失败、超时、401、requestId；业务内容不写死，开发入口只在API明确dev环境下提供。
- [x] 构建为微信小程序和H5；小程序模板使用view/text/button等跨端组件，避免依赖DOM。
- [x] 行为测试先验证购物车按门店隔离和加料组合指纹；成功后实现购物车持久化与切店确认。
- [x] 真机尚未运行如实标记；H5点击通过只代表H5链路。
- [x] 独立review后修复，记录构建命令与产物。

### Task 5: Full-chain verification and delivery documentation

**Files:** tests/integration/r1.mjs, docs/acceptance/*, README.md, config/*, data/requirements/features.json, .superpowers/sdd/progress.md。

- [ ] 真数据库集成测试准备隔离品牌/门店/用户，不向生产API提供测试后门。
- [ ] 用HTTP真实请求验证：报价；重复提交只创建一单；同key异体冲突；库存1并发20单最多1单；取消回补只一次；跨店员工拒绝；他人订单拒绝；商品编辑不改历史快照；现金实收统计可复算。
- [ ] Playwright CLI在三端执行选择、编辑、加购、结算、接单、出餐、刷新；保存截图和操作证据到output/playwright。
- [ ] 生产启动测试拒绝DEV_AUTH_ENABLED与演示seed，缺配置真实报错；错误不泄露堆栈。
- [ ] 检查构建与类型，发现问题定位、修复、复测；审查未实现按钮和错误降级。
- [ ] README只写实际可运行命令和访问地址，记录4种完成状态；完善配置/备份/恢复；精确更新需求台账。
- [ ] 完成任务审查与最终分支审查；未联调微信/支付/设备/生产不标记整体目标完成。

## Later plans

R2/R3仍为待实施设计范围，需在R1真实闭环后生成对应模块实施计划；持续目标不会因为R1完成而标记整体完成。用户已确认方案A并要求持续执行，不再为常规实现和可逆修复重复询问权限。

## Progress

- 设计批准：2026-10-20，用户明确“确认方案 A，继续实施（推荐）”。
- 开始执行：Task 1。


