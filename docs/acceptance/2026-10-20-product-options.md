# 商品规格、属性与加料验收记录

日期：2026-10-20。当前完成 API、经营编辑器独立审查及真实经营页面/SQL验收；顾客与收银选择继续实施。REQ-034/035/036 暂不标记本地完整验收，productionVerified 均为 false。

## API 阶段已执行

实现提交 `99caace26255a23946a8e6b44d8a939864548b92`，独立 `product_options_api_review` 结论 Approved，无 Critical/Important。测试执行详情及 RED/GREEN 在 [实现报告](../tasks/product-options-api-report.md)。本次专项10项、领域9项、分类6项、源码HTTP8项、构建HTTP11项通过，API构建和类型检查通过；没有因审查再重复运行整套测试。

审查保留的范围外项目由协调器定点核对：`auth.service.ts` 在传入事务中重新读取有效会话/启用用户及实时门店授权，`assertStoreAccess`检查OWNER角色及本店授权，随后检查品牌归属；`main.ts`全局注册统一信封及错误处理，`http.ts`保留requestId。既有订单释放按原稳定SKU/加料ID与reserved条件更新，不按启用状态阻止已成立订单取消或结算；相关真实HTTP回归已有执行证据。分类/单位的既有启停和可见性规则继续沿用，分类专项6项通过。

非阻塞提示：Prisma仍输出既有 `package.json#prisma` 配置弃用提示，未宣称测试输出完全无提示；进入整分支审查时统一处理。

## 真实开发库迁移与保留

1. 协调器核对3000监听进程确为自己启动的 `node dist/src/main.js`，停止PID21440后允许实现者生成Prisma客户端。开发库在独立审查前未迁移。
2. 只读记录development/public的34张既有业务表、284行规范化哈希，记录不包含明文业务内容或会话凭证。脚本及基线分别为 `output/playwright/options-migration-preservation.mjs` 与 `output/playwright/options-migration-before.json`，本地忽略、不提交。
3. 升级前实际执行 `pnpm db:backup` 成功，备份 `data/backups/backup_36bdebe04f1cb1d45912f104020c5085/database.dump`，SHA256 `d62c9b5aa2c7ccbd18572ef99c5e33a300e97a81cbabb8b2b335bf9b4f42c01a`。此备份仅验证了成功导出；没有把它标成另一次已恢复演练。
4. 独立审查通过后执行 `pnpm local:migrate`，仅development应用 `202610200007_product_options`，7次迁移成功；未reset、未seed、未改public或保留的恢复库。
5. 运行保留脚本after阶段，剔除明确新增字段后，34张表、284行旧字段序列化哈希一致，`preserved:true`。后续检查发现早期保留脚本没有正确序列化Date，该输出不能证明时间原值保留；非时间字段、行数及独立SQL证据仍有效。新增规格/属性表是空表；旧SKU/加料默认启用、配置版本0。
6. SQL再次核对：原development订单5笔、现金3笔共8380分；原桂花鸡腿饭3080分、stock14、reserved0；public订单4笔。CMS发布内容保持。原保留恢复库与上述业务基线仍相等；源会话28、恢复会话0。已有分类验收新增商品保留。
7. 实际重启API，当前会话18945；`GET /api/v1/health`返回200且database=connected。首次探测误用了不带前缀的`/health`，得到404；改用实际路由后成功，此为探测路径错误。
8. 从现有Web OWNER会话发真实GET配置，返回200并带requestId；商品 `cmvgjl8io00093mjk1nf64hmm` 版本0，原SKU `cmvgjl8io000a3mjkrs3u2cs6` 仍为1880分、available9、reserved0、enabled=true。此请求只读，未创建新的会话或业务记录。
9. 现有Web CLERK会话GET配置403 FORBIDDEN，OWNER把此商品与另一门店ID组合查询同样403，均带requestId。顾客端真实GET菜单返回200，原SKU/配置版本0与空规格、属性树兼容。首次脚本对顾客H5使用相对`/api/v1`地址读到了开发页面HTML，修正为该客户端实际使用的3000端口API后通过；这是探测脚本没有沿用客户端基地址，并非接口返回了HTML。

## 经营编辑器已执行

实现 `e093727`，独立 `product_options_ui_review` 结论 Approved，无 Critical/Important。报告见 [经营编辑器报告](../tasks/product-options-ui-report.md)。经营配置行为测试原18项、mini-core全套47项、Web18项及Web/两小程序H5和mp-weixin构建通过。审查Minor指出卸载测试没有真正发出第二次待完成请求；`bb7f4c6`拆成独立控制器场景，观察RED `1 !== 2`，修正后专项19/19。协调器读diff确认实际请求计数、dispose前待完成、dispose后草稿/列表不更新的断言，关闭此Minor；仅测试修改，没有重复五产物构建。

所有业务写入均经真实页面表单和API，SQL脚本仅只读核对。

1. Web商品“验收新品·菌菇饭”（`cmvgjl8io00093mjk1nf64hmm`）新增份量维度、小份/大份组合；原小份SKU `cmvgjl8io000a3mjkrs3u2cs6`保持1880分、stock9/reserved0，新大份 `60798aac-99ba-45fd-bb0e-540b4354d0db` 为2380分、stock4/reserved0。新增必选辣度1至1（不辣/微辣）、可选忌口0至2（不加葱/不加香菜）、加蛋300分/stock5。真实PUT200，revision1。请求中既有SKU不含initialStock/stock/available/reserved，新项才有初始库存。
2. 商户H5从湖滨切至梧桐里，真实GET读取全部持久化身份；把“忌口”改为“用餐偏好”，PUT200 revision2，Web真实重读同步。H5标签唯一且点击“口味组2名称”聚焦真实native input，截图 `output/playwright/options-mini-saved.png`。持久化身份未变化。
3. 两个独立Web页面均持revision2。第一页停用“不加香菜”PUT200/revision3；另一页把属性组改成“旧页面偏好”提交409 STATE_CONFLICT，草稿仍是该输入，保存按钮锁定。真实GET恢复“用餐偏好”，恢复原选项PUT200/revision4。既有项仅停用/恢复，未删除重建。
4. H5把加蛋停用，在真实PUT发出前暂缓网络放行。处理期间关闭、顶部切店和工作台/订单/商品/门店四个导航均disabled。放行后PUT200/revision5，加蛋仍同ID且available5/reserved0；恢复后200/revision6，库存不变。
5. Web把属性组改成“用餐习惯”；路由转发真实PUT，确认服务端200/revision7后只中断回执。总PUT计数1，界面显示结果未确认、保存锁定、草稿保留。取消中断后真实GET核对同名称，等待商品列表刷新完后解锁，没有自动重发。
6. 加料库存独立PATCH：Web可售5→6成功200/reserved0；仍持旧可售5的H5填7提交409 STATE_CONFLICT，输入7保留并锁定；真实重读得到6。Web恢复可售5成功200。上述流程执行两轮，数据库MODIFIER_INVENTORY_UPDATE共4条；配置版本始终7，库存维护未覆盖配置草稿。
7. Web重新读取时中断真实GET，显示连接失败，保留“用餐习惯”草稿；取消中断后真实GET200/revision7，最终保存按钮解锁。CLERK实际商品页显示无维护权限且没有配置入口；发送完整合法配置PUT403 FORBIDDEN，带requestId `00334bd6-1ab1-45ea-a2c3-4141e41cd78a`。
8. `node output/playwright/options-sql-check.mjs`真实只读：所有组、值、SKU、属性与加料关系符合页面；原小份库存9/0、新大份4/0、加蛋5/0；两选项与加蛋均恢复启用；PRODUCT_OPTIONS_UPDATE共7次；当前该商品订单0。原development订单5笔、现金3笔8380分、public订单4笔保持。最终结果存本地忽略文件 `output/playwright/options-task2-sql.json`，未更改原保留恢复库。

执行偏差如实记录：H5开发服务器曾提供缺少attributeRule导出的旧模块，核对实际模块和自有监听命令后，仅重启merchant5175（session47323）并关闭该页缓存，随后功能正常。mini底部面板没有role=dialog，脚本改用实际`.product-options .sheet`；首次切店脚本猜测了不存在的“文昌”，读出实际门店名后选“梧桐里”，首次没有写入。丢回执脚本最初在商品列表刷新尚未完成时提前读到按钮仍锁定，追加等候与后续场景证明最终解锁。首次CLERK写入探测只传storeId，先命中参数校验400；改用完整合法树后真实403。上述均未作为通过结果隐藏。

实际页面脚本为 `options-create-web.cjs`、`options-mini-sync.cjs`、`options-editor-conflict.cjs`、`options-mini-lock.cjs`、`options-lost-response.cjs`、`options-stock-offline.cjs`，位于本地忽略的`output/playwright/`；固定造数脚本不应盲目重复执行。

## 顾客与收银交易已执行

实现 `c8fb994`，空口味摘要修复 `9688d08`；独立 `product_options_selection_review` 对实现及修复均 Approved，无 Critical/Important。报告见[选择与快照报告](../tasks/product-options-selection-report.md)。协调器重新运行 mini-core 59/59、Web20/20通过；实现者已执行 Web及双小程序H5/mp-weixin全部构建。没有代码变化后重复五项构建。

1. 顾客H5真实选小份，不选辣度加入时提示至少1项；已选不辣再选微辣提示最多1项，第二项保持未选。可选两项均可选中和取消。小份不辣+加蛋、微辣+加蛋进入不同两行，相同不辣搭配再次加入合并为数量2；减量和移除后保留1份2180分。脚本 `options-customer-cart.cjs`，截图 `options-customer-picker.png`、`options-customer-cart.png`。旧本地购物袋缺属性字段、未知交易恢复及原键保留由共享行为回归验证，未清空未完成交易。
2. 顾客报价201/2180分，创建 `cmvgmuc7o000p3mz8jpulet98`（`R179249768840225776F01C0`）。商户Web输入30元现金收款，再接单、出餐、完成；顾客刷新为已完成/已付款。SQL凭证 amount2180/tendered3000/change820，恰好5个状态事件；小份可售9→8、加料5→4，reserved均0。
3. 顾客另建大份微辣+加蛋订单 `cmvgn0v0p00183mz8n7hkabee`（`R179249799271242D4575C38`），报价及订单2680分。SQL大份stock3/reserved1、加料stock3/reserved1，小份8/0。Web收银另选小份，漏选必选项提示至少1项；补微辣+加蛋真实报价201/2180分，未直接下单。
4. Web将辣度/不辣/微辣改名为辣味选择/清淡/少辣、加蛋改为卤蛋并停用，PUT200/revision8，身份不变。旧收银报价创建409 PRODUCT_OPTIONS_CHANGED，requestId `9c5f3792-a340-4c7a-adb0-258dd545b5bd`；界面提示刷新菜单再选配，没有新增订单或现金记录。
5. 顾客在真实详情点击取消并确认，原大份订单201/CANCELLED。SQL大份恢复4/0、停用加料恢复4/0，小份仍8/0。以同用户真实HTTP重复取消201/CANCELLED，仅1个取消事件；最终库存也未重复增加。Web重新启用卤蛋200/revision9，未改库存。
6. 收银真实刷新菜单，旧行明确标记需重新选择，原搭配保留；点击重选后选择小份/少辣/卤蛋，报价201/2180分。创建 `cmvgn9hf9001k3mz8zzkux4ax`（`R179249839499682E25CF451`），现金收款201，凭证2180/3000/820；界面显示成功与找零8.20元。再经Web接单/出餐/完成，SQL5个事件且已完成/已付款。
7. 改名后实际打开顾客、Web与商户H5的已取消和已完成旧详情，仍显示原“辣度：微辣/不辣 · 加蛋”；新订单显示“辣味选择：少辣 · 卤蛋”。SQL旧订单configurationRevision7及名称快照保留；空可选组options=[]仍保留在数据库，仅显示摘要跳过空组。截图 `options-customer-cancelled.png`、`options-customer-completed.png`、`options-web-completed.png`、`options-mini-cancelled.png`。
8. 顾客真实HTTP缺选、重复属性均400 VALIDATION_ERROR，跨类型无效选项400；另有API隔离库真实HTTP测试覆盖真正跨商品属性、售罄/停用SKU或加料、库存只变不使报价失效及原子库存竞争（见Task1报告），没有为此修改运行库其他商品。完整合法配置配另一门店PUT403 FORBIDDEN，requestId `fdc7fc74-26ab-46f1-8dad-22aaea495896`；CLERK有效树写403见经营阶段。顾客菜单GET网络中断显示连接失败及编号，解除中断后真实GET200恢复菜单；失败没有伪成功。
9. 最终只读SQL：development8订单、现金5笔12740分，public仍4订单；样例小份stock7/reserved0、大份4/0、卤蛋3/0，原持久化身份不变；PRODUCT_OPTIONS_UPDATE9、加料库存维护4条。新增3订单中2完成/付款、1取消/关闭，现金新增2笔4360分。SQL本地文件 `output/playwright/options-task3-final-sql.json`、`options-task3-receipts-sql.json`。旧保留恢复库代表先前5订单/8380分时点，不再把它与本次真实交易后的源库宣称完全相等，不删除该恢复库。

脚本偏差及修复：首笔交易脚本在履约完成后因详情组合文本的exact定位超时，未重跑交易；SQL及真实刷新核实完成。验收发现摘要显示“用餐习惯：”空组，独立实现者先RED复现再修复，review通过；重启确认为本任务拥有的customer5174及merchant5175进程并禁缓存后，真实三端显示通过（新会话98322/33717）。收银首次份量控件定位、重选按钮accessible name及离线重试多按钮定位超时均在写入前，读取实际DOM后继续未执行步骤，没有盲目重新造单。负例探测首次把浏览器Response.status误用为方法，修正后执行，仅多发1次被拒报价。付款截图较早捕获过渡动画，凭证以稳定DOM和SQL核对。

REQ-034/035/036在所述本地HTTP、PostgreSQL、三客户端H5范围标记verified_local；微信产物构建不代替真机运行。品牌商品模板、导入等其他需求继续列差距；本模块验收不表示全部90项完成。

本记录的API探测不代替页面验收，也不代替微信真机、真实支付、地图、通知或生产环境验收。用户明确先完成本地功能，相关资源缺口不阻止后续本地模块继续开发。
