# 分类与单位管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** 完成截图REQ-030分类与REQ-031单位的真实维护，顾客菜单、报价及订单同步遵守分类启停/门店可见性。

**Architecture:** 沿用模块化NestJS API，在catalog模块新增管理服务与控制器，不继续扩大MerchantController。品牌分类/单位统一维护，商品继续保留门店独立销售配置；这一步不冒充品牌商品模板完成。

**Tech Stack:** Prisma6.19/PostgreSQL16，Vue3电脑端，uni-app/Vue3商户端，mini-core共享编辑状态。

## Global Constraints

- 保留development/public全部已有商品、订单、库存和会话，不删库重置；迁移必须可作用于现存数据。
- 每个业务操作通过真实 API/数据库；金额、订单及现有恢复行为保持兼容。
- 字号至少14px，提交禁重，失败提示清晰，保留 requestId。
- 新会话与既有会话都必须受停用/撤权约束。事务内重新核查操作者当前身份及授权。
- 品牌共享分类/单位的修改要求OWNER拥有该品牌所有现存门店授权，避免仅管一家门店的人改变其他门店；查询仍要求当前门店授权。
- 分类隐藏/停用必须同时影响公开菜单、报价及旧报价下单；不能仅在前端隐藏。
- 无AppID/商户号不影响本地功能，不声称微信或生产验收通过。

### Task 1: 分类与单位数据库/API及订单校验

**Files:** apps/api/prisma/schema.prisma和下一编号迁移；src/modules/catalog/catalog-admin.{controller,service}.ts及catalog-policy.ts；catalog.service.ts、orders.service.ts、merchant.controller.ts、app.module.ts、main.ts；prisma/seed.ts；tests/catalog-admin.test.ts；docs/tasks/catalog-admin-report.md；docs/architecture/api-contract.md。

**Interfaces:**

```text
GET /merchant/catalog-settings?storeId=... -> {canManageBrand,categories,units,stores}
Category {id,name,sort,enabled,revision,visibleStoreIds:string[]|null,productCount}
Unit {id,name,enabled,revision,productCount}
POST /merchant/categories {storeId,name}                 # 保留既有路径
PATCH /merchant/categories/:id {storeId,expectedRevision,name?,sort?,enabled?,visibleStoreIds?}
DELETE /merchant/categories/:id {storeId,expectedRevision}
POST /merchant/units {storeId,name}
PATCH /merchant/units/:id {storeId,expectedRevision,name?,enabled?}
DELETE /merchant/units/:id {storeId,expectedRevision}
```

- [x] 首先写隔离test_catalog_*实际DB/API测试并观察RED：分类排序、启停、店别可见性、旧报价拒绝、被引用删除409、空分类删除、单位新建改名/禁用/引用保护、跨品牌/部分门店OWNER/CLERK403、旧revision409、并发改同条记录最多一方成功；回归已有订单取消/现金不受分类停用影响。
- [x] Category新增enabled=true、revision=0、allStores=true；新增分类门店可见性映射。visibleStoreIds=null表示全部同品牌门店（包括未来新增门店），数组表示显式集合、空数组表示所有门店隐藏。未提供该属性时保留原配置；提供时完整替换并校验同品牌、数量不超过100。名称1至80、sort整数0至100000、严格白名单，空修改拒绝。查询按sort及id稳定排序。权限不足的settings不泄露未授权门店名或ID，其visibleStoreIds仅包含可访问门店，且不可用于写入。
- [x] Unit归品牌，id/name/enabled/revision；Product新增可空unitId关系，保留unit文本兼容既有客户端和旧记录。迁移按品牌+现有unit文本去重创建单位并回填unitId，不改旧文本，不丢重复商品。同步更新种子使重复执行不重置业务数据。
- [x] 单位名称1至20、去除首尾空白；同品牌同名冲突409；已引用单位不可删除，禁用后已有商品可继续展示/下单，但不能为新商品或单位变更选择禁用单位。商品响应unit优先读取关联Unit.name，兼容legacy unit文本；单位改名后新查询可见，历史订单快照不变。
- [x] 既有POST/PATCH商品增加unitId支持；仅传原unit文本时解析为同品牌有效单位，找不到明确报错，不悄悄创建。原单纯改价/库存请求不能因单位已停用而失败。相关品牌分类/单位校验与商品写入同一事务并留审计。已有独立商品测试若直接创建legacy数据，可继续读兼容文本。
- [x] 将现有POST categories移到新控制器避免重复路由；商品/规格原入口保留。新增操作在事务内重新核对OWNER及全品牌授权，版本条件写入、可见性关系、审计原子提交，已引用删除返回REFERENCE_CONFLICT；不凭缓存actor身份执行。
- [x] main.ts CORS允许方法增加DELETE，真实预检测试覆盖商户H5跨域删除；现有认证/请求头规则保留。
- [x] Public catalog隐藏disabled或本店不可见分类及其商品。Quote与create均核实category enabled及可见性，旧报价遇停用/隐藏拒绝409并提示刷新；既有订单支付/履约/取消正常保持，不能因目录变化丢失释放预占能力。
- [x] 实际运行新DB测试、既有staff/bootstrap/domain/HTTP回归与tsc。Prisma generate需要停止项目API，先通知协调器管理进程；不擅自杀未知PID。独立审查后再记录通过；不得提前标记REQ030/031整项verified。

### Task 2: 电脑端与商户小程序维护入口及真实验收

**Files:** apps/merchant-web/src/CatalogSettings.vue与分类/单位编辑组件，Products.vue；apps/merchant-mini/src/components/CatalogSettings.vue与编辑组件，商品页入口；packages/mini-core/src/catalog-settings.mjs及有意义的行为测试；docs/tasks/catalog-settings-ui-report.md；README/config/验收台账。

**Interfaces:** 消费Task1实际合约；复用已有useResource/useMutation/Modal与小程序AccessibleInput；不复制网络和会话实现。

现有商户小程序仅有商品查询及售罄切换，本任务以分离组件补商品新增/基础编辑，使用既有POST/PATCH产品接口实现真实分类/单位选择，不重建既有SKU。维护写入沿用StaffPanel的busy/locked约定，锁定切店、导航及关闭，避免旧门店异步结果串到新门店。单位或分类未改变时省略相应字段；分类/单位旧版本错误按Task1真实合约STATE_CONFLICT处理。最新实施细则同步于`.superpowers/sdd/catalog-settings-ui-brief.md`。

- [x] 写提交校验/版本冲突行为测试并观察RED；沿用staff controller的有限状态模式但不复制一整套无关逻辑。旧revision冲突后锁定写入，必须重新读取再编辑；未知写入结果提示刷新核对，不自动重发。
- [x] Web商品页增加“分类与单位”入口，分类列表显示商品引用数、排序、启停和可见门店；新建/编辑/删除均真实请求；引用删除错误保留表单且显示原因。单位列表支持新建、改名、禁用和删除；商品新建/编辑用有效单位选择，禁用旧单位显示原值且允许保留。商品编辑允许调整分类，便于真实解除旧分类引用；仅在选择变更时发送categoryId，停用或隐藏的当前分类可保留但不能作为新选择。两端保持同一规则。
- [x] 商户小程序商品页提供同样维护能力，分离组件，控件使用uni组件；H5标签可定位、点击聚焦，微信构建不依赖DOM处理业务。canManageBrand=false时只读展示，不提供假可用保存按钮。
- [x] 真实页面验收：Web新建分类及单位，新增商品关联，商户H5刷新读到；改单位名两端一致；分类仅梧桐里可见、顾客另一店菜单无该分类；停用后顾客刷新消失且之前报价下单失败；恢复后可重新报价；引用删除被拒，空分类/未引用单位可删除，刷新保持。
- [x] SQL核查分类映射/单位关系、审计、现有订单现金总额/库存不被本轮维护误改。低权限真实会话操作被拒。执行相关行为测试及Web/两小程序H5与微信构建，独立审查后更新REQ030/031四状态、README及progress。

品牌商品模板、规格组合/属性、加料管理和导入仍单独计划；本计划不将这些空缺标记完成。引用调研见2026-10-20-restaurant-research.md中的yshop/litemall模型与事务分析，采用其领域拆分和库存模式，不未经检验搬运Java实现。

本地实际验收与独立审查已完成，详见 `docs/acceptance/2026-10-20-catalog-settings.md`；全90项范围继续，微信/生产仍未验证。
