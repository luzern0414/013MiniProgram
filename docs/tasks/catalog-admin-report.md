# 分类与单位管理 Task 1 实施报告

日期：2026-10-20。范围：已批准的单品牌多店目录设置数据库/API及订单规则；不包含 Task 2 UI。基线为77d813b之后协调器已提交的需求澄清；本实现不标记REQ030/031整项verified，不声称完整90项、微信、真机或生产验收完成。

## 实现

- 新增模块 `catalog-admin.controller.ts`、`catalog-admin.service.ts` 和共用 `catalog-policy.ts`；既有 POST `/merchant/categories` 已从 MerchantController 移出，无重复路由。商品与规格原路径保留。
- GET `/merchant/catalog-settings` 返回 canManageBrand、分类、单位及已授权门店。分类按 sort、id 稳定排序；部分门店 OWNER/CLERK 可查询当前门店，门店名称和 visibleStoreIds 均过滤到操作者可访问范围，不能管理品牌时禁止写回。
- 分类新增 enabled/revision/allStores 与 CategoryStoreVisibility。`visibleStoreIds=null` 表示全部本品牌当前和未来门店；数组完整替换显式集合，`[]` 表示全部隐藏；省略保留。名称、排序、布尔、版本、数组长度与跨品牌门店严格验证，未知字段及空修改拒绝。
- 新增品牌 Unit（同品牌名称唯一、启停、revision）和 Product.unitId 可空关联。单位名称 trim 后1至20字；同名409 NAME_CONFLICT；已有商品引用时删除409 REFERENCE_CONFLICT。
- 所有分类/单位写操作要求当前有效 OWNER 且拥有该品牌全部现存门店授权。权限、版本条件写入、映射和审计同一 Serializable 事务提交；不依赖事务外缓存身份。旧版本409 STATE_CONFLICT；并发同版本修改最多一方成功。新增门店后未取得其授权的原 OWNER 也不能修改品牌共享设置。
- 商品 POST/PATCH 支持 unitId；仅传旧 unit 文本时解析已有有效单位，缺失400，不自动创建。拒绝选择其他品牌/停用单位；单位未变更时调用方必须省略 unit/unitId。只改名称、价格、库存不因已有单位停用而失败。商品响应 unit 优先读取关联名称，旧无关联记录读取原文本；单位改名不改订单/报价快照。
- 商品新增/编辑及 SKU 修改均在事务内重新核查操作者当前身份与门店授权；分类/单位校验和商品保存、审计原子提交。商品 PATCH 支持 categoryId，改分类时校验品牌、启用及本店可见。
- 公开菜单对分类和商品同时执行启用/本店可见过滤；quote/create 使用相同分类规则，停用或隐藏后的旧报价返回409 CATALOG_CHANGED并提示刷新。单位停用不会阻止已关联商品下单。已有订单的幂等读取、取消、现金、履约和库存释放保留；订单写事务也重新读取有效会话及授权。
- CORS methods 增加 DELETE，保留既有 origins、认证和允许请求头规则。
- API 合约已更新，明确字段、可见范围、权限、单位选择及错误码。旧 revision 使用 STATE_CONFLICT，与员工接口 VERSION_CONFLICT 区分，UI 应刷新确认，不能自动覆盖。

## 迁移及种子

迁移 `202610200006_catalog_settings` 使用 PostgreSQL 事务：分类默认 enabled=true、revision=0、allStores=true；按商品所属门店品牌与原单位文本精确去重创建 Unit、回填 unitId。保留所有 Product.unit 文本，包括首尾空格；不改商品、订单、报价、库存、会话，不去重或删除重复商品。新关系用外键保留引用完整性；分类可见映射随空分类删除清理。

种子仅为新建体验商品关联单位，使用固定单位身份，并兼容从既有种子商品引用找到迁移生成的旧ID。重复运行不会把已改名/停用单位恢复为原名或另建一个原名单位；现有商品仍为 upsert update={}。既有 staff/source DB 测试的清理顺序仅在隔离测试库增加 Unit 清理，不放宽安全 guard。

专项迁移测试先在独立 test_catalog_*_migration schema 执行旧5次迁移，插入重复商品、含空白单位、跨品牌同名单位、订单、报价、库存预占和会话，再运行第6次迁移。逐字段比较原商品（仅新增unitId）、订单/报价/SKU/会话，确认原文、重复记录和库存数值保留；同品牌原文相同复用单位、不同品牌不共用单位。

## TDD与实际执行证据

1. 首先添加 `tests/catalog-admin.test.ts`，在随机 test_catalog_* schema 执行原5次迁移并通过真实API访问设置接口。修正测试运行器缺少 TSX tsconfig 的启动配置后，观察到业务 RED：`settings endpoint exists`，实际404、预期200。随后实现数据库/API。
2. 初轮 GREEN：真实PostgreSQL/API全流程通过。继续增加模块级guard与旧库迁移专项，3/3通过。
3. 新增“默认单位改名/停用后重复seed不得重建原名单位”测试观察 RED：实际同名原单位计数1、预期0。修复种子身份复用后 GREEN；最终还把单位ID改为迁移式旧ID，覆盖该兼容分支。
4. 既有 HTTP 回归首次发现店员创建缺少分类参数时返回400而原预期403。定位为 categoryId 参数校验移动到权限验证之前；恢复权限优先检查后，实际HTTP11/11通过。
5. 临时回归运行器首次为 bootstrap 继承 DEV_SEED_ENABLED=true，生产模式校验正确拒绝；改为该套件false后4/4通过。source DB套件首次固定PUBLIC_BRAND_ID，使原多品牌未配置应503的断言得到200；移除该套件的公开品牌预设后1/1通过。这两项是运行器环境问题，未修改/弱化原测试断言或schema guard。
6. 协调器提交前自查指出测试runner在CREATE SCHEMA失败时仍可能finally DROP同名现存schema。先添加真实碰撞测试：只对本轮创建的schema写入哨兵，子进程固定随机值碰撞该名称；修正测试自身空目录清理后，观察业务RED（schema计数0而预期1）。runner增加本轮CREATE成功标志与namespace OID/owner验证，失败保留原schema并关闭连接；最终碰撞测试证明原schema及哨兵值42保留，全部4/4 GREEN。

最终执行结果（均真实执行，非仅编写）：

| 命令/套件 | 结果 |
| --- | --- |
| `node .superpowers/sdd/catalog-runner.cjs` | 4 tests passed、0 failed；模块guard、创建碰撞保留、存量迁移、实际HTTP/DB目录流程。108处assert调用（含循环），没有把这些调用误称独立测试数 |
| `node .superpowers/sdd/catalog-regressions.mjs` 的 staff-access.test.ts | 3 passed、0 failed |
| `node .superpowers/sdd/catalog-regressions.mjs bootstrap-owner.test.ts integration.test.ts` 的 bootstrap-owner.test.ts（环境修正后） | 4 passed、0 failed |
| `node .superpowers/sdd/catalog-regressions.mjs integration.test.ts`（环境修正后） | 1 passed、0 failed |
| `node --import tsx --test apps/api/tests/domain.test.ts` | 9 passed、0 failed |
| `node scripts/integration.mjs`（权限校验顺序修复并构建后） | 11 passed、0 failed；独立端口API与自动清理test_acceptance_* schema |
| `node apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json` | 构建通过 |
| `node apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit` | 最终类型检查通过 |
| `git diff --check` | 无空白错误；既有/协调器文件仅CRLF规范化提示 |

目录实际API测试覆盖：分类排序/改名/启停/显式可见/空集合/恢复全部/未来门店，旧报价停用与隐藏拒绝，引用删除保护与空分类删除，Unit新建/trim/改名/禁用/同名冲突/引用保护/空单位删除，分类及单位同版本并发至多一方成功，并发同名单位只建一条，5轮单位引用创建/删除竞争无500，跨品牌目标/商品选择拒绝，CLERK/部分门店OWNER拒绝共享配置写入，受限查询不泄漏门店ID，旧版本失败无审计，旧/新会话均受撤权及停用约束，停用分类后已有订单取消/现金/接单/备好/完成，关联单位改名历史快照不变，停用单位旧商品报价可用，单独改名/价/库存可用，未知单位文本明确报错，旧无unitId记录可读，CORS真实DELETE预检204且允许DELETE。

## 运行隔离与现存数据

实现者仅在本轮创建的随机 test_catalog_* schema 测试和清理。runner仅在本轮CREATE成功且namespace OID/owner保持一致时清理；已有同名schema碰撞不会进入DROP，真实子进程哨兵测试覆盖。模块顶层在注册任何测试/创建数据库客户端前验证schema；另用不可达地址+development/public/缺省schema子进程证明安全拒绝发生在任何数据库连接前。

协调器要求既有 staff/bootstrap 保持精确schema guard，因此另建本轮临时数据库，在其中使用 test_staff_access、test_bootstrap_owner、test_catalog_source。记录创建成功后的OID及owner，清理前再次确认身份且无连接，不终止未知进程。以下均已删除：

- test_catalog_regression_f3fa066b5cadc7eb，OID35577、owner OID10。
- test_catalog_regression_6f3f970bc5c6a59b，OID36220、owner OID10。
- test_catalog_regression_3b8445534680df17，OID36862、owner OID10。

实现者未重置或清理 development/public/既有备份恢复库。Prisma generate 先通知协调器；仅在协调器停止其拥有的API后执行一次成功，之后未再generate。协调器自行执行development第6次迁移、构建和恢复API3000，并独立报告：health database=connected，与已验证备份恢复库的5订单、3现金合计8380、stock14/reserved0及CMS仍一致。该源库核对证据由协调器掌握，本报告不替代其独立验收。

## 自检与待后续

已逐项核对任务简报，职责分离为控制器、管理服务与公用目录规则，未扩展 MerchantController 为设置管理文件；产品PATCH的解析结果在事务内复制，不把可变派生值带入Serializable重试。迁移在既有5次迁移之后可应用；旧单位文本兼容，无金额或订单快照格式变更。引用保护保留数据库外键；版本、关系及审计处于同一事务。

本报告是实现者自检与执行证据，独立任务审查由协调器随后执行；不能把自检代替独立审查。Task 2 将提供 Web/商户H5界面及真实UI验收，目前未对新增目录管理宣称UI已验证。上线、微信环境与生产验收仍未进行。原有 Prisma package.json#prisma 弃用提示来自固定6.19运行配置，未升级依赖。

## Task 1 独立审查修复（2026-10-20）

独立审查发现迁移保留测试的嵌套 `${schema}_migration` 夹具仍在 finally 无条件 DROP：CREATE 因名称碰撞失败时，会误删预先存在的 schema。外层 runner 已有创建成功标志及 namespace 身份核验，内层没有。现记录本轮 CREATE 成功状态、namespace OID 与 owner；仅成功创建且清理前身份一致时执行 DROP，身份变化时报错保留，并在独立 finally 关闭连接。

新增真实 PostgreSQL/子进程回归：父测试创建自己的随机迁移 schema 与值为42的 sentinel，再让仅执行迁移保留测试的子进程碰撞它。断言子进程因 `already exists` 失败、原 namespace OID/owner 与 sentinel 均保留。父测试清理也核验所有权；原外层碰撞回归保持不变。

另一个根因是可空的 Product.unitDefinition 没有显式 onDelete，Prisma 默认生成 SET NULL，与迁移006的 RESTRICT 不一致。仅在 schema.prisma 声明 `onDelete: Restrict`，未修改迁移006。新增只读 Prisma migrate diff 回归检查生成外键，防止此声明再次漂移；无需生成客户端。

实际 TDD 证据：先新增上述两个测试，在未修复实现时执行 `node .superpowers/sdd/catalog-runner.cjs`，退出1，6 tests、4 passed、2 failed。碰撞断言实际 namespace 为 undefined，预期为 OID40046/owner10，证明确实发生误删；SQL断言实际生成 `ON DELETE SET NULL`，预期 RESTRICT。随后实施两项最小修复，再运行同一命令，退出0，6 passed、0 failed，涵盖模块guard、外层碰撞、内层碰撞、SQL声明、存量迁移与实际API。

最终实际执行的检查：

| 命令 | 结果 |
| --- | --- |
| `node .superpowers/sdd/catalog-runner.cjs` | 退出0；6 passed、0 failed；GREEN主schema为 test_catalog_e99805a221f8 |
| `node apps/api/node_modules/prisma/build/index.js migrate diff --from-empty --to-schema-datamodel apps/api/prisma/schema.prisma --script`（输出通过 PowerShell Select-String 读取 Product_unitId_fkey） | 退出0；生成 `ON DELETE RESTRICT ON UPDATE CASCADE`；只读，未执行生成SQL |
| `node apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit` | 退出0，无类型错误 |
| `git diff --check` | 退出0，无空白错误；协调器 progress.md 仅提示既有CRLF转换 |

清理结果：RED主schema test_catalog_f64b0d39f0af 与 GREEN主schema test_catalog_e99805a221f8 均由 runner 清理。GREEN 碰撞子进程失败后原schema/哨兵保留，再由创建它的父测试核验身份并删除；正常迁移夹具也清理完成。通过只读 pg 查询 `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'test_catalog_%' ORDER BY nspname` 最终得到 `remainingCatalogSchemas: []`。仅使用本轮创建的隔离对象；未删除/重置 development、public 或保留恢复库，未停止 API3000、未执行 Prisma generate。按简报未重跑无关全套回归。实现者未发现遗留疑虑，仍需协调器独立审查确认。
