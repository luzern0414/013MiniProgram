# 商品规格、口味与加料实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. 本计划在分类/单位 Task2 完成验收后执行，不同时派发两个实现者。

**Goal:** 完成 REQ-034/035/036 的经营配置和实际点单：规格组合唯一、口味选择规则、加料价格/库存及历史快照。

**Architecture:** 继续使用门店商品与稳定的 SKU/Modifier 身份，在 catalog 模块增加配置管理服务和独立控制器。规格组合与口味属性分开建模，库存仍走已验证的预占/释放链路。品牌商品模板和导入另行实施，不将门店配置冒充品牌模板。

**Tech Stack:** NestJS11、Prisma6.19、PostgreSQL16，Vue3电脑端，uni-app双小程序，mini-core共享选择与编辑行为。

## Global Constraints

- 保留development/public全部已有商品、订单、库存和会话，不删库重置；迁移必须可作用于现存数据。
- 正式业务数据全部通过后端读写数据库；不得伪造成功，不得改变历史订单快照。
- 所有界面文字原则上不得小于14px，提交禁重，失败提示清晰，保留requestId。
- 商户门店经营配置仅允许当前有效OWNER且有本店授权；事务内重新核对身份及授权。品牌共享分类/单位的权限规则保持。
- 变更配置不得重建已有SKU/Modifier，不清零其预占；已有订单支付、履约、取消和超时释放保持可用。
- 当前没有AppID/支付/域名/服务器资源，继续本地验收，不声称微信真机或生产已验证。
- 目录分类和单位仍遵守其既有启停、可见性及引用规则。

## 模型和契约决策

规格决定SKU，口味不生成SKU且不占库存，加料在SKU价格之外增加金额并占自己的库存。货币继续用整数分；规格、属性组、选项及加料名称trim后1至80字，排序0至100000。

配置每商品最多3个规格维度、每维20个值，启用SKU最多20个；最多5个属性组、每组10个选项；加料最多20项。既有记录迁移时完整保留，超过新编辑限制的旧数据只能读取并明确提示调整，不能被迁移截断。配置编辑不提供硬删除已建立身份的操作，通过停用保留历史。

新增模型/字段：

```text
Product.configurationRevision Int default0
ProductSpecGroup {id,productId,name,sort,enabled}
ProductSpecValue {id,groupId,name,sort,enabled}
Sku.enabled Boolean defaulttrue
Sku.combinationKey String?                 # @@unique([productId,combinationKey])
SkuSpecSelection {skuId,groupId,valueId}     # 每SKU每组最多1值
ProductAttributeGroup {id,productId,name,sort,enabled,minSelections,maxSelections}
ProductAttributeOption {id,groupId,name,sort,enabled}
Modifier.enabled Boolean defaulttrue
```

已有SKU的combinationKey默认null，不按旧名称去重或删除记录。启用规格维度后，每个启用SKU必须恰好选择每个启用维度的一个启用值；服务端按已排序的groupId/valueId生成组合键，同商品组合唯一。停用一个维度可能造成组合合并，冲突时拒绝保存，要求明确停用或调整重复SKU。无规格维度时仍可沿用既有规格名称，新的配置提交要求启用SKU名称不重复。

属性组选择规则：0≤minSelections≤maxSelections≤10；启用组至少保留minSelections个启用选项。min>0表示必选，前端不额外存一份required真值。旧客户端省略attributeOptionIds时按[]解析；遇必选组仍须后端拒绝，不绕过规则。

客户端提交完整配置树，已有节点必须带原ID，新增节点不带ID；服务端生成新ID。所有既有节点都须保留在提交树中，停用通过enabled=false表示，遗漏既有节点拒绝，避免一次编辑静默丢失记录。不能借提交其他商品的ID转移节点或库存。固定ID和组合键均由后端验证；不信任客户端计算结果。

```text
GET /merchant/products/:productId/options?storeId=...
 -> {productId,configurationRevision,specGroups,skus,attributeGroups,modifiers}

PUT /merchant/products/:productId/options
 {storeId,expectedRevision,specGroups,skus,attributeGroups,modifiers}
 -> 同GET结构

specGroups:[{id?,clientKey?,name,sort,enabled,values:[{id?,clientKey?,name,sort,enabled}]}]
skus:[{id?,name,enabled,priceFen,selections:[{groupRef,valueRef}],initialStock?}]
attributeGroups:[{id?,name,sort,enabled,minSelections,maxSelections,
                  options:[{id?,name,sort,enabled}]}]
modifiers:[{id?,name,enabled,priceFen,initialStock?}]
```

新维度/值在单次请求内以`clientKey`（1至64位a-zA-Z0-9_-）关联；groupRef/valueRef仅能引用本请求内已声明的ID或clientKey，不接受跨商品ID。响应仅返回持久化ID，不把clientKey当作业务身份。新SKU/Modifier可有initialStock，已有项传initialStock拒绝；普通配置提交绝不带旧库存绝对值覆盖并发订单。

库存维护与配置分离：保留既有SKU改价/库存入口；新增 `PATCH /merchant/modifiers/:id/inventory {storeId,expectedAvailable,available}`，以可售量条件更新，保留reserved，校验available+reserved≤2000000000。无匹配409 STATE_CONFLICT；未知写入结果不重发，重新读取核对。SKU原有改价入口发生实际价格变化时，同事务递增Product.configurationRevision；只修改库存不递增此配置版本。

报价行新增可选`attributeOptionIds:string[]`。服务器验证选项去重、归属、启用状态、各组上下限，返回/保存属性名称与选项快照及configurationRevision。新报价必须拒绝停用SKU/加料。下单重新核对配置版本、启停、价格及属性规则；旧快照缺configurationRevision按0解释，迁移后未编辑的老商品报价保持兼容。配置变更后旧报价返回409 PRODUCT_OPTIONS_CHANGED，提示刷新菜单；已生成的订单继续使用原快照。

### Task 2: 两端经营配置编辑器

**Files:** Web及merchant-mini各自独立`ProductOptions`编辑组件；既有商品页入口；mini-core的选择/提交校验与编辑状态及行为测试；`docs/tasks/product-options-ui-report.md`。

**Interfaces:** 消费Task1实际合约；沿用商品列表的稳定Product.id、现有请求/会话、Modal/底部面板和busy/locked约定。

- [ ] 先用共享行为测试覆盖新组合、缺组/重复组合、版本冲突锁定和未知写入结果，观察RED，再实现；不将后端校验交给前端替代。
- [ ] 商品旁增加“规格与口味”，分组显示规格、口味、加料；启停明确，新建组合预览避免无意生成过多SKU。显示组合价格和可售量，但已有库存通过独立库存操作维护，不随配置保存发送。
- [ ] 允许编辑属性最少/最多选择并以自然文案解释必选；停用保留可恢复入口。组与值已有ID保留，不通过改名重新创建全部记录；新clientKey仅用于本次草稿关联。
- [ ] 加料价格/启停及库存操作真实请求；库存冲突保留输入并要求刷新核对。所有配置冲突/未知结果阻止自动重发，必须重新读取；失败保存草稿供核对，未授权只读。
- [ ] 写入期间锁定切店/导航/关闭，组件卸载后旧响应不串入新门店。H5表单标签可唯一定位并点击聚焦，微信产物不依赖DOM执行业务。
- [ ] 执行相关行为测试、Web与两小程序构建，独立审查；协调器随后安排真实页面/SQL验收，不把构建当成联调完成。

## 当前客户端接口与交接边界

- 电脑商品列表在`apps/merchant-web/src/Products.vue`，现有弹层为`Modal.vue`；手机在`apps/merchant-mini/src/components/ProductsPanel.vue`，真实表单标签沿用`AccessibleInput.vue`。共享行为可独立新建`packages/mini-core/src/product-options.mjs`并从实际包入口导出。
- 首先读取已审查API的`docs/architecture/api-contract.md`和`docs/tasks/product-options-api-report.md`。读取响应中SKU的selections采用`{groupRef,valueRef}`且是已持久化ID；不得根据Prisma模型字段猜测客户端响应。读取含available/reserved，已有项提交必须剔除这些显示字段和initialStock。
- 完整树中的已建身份只能停用/恢复；未保存的新节点可以移除。新维度和值使用本次草稿clientKey，提交成功后以服务端ID替换草稿并重新读取，不把clientKey保存成远端业务身份。
- 列表刷新要等待真实请求完成，再允许下一次操作。配置冲突或未知结果的“重新加载”是真实GET核对并重建可编辑状态，失败时不清除锁定、不吞掉原草稿；不自动重发PUT。
- 本任务只完成经营编辑；顾客商品面板、购物袋、Web收银和订单快照展示是下一任务，勿提前跨入。README、config、需求台账、协调器验收清单和progress由根协调器维护；不要一起提交。
- 运行中的Web5173、顾客5174、商户5175由协调器管理，勿停止；若必须重新生成Prisma或重启API请先通知。H5开发模块缓存曾造成新导出不可见，遇到时报告具体导出/网络证据，协调器会处理浏览器缓存及自有进程，不通过伪造数据绕过。
