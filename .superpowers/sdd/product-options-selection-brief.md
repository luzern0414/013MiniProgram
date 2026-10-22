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

### Task 3: 顾客与收银选择、订单快照及真实验收

**Files:** customer-mini商品面板/购物袋/下单，Web Cashier选择面板，两种商户订单详情，mini-core购物袋与选择规则测试；`docs/acceptance/2026-10-20-product-options.md`；需求台账/README/config由协调器统一更新。

**Interfaces:** Quote.lines与Order.lines新增attributes快照；购物袋行身份由skuId、排序后的modifierIds、排序后的attributeOptionIds共同确定，旧购物袋缺新字段按[]迁移。

- [ ] 先写购物袋“同SKU不同口味不合并”、选择上下限、旧存储兼容及配置变更错误行为测试并观察RED。
- [ ] 顾客选择规格维度后定位真实SKU，售罄/停用组合不可加入。属性组展示必选及可选数量，选中/取消及加入反馈沿用既有动效；加料显示真实价格和可售状态。
- [ ] Web收银同样提供必选口味/规格/加料入口，不能只能让顾客端选择而使收银端无法开该菜品。购物袋保存选择及可识别名称；后端报价仍为应付真值。
- [ ] 两商户订单详情显示当时的规格、属性、加料快照；编辑商品后历史详情保持。配置变化的旧报价提示刷新后重新确认，不以重试循环代替选择。
- [ ] 实际Web配置→商户H5重读→顾客选择→Web现金收款/履约→顾客完成；另一笔创建后停用所选加料，再取消原订单，SQL确认仅释放原预占。演练旧报价拒绝、必选缺失、不同口味不合并、跨门店/角色、离线恢复。
- [ ] SQL重新查询配置关系、SKU/加料库存、审计及历史快照；刷新或重新登录持久化一致。测试/构建及独立审查后，只有完整闭环才将REQ-034/035/036标记本地verified，productionVerified保持false。

## 当前代码接口与任务归属

- 顾客状态在`apps/customer-mini/src/customer.js`，页面在`apps/customer-mini/src/pages/index/index.vue`；现有商品/购物袋/订单展示与该页面同处一文件。请将新增选择面板独立为顾客端组件，避免继续把全部业务堆入长页面。
- Web收银在`apps/merchant-web/src/Cashier.vue`，已有真实订单幂等、未知收款恢复及`recovery.mjs`会话存储链路必须保留；新选择面板独立成组件。Web订单详情在`Orders.vue`，商户手机订单显示在自身页面/状态模块，以实际文件为准。
- mini-core当前`fingerprint`只包含SKU/加料；本任务扩展排序后属性ID，并同时更新所有调用及页面列表key，避免同SKU两种口味的DOM行被复用。旧购物袋、旧收银恢复存储及旧订单缺属性字段一律按空数组兼容，不无条件清空用户未完成业务。
- Task2只新增经营编辑行为；本任务可新建专门顾客选择行为模块，与完整树配置校验职责分开。先读Task2最终报告及实际共享导出，不猜测函数名或复制一套冲突规则。公开菜单的specGroups、attributeGroups、configurationRevision及SKU selections以实际已审查合约为准。
- 商品配置变更错误必须有自然文案及真实刷新菜单入口；失效购物袋选择明确标出，允许重新选择搭配，不静默替换口味、不自动重复创建订单。报价才是应收真值，客户端展示金额仅用于选择时预估。
- Web`domain.mjs`当前只映射PRICE_CHANGED/CATALOG_CHANGED，需补PRODUCT_OPTIONS_CHANGED及相关聚焦测试；收银恢复/checkout状态对“服务器明确拒绝且未创建”与“未知创建结果”分别处理，前者允许刷新重选，后者保留原幂等键并真实查询。不要因新增错误让用户永久卡在原幂等键或自动新建第二笔。
- 历史详情只读订单attributes/modifiers/skuName快照，不根据当前商品配置重新查名；名称组与选项均可识别。缺属性的旧详情正常展示。
- 协调器负责development真实页面与SQL验收、需求台账、README/config、progress及`docs/acceptance/2026-10-20-product-options.md`；实现者不在源开发库造单/改配置来声称验收完成，不改上述协调器文档。实现者报告写`docs/tasks/product-options-selection-report.md`，提交自身代码/行为测试/必要类型。
