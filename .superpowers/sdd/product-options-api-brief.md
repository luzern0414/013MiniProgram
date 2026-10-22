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

### Task 1: 数据库、配置API及点单规则

**Files:** `apps/api/prisma/schema.prisma`、下一编号迁移；`apps/api/src/modules/catalog/product-options.{controller,service,validation}.ts`；catalog视图、orders报价/下单、merchant SKU改价入口、app.module；`apps/api/tests/product-options.test.ts`、`.superpowers/sdd/product-options-runner.cjs`；API合约及`docs/tasks/product-options-api-report.md`。

**Interfaces:** 产出上述GET/PUT配置、加料库存端点及扩展报价行；只在公开菜单暴露可选择节点和可售量，merchant配置读取包含停用记录以便恢复。

- [ ] 先以随机`test_product_options_*`隔离schema编写真实DB/HTTP测试并观察缺端点RED。模块顶层先验证schema；所有嵌套夹具/runner必须在本轮创建成功且OID/owner一致后才清理，碰撞时保留已有对象。
- [ ] 增量迁移保留原SKU/Modifier id、stock/reserved和全部历史订单，默认enabled=true/configurationRevision=0。模型与SQL的引用删除策略一致；不运行reset或清理源库。Prisma generate前由协调器停止其拥有的API。
- [ ] 实现严格白名单及完整树验证，将节点归属、组和值引用、组合唯一、上下限及金额/数量验证放在独立validation模块。新增clientKey在事务内解析为真实ID；所有既有节点遗漏、重复节点、外来ID都拒绝。
- [ ] 在Serializable事务内核对有效OWNER、本店授权和expectedRevision，保存配置、递增版本并写审计；并发同版本只允许一方提交。停用保留记录与库存；库存字段只允许新项initialStock，存量项不接受。
- [ ] 增加有意义的库存/快照回归。关键断言形式：

```ts
assert.deepEqual(racingUpdates.map(r => r.status).sort(), [200, 409]);
assert.equal((await createFromQuoteBeforeConfigurationChange()).status, 409);
assert.equal((await quoteWithoutRequiredAttribute()).status, 400);
assert.equal((await db.sku.findUniqueOrThrow({where:{id:originalSkuId}})).reserved, originalReserved);
assert.deepEqual((await db.order.findUniqueOrThrow({where:{id:paidOrderId}})).lines, savedHistoricalLines);
```

- [ ] 实际覆盖缺选/超选/重复/跨商品选项、重复组合、SKU/加料停用、旧报价、商品价格修改版本、仅库存更新报价仍可用、退款以外既有现金/履约/取消释放、授权撤销及未授权角色。加料库存竞争不超售，删除不存在硬入口。
- [ ] 执行`node .superpowers/sdd/product-options-runner.cjs`专项、`pnpm --filter @restaurant/api test`领域回归、构建后`pnpm test:integration`真实HTTP回归、`pnpm --filter @restaurant/api exec tsc -p tsconfig.json --noEmit`及`git diff --check`；写明RED/GREEN及迁移保留证据。独立审查通过后由协调器迁移开发库并恢复服务。此时不标记整项需求已验收。


