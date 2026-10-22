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

- [ ] 首先写隔离test_catalog_*实际DB/API测试并观察RED：分类排序、启停、店别可见性、旧报价拒绝、被引用删除409、空分类删除、单位新建改名/禁用/引用保护、跨品牌/部分门店OWNER/CLERK403、旧revision409、并发改同条记录最多一方成功；回归已有订单取消/现金不受分类停用影响。
- [ ] Category新增enabled=true、revision=0、allStores=true；新增分类门店可见性映射。visibleStoreIds=null表示全部同品牌门店（包括未来新增门店），数组表示显式集合、空数组表示所有门店隐藏。未提供该属性时保留原配置；提供时完整替换并校验同品牌、数量不超过100。名称1至80、sort整数0至100000、严格白名单，空修改拒绝。查询按sort及id稳定排序。权限不足的settings不泄露未授权门店名或ID，其visibleStoreIds仅包含可访问门店，且不可用于写入。
- [ ] Unit归品牌，id/name/enabled/revision；Product新增可空unitId关系，保留unit文本兼容既有客户端和旧记录。迁移按品牌+现有unit文本去重创建单位并回填unitId，不改旧文本，不丢重复商品。同步更新种子使重复执行不重置业务数据。
- [ ] 单位名称1至20、去除首尾空白；同品牌同名冲突409；已引用单位不可删除，禁用后已有商品可继续展示/下单，但不能为新商品或单位变更选择禁用单位。商品响应unit优先读取关联Unit.name，兼容legacy unit文本；单位改名后新查询可见，历史订单快照不变。
- [ ] 既有POST/PATCH商品增加unitId支持；仅传原unit文本时解析为同品牌有效单位，找不到明确报错，不悄悄创建。原单纯改价/库存请求不能因单位已停用而失败。相关品牌分类/单位校验与商品写入同一事务并留审计。已有独立商品测试若直接创建legacy数据，可继续读兼容文本。
- [ ] 将现有POST categories移到新控制器避免重复路由；商品/规格原入口保留。新增操作在事务内重新核对OWNER及全品牌授权，版本条件写入、可见性关系、审计原子提交，已引用删除返回REFERENCE_CONFLICT；不凭缓存actor身份执行。
- [ ] main.ts CORS允许方法增加DELETE，真实预检测试覆盖商户H5跨域删除；现有认证/请求头规则保留。
- [ ] Public catalog隐藏disabled或本店不可见分类及其商品。Quote与create均核实category enabled及可见性，旧报价遇停用/隐藏拒绝409并提示刷新；既有订单支付/履约/取消正常保持，不能因目录变化丢失释放预占能力。
- [ ] 实际运行新DB测试、既有staff/bootstrap/domain/HTTP回归与tsc。Prisma generate需要停止项目API，先通知协调器管理进程；不擅自杀未知PID。独立审查后再记录通过；不得提前标记REQ030/031整项verified。
