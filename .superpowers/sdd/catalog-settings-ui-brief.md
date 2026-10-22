### Task 2: 电脑端与商户小程序维护入口及真实验收

**Files:** apps/merchant-web/src/CatalogSettings.vue与分类/单位编辑组件，Products.vue；apps/merchant-mini/src/components/CatalogSettings.vue与编辑组件，商品页入口；packages/mini-core/src/catalog-settings.mjs及有意义的行为测试；docs/tasks/catalog-settings-ui-report.md；README/config/验收台账。

**Interfaces:** 消费Task1实际合约；复用已有useResource/useMutation/Modal与小程序AccessibleInput；不复制网络和会话实现。

**Compatibility details:** Task1分类/单位版本冲突返回`STATE_CONFLICT`（409），名称冲突为`NAME_CONFLICT`，引用删除为`REFERENCE_CONFLICT`；按真实代码处理而非假定员工模块的`VERSION_CONFLICT`。商品更新时若未改变单位，省略`unit`及`unitId`，使停用旧单位能保留；发生单位选择变更才发送`unitId`。`visibleStoreIds:null`表示现在及未来所有门店；数组表示显式集合，`[]`表示全部门店隐藏。读取后的`canManageBrand`决定共享配置是否可编辑。

**Integration:** 商户小程序的维护组件应沿用 StaffPanel 的 busy/locked 约定，在写入过程中锁定切店、导航和关闭编辑；异步完成不能把旧门店结果写到新门店画面。沿用现有底部面板/Modal动效及减少动画设置，不引入另一套弹窗或会话请求层。提交前选中的分类/单位需要来自最新 settings，加载失败不能用旧的自由文本悄悄降级提交。

**Current mini boundary:** 现有商户小程序商品页仅支持查询和售罄切换，尚无完整商品编辑器。本任务需要分离组件补齐商品新增及基础编辑，真实调用既有 POST/PATCH products，让分类/单位选择在小程序中也确实可用；保留既有规格身份和库存，不通过商品编辑器删除或重建 SKU。新建可沿用电脑端的1至20种规格输入，已有规格价格/库存管理仍沿用各端当前能力，下一模块再扩展组合/属性/加料。入口及编辑器不堆进现有 index.vue 或 merchant.js。

- [ ] 写提交校验/版本冲突行为测试并观察RED；沿用staff controller的有限状态模式但不复制一整套无关逻辑。旧revision冲突后锁定写入，必须重新读取再编辑；未知写入结果提示刷新核对，不自动重发。
- [ ] Web商品页增加“分类与单位”入口，分类列表显示商品引用数、排序、启停和可见门店；新建/编辑/删除均真实请求；引用删除错误保留表单且显示原因。单位列表支持新建、改名、禁用和删除；商品新建/编辑用有效单位选择，禁用旧单位显示原值且允许保留。商品编辑允许调整分类，便于真实解除旧分类引用；仅在选择变更时发送categoryId，停用或隐藏的当前分类可保留但不能作为新选择。两端保持同一规则。
- [ ] 商户小程序商品页提供同样维护能力，分离组件，控件使用uni组件；H5标签可定位、点击聚焦，微信构建不依赖DOM处理业务。canManageBrand=false时只读展示，不提供假可用保存按钮。
- [ ] 真实页面验收：Web新建分类及单位，新增商品关联，商户H5刷新读到；改单位名两端一致；分类仅梧桐里可见、顾客另一店菜单无该分类；停用后顾客刷新消失且之前报价下单失败；恢复后可重新报价；引用删除被拒，空分类/未引用单位可删除，刷新保持。
- [ ] SQL核查分类映射/单位关系、审计、现有订单现金总额/库存不被本轮维护误改。低权限真实会话操作被拒。执行相关行为测试及Web/两小程序H5与微信构建，独立审查后更新REQ030/031四状态、README及progress。

品牌商品模板、规格组合/属性、加料管理和导入仍单独计划；本计划不将这些空缺标记完成。引用调研见2026-10-20-restaurant-research.md中的yshop/litemall模型与事务分析，采用其领域拆分和库存模式，不未经检验搬运Java实现。

