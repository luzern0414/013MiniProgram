# 商品规格与口味 UI — Task 2

Status: DONE，提交实现供独立审查；真实页面/API/SQL验收由协调器继续。未标记 REQ-034/035/036 已验证，未声称整项目或微信真机完成。

Base: ca71e5d18ec1fb516c81ca6d5f58e4e833dbb3b4。需求来源 `.superpowers/sdd/product-options-ui-brief.md`；按已审查 Task1 的 `docs/architecture/api-contract.md`、`docs/tasks/product-options-api-report.md` 实现。

## 实现与入口

- 电脑端「商品与库存」每个商品的「规格与口味」按钮，aria-label 为 `配置{商品名}规格与口味`；使用既有 Modal、表单、绿色主按钮和面板 token。主体按规格维度、组合与价格、口味选择、加料分区。
- 商户小程序「商品」每个商品同名按钮，aria-label 同电脑；使用既有底部 sheet 与 AccessibleInput。抽出独立规格/口味组、SKU组合子组件，最小文字14px，标题18/24px。
- CLERK 不展示维护入口，商品页明确显示「当前无维护权限，规格、口味与库存由店主管理」。不向 CLERK 发送仅 OWNER 可用的 options GET。已打开编辑器若 owner 变为 false 或服务端返回 FORBIDDEN/UNAUTHENTICATED，进入只读；显示权限或登录错误，不伪造可读权限。真实授权仍由服务端负责。
- 组、值、SKU、口味组/选项和加料均可停用/恢复；已持久化身份没有移除按钮。只允许移除尚未保存的新节点；移除新规格维度会同时清理草稿 SKU 对它的引用。
- 组合先显示理论总数和最多20项待添加预览，逐项明确添加，不自动批量生成。保存前校验缺维度、失效/重复引用、重复组合、停用值、无维度时重复名称，以及名称、金额、排序、上下限与数量限制。停用维度造成组合合并会提示调整重复组合。
- 口味最少/最多选择直接映射服务端规则，用「必选，至少N项，最多M项」或「可不选，最多M项」解释。没有额外 required 真值。
- 加料配置编辑名称/价格/启停；新项输入初始库存。已有项展示可售/预占，并提供单独「保存加料N库存」的即时真实 PATCH。保存库存不会重建或覆盖尚未保存的配置草稿。
- 现有 SKU 价格/库存入口保留：电脑商品列表「调整」。商户小程序组合区明确提示已有组合库存可在电脑端商品页单独调整，没有假装提供不存在的小程序 SKU 库存端点。

## 表单标签与操作定位

N、G、V均为从1开始的可见序号，不以业务名称是否重复作为唯一性前提。

| 区域 | 两端文本输入标签 | 其他控件 |
| --- | --- | --- |
| 规格组 | `维度G名称`、`维度G排序` | 添加维度；启用/停用/恢复维度G |
| 规格值 | `维度G规格值V名称`、`维度G选项V排序` | 添加规格值；启用/停用/恢复维度G选项V |
| SKU | `组合N名称`、`组合N售价（元）`、新项的`组合N初始库存` | Web选择框标签 `组合N · 维度G {维度名}`；mini picker aria-label `组合N选择维度G {维度名}`；添加组合/添加{组合预览名} |
| 口味组 | `口味组G名称`、`口味组G排序`、`口味组G最少选择`、`口味组G最多选择` | 添加口味组；启用/停用/恢复口味组G |
| 口味选项 | `口味组G选项V名称`、`口味组G选项V排序` | 添加口味选项；启用/停用/恢复口味组G选项V |
| 加料 | `加料N名称`、`加料N价格（元）`、已有项的`加料N可售库存`、新项的`加料N初始库存` | 保存加料N库存；启用/停用/恢复加料N |

Web 文本控件使用包含原生 input/select 的 label，点击可聚焦。mini 文本全部复用 AccessibleInput 的真实 H5 native input 标签同步/点击聚焦行为；input-id 按类型/序号区分。mini picker增加显式「请选择」项与受控索引，可以正确选择第一个规格值，并明确显示已停用旧值。相同序号的规格/口味启停控件也带类型前缀。

恢复控件为「重新读取并核对」「查看读取前草稿」「返回当前配置」。读取前草稿以相同分区表单只读展示，并保留此前库存输入用于核对。Web 底部退出为「返回商品」，Modal 顶部关闭按钮仍为「关闭」；mini顶部为「关闭」。配置提交为「保存规格与口味」。

## 真实合约与数据一致性

1. 读取 `GET /merchant/products/:productId/options?storeId=...`，使用商品稳定 Product.id；SKU selections 读取/提交均为 `{groupRef,valueRef}`。引用持久化 ID，不按 Prisma 字段猜测。
2. 保存 `PUT /merchant/products/:productId/options`，严格构建 `{storeId,expectedRevision,specGroups,skus,attributeGroups,modifiers}` 白名单完整树。所有已有节点保留原ID；已有SKU/Modifier永不发送 available、reserved、stock、initialStock。金额由元文本转换整数分。新节点不发ID；新规格组/值以草稿clientKey关联，本次提交后重新读取服务端ID，clientKey不作为远端业务身份。
3. 已有加料库存独立 `PATCH /merchant/modifiers/:id/inventory {storeId,expectedAvailable,available}`，expectedAvailable取已读取可售量；客户端检查 available+reserved 上限，最终CAS/库存并发由服务端验证。没有随配置树覆盖绝对库存。
4. 配置PUT成功后等待真实options GET，再等待真实商品列表GET完成，才解除busy并显示已保存。Web直接await列表API后赋值，mini通过显式await的reloadProductCatalog回调赋值，没有把emit或useResource.reload的计数返回值当成请求完成。
5. 配置/库存写入的 STATE_CONFLICT，以及 NETWORK/NETWORK_ERROR/TIMEOUT/UNKNOWN/INVALID_RESPONSE/SERVER_ERROR/INTERNAL_ERROR或未知错误锁定后续写入；不自动重发PUT/PATCH。错误保留requestId。普通前端校验失败或明确拒绝保留草稿供修改；权限拒绝进入只读。
6. 重新读取是实际GET，并等待商品列表刷新。读取或列表刷新失败不解除原锁，不替换原草稿，不吞原库存输入；成功才记录previousDraft/previousInventory并以服务端树重建可编辑状态。配置PUT成功但确认GET失败也保持锁定，避免已提交的新节点因丢失回执被再次创建。
7. busy在请求前同步设置，双击仅提交一次。读取/写入及等待列表刷新期间向父级同步busy；Web禁用导航、切店、刷新、退出，mini沿用catalogBusy禁用导航/切店/退出并拦截页面返回；弹层关闭在busy/loading期间受阻。H5原生离开在写入期间触发beforeunload提示。浏览器强制关闭无法保证完成，未声称持久化跨刷新草稿。
8. 控制器记录store/product/generation；组件卸载dispose使旧响应不再写入状态或调用刷新。切店会通过既有key重建组件，旧组件卸载同时释放父级busy。mini微信业务使用Vue状态与uni请求，H5 window逻辑受条件编译保护；生成的微信ProductOptions.js和AccessibleInput.js未检出window/document/MutationObserver/beforeunload。
9. 超限旧树不截断，仍完整读取/展示；提交校验给出数量上限和调整提示，服务端保留最终校验。对于既有维度/值/口味/加料总数超过服务端总量上限的树，停用不会绕过服务端总量限制；客户端不会删除旧身份来强行保存。

## RED / GREEN 与实际命令

- 首轮 `node --test packages/mini-core/tests/product-options.test.mjs`：exit1，**0/12**。失败为新optionsPayload/optionsDraft/previewCombinations/createOptionsController尚未存在的功能断言（import失败被显式转为空模块，因此不是加载中断冒充测试失败）。随后实现，原12项全部GREEN。
- 第二轮增加移除新维度引用清理、库存冲突后旧输入核对等用例：**15/17**。RED为removeNewOptionsGroup不存在、previousInventory缺失；实现后二者通过，**17/17**。
- 第三轮新增「恢复也必须等真实列表刷新」：**17/18**，实际观察到错误提前解锁 `false !== true`；将恢复改为读取/验证/等待列表成功后再替换草稿，随后**18/18**。
- 最终 `pnpm --filter @restaurant/mini-core test`：exit0，**47/47**，其中本任务18项；覆盖全树库存剔除、新引用、组合缺选/重复/停用、8000理论组合有限预览、口味上下限、禁重、冲突和多种未知结果、失败恢复、权限/卸载/切店隔离、库存CAS输入、库存保存保留配置草稿、确认读取失败及列表刷新等待。
- `pnpm --filter @restaurant/merchant-web test`：exit0，**18/18**。Web与mini的新增编辑行为均使用同一个已测共享控制器；本Web命令是现有金额/会话/收银行为回归，不冒充Vue真实页面验收。
- 最终 `pnpm --filter @restaurant/merchant-web build`：exit0，vue-tsc和Vite成功，1618模块；首次接入时发现refresh回调Promise类型不匹配，已改为实际Promise<void>后成功。
- `pnpm --filter @restaurant/customer-mini build`：exit0，H5与mp-weixin均DONE；仅验证共享包导出兼容，不修改Task3顾客页面。
- `pnpm --filter @restaurant/merchant-mini build`：exit0，H5与mp-weixin均DONE；最后picker/标签/恢复调整后本命令再次exit0。
- uni构建只出现既有工具升级/uniCloud提示，没有编译失败；未更改依赖或配置。
- `git diff --check`：exit0。工作区既有CRLF提示不是内容校验失败；协调器正在修改的progress/验收文档未包含在本提交。

## 文件与自查

新增：Web ProductOptions.vue / ProductOptionsGroups.vue；mini ProductOptions.vue / ProductOptionsGroups.vue / ProductOptionsSkus.vue；mini-core product-options.mjs / options-editor.mjs、行为测试及本报告。

调整：两端商品页入口、Web App导航busy汇总、Modal可选locked关闭控制与禁用控件焦点圈定、mini页面返回与显式商品列表刷新、mini-core正式包导出。Modal的locked默认false，不改变其他业务弹层的关闭约定。未改后端、模型、迁移、README、配置、需求台账或协调器验收记录；未实现Task3购物袋/收银/订单详情选择。

自查已修复：新维度移除遗留引用、H5数字输入String类型、冲突后库存旧输入核对、重读前列表刷新等待、同序号跨区域标签重名、mini首个规格值选择、重复关闭按钮定位。写入错误及真实读取失败均不显示成功。

没有发现需要后端变更的合约缺陷。剩余协调器验收：真实Web/商户H5通过表单保存与刷新持久化、SQL稳定ID与库存/预占未覆盖、跨端同步、并发版本/库存冲突、真实丢回执/断网、在途导航锁与标签点击聚焦、CLERK/撤权展示；独立代码审查。运行中的API3000/Web5173/顾客5174/商户5175没有停止或重启。没有本轮真实页面或SQL结果，不能以构建与单元测试替代它们。

## 独立审查后测试修正

Task2独立审查Approved，无Critical/Important。Minor指出原卸载测试在切店后复用loading仍为true的控制器，第二次load被跳过，未覆盖真实卸载晚响应。本轮仅修改该测试文件及本报告，不修改UI/API或协调器文档。

- RED：在原测试第二次load后增加实际读取计数断言，运行 `node --test --test-name-pattern='owner restriction, disposal and scope changes' packages/mini-core/tests/product-options.test.mjs`，exit1，**0/1**；明确失败 `dispose coverage requires a second request in flight`、`1 !== 2`，确认原用例未发出第二个请求。
- 修正：保留原owner限制/切店晚响应场景并独立命名；新增独立控制器的卸载测试。先成功初次读取，再发出真实待完成的第二次load，并断言读取次数为2且解析器存在；随后dispose，再返回版本3和不同加料名，等待该promise完成。断言draft与卸载前完整快照相等、previousDraft未更新、onChanged列表刷新调用数为0。这次待完成重读在未卸载情况下会更新草稿且触发刷新，避免以初次load本来不刷列表造成空洞断言。
- GREEN：`node --test packages/mini-core/tests/product-options.test.mjs`，exit0，**19/19**，无跳过/失败。未重跑整套测试或五产物构建；生产代码无改动。
