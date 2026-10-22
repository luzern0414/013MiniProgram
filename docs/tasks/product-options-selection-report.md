# 商品规格与口味选择 — Task 3

Status: DONE，实现已提交供独立审查；真实页面交易、SQL与需求验收由协调器执行。没有将 REQ-034/035/036 标为已验证，没有宣称微信真机或生产完成。

Base: e7b6db73c7d1a36b02cac0a2689f926a98760fda；分支 codex/restaurant。需求唯一来源 `.superpowers/sdd/product-options-selection-brief.md`。已消费 Task1/API、Task2/UI 报告、实际 catalog 合约、mini-core 正式导出和开发规范；仓库及父目录未发现适用 AGENTS.md。

## 实现

- 新增独立 `product-selection.mjs`，与经营配置完整树校验分开。按启用维度与真实 groupRef/valueRef 定位 SKU；拒绝缺失/停用/无库存规格、失效或库存不足加料、失效口味及组选择上下限。客户端预估仅为整数分商品价加加料价，报价仍是应收真值。
- 顾客新增独立 ProductSelection.vue。维度逐组选择，口味显示 Task2 共用 attributeRule 的必选/最少/最多规则，可选中/取消且超上限反馈；加料展示真实价格与库存状态。沿用 chip/chosen、购物袋 sheet 和关闭反馈，新增轻量按压反馈、prefers-reduced-motion 退化及成功 toast。所有新文字最小14px；口味和维度按钮的 aria-label 包含组名称与选项名称，Web 使用原生 label/select/checkbox。
- Web 收银同样有独立选择组件，通过真实 SKU、必选/可选口味和加料生成账单行。Web 原生复选框达到组上限后保持与受控选择一致；不能出现视觉已选但请求未选的状态。
- mini-core fingerprint/selectionKey 统一为 SKU + 排序去重加料 IDs + 排序去重口味 IDs。顾客页面和 Web 账单 DOM key 全部同步。旧购物袋缺 attributeOptionIds 读取为 []，不清空原购物袋。收银 `restoreSelectionCart` 仅对恢复出来的购物袋副本补 [] 和重算行 key；保留原 quote/orderKey/order/uncertain/submittedFen。未更改恢复存储版本或读取隔离约定。
- 购物袋保留 productId、skuName、属性组/选项名称快照、加料名称与 configurationRevision。新增前后端 quote 请求中的 attributeOptionIds。相同SKU不同口味保持两行；同搭配追加检查新读可售量，明确重选时刷新名称/版本且合并数量，不让旧元数据遗留。
- 菜单刷新读取实际 GET。刷新后逐行标记失效/版本变化，保留原选择和名称，提供「重新选择搭配」。重选成功才原子替换对应行；取消或校验失败不移除原行。下架商品无法重选时明确提示移除后选择其他商品。顾客和Web都阻止失效搭配继续报价，重新选择必选口味没有静默替代。
- PRODUCT_OPTIONS_CHANGED 提示「商品规格或口味已调整，请刷新菜单后重新选择并确认金额。」，保留 requestId。顾客强制刷新标记只有成功重读菜单后清除，失败不解除；Web 明确拒绝创建后也先要求刷新再核对金额。
- Web 新增 CREATE_REJECTED 状态事件，仅在无已创建订单时清报价/冻结金额/不确定状态并生成新幂等键。创建失败只对明确业务拒绝代码使用该事件；网络、超时、未知服务错误、401/403/NOT_FOUND/STATE_CONFLICT 保留原 quote/key。尤其既存订单的权限检查也可能返回 FORBIDDEN，因此不能将它冒充「未创建」而释放恢复。支付的原实际订单查询/现金凭证/冻结金额恢复流程保留。
- Web Orders、商户手机订单详情/列表、顾客详情均只显示当时 line.skuName、line.attributes 的组及选项名称、line.modifiers 快照，不按当前商品配置重新查名。旧订单缺 attributes 正常显示。Web Product/Sku/Modifier/Order 类型扩展对应选项与快照字段。

## TDD / 命令证据

1. 首轮先新增核心口味身份、旧存储、选择规则、配置错误、创建拒绝测试，再执行：
   `node --test packages/mini-core/tests/product-selection.test.mjs apps/merchant-web/src/domain.test.mjs apps/merchant-web/src/checkoutTransitions.test.mjs`
   RED exit1，18项中10通过/8失败。具体为不同口味错误合并 `1 !== 2`、旧购物袋 `undefined !== []`、选择函数不存在断言、PRODUCT_OPTIONS_CHANGED 落到默认文案、拒绝创建后 `true !== false`。新模块 import 缺失被捕获为空模块，观察到功能断言失败而非用加载中断代替 RED。实现后原18项全部 GREEN。
2. 新增 toggle/max/取消及明确拒绝分类用例：RED 6/7，toggleAttribute 为 undefined；实现后7/7。后来实际检查 orders.service.create 的「先查原幂等订单，再授权」顺序，补403/NOT_FOUND保持恢复断言，RED 7/8，`true !== false`；收紧允许释放的代码集合后8/8。
3. 新增同搭配追加库存与明确重选名称更新：RED 7/8，`Missing expected exception`（旧cart只限制99、不看可售量）；实现后8/8。
4. 收银旧恢复兼容用例：初次命名导入提示缺导出后，改为 namespace + 功能断言重跑取得有效 RED，4/5通过，restoreSelectionCart 为 undefined；新增恢复副本转换后5/5 GREEN，原记录的 quote/key/冻结金额/不确定状态不变。
5. 新增实际 useCustomer 状态测试（隔离 uni.request transport stub，不接数据库）：两口味报价请求、配置拒绝后清 pending 并要求刷新、失败刷新保留锁、重读后逐行失效及仅替换明确重选行；超时重启状态后重发同 quote/key，服务端成功才清原袋。既有会话竞态测试原fixture返回空菜单，新增购物袋失效校验使它提前拒绝请求；给该隔离fixture补真实最小商品后继续验证「晚报价不能覆盖已变更购物袋」，没有绕过新校验。

最终全部运行并读完输出：

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @restaurant/mini-core test` | exit0，58/58，0失败/跳过 |
| `pnpm --filter @restaurant/merchant-web test` | exit0，20/20，0失败/跳过 |
| `pnpm --filter @restaurant/merchant-web build` | exit0，vue-tsc + Vite成功，1622模块 |
| `pnpm --filter @restaurant/customer-mini build` | exit0，H5与mp-weixin均 DONE Build complete |
| `pnpm --filter @restaurant/merchant-mini build` | exit0，H5与mp-weixin均 DONE Build complete |
| `git diff --check` | exit0 |

uni构建只有既有版本更新/uniCloud托管提示。格式化使用临时 `pnpm dlx prettier@3.6.2 --write` 指定本任务文件，没有更改依赖、锁文件或配置；初次格式化因模板插值内比较符缺少空格失败，补空格后格式化和两种目标构建成功。

## 文件

新增：
- packages/mini-core/src/product-selection.mjs
- packages/mini-core/tests/product-selection.test.mjs
- packages/mini-core/tests/customer-selection.test.mjs
- apps/customer-mini/src/components/ProductSelection.vue
- apps/merchant-web/src/ProductSelection.vue
- 本报告

调整：
- packages/mini-core/src/index.mjs、tests/session-isolation.test.mjs
- apps/customer-mini/src/customer.js、pages/index/index.vue
- apps/merchant-mini/src/pages/index/index.vue
- apps/merchant-web/src/Cashier.vue、Orders.vue、types.ts
- apps/merchant-web/src/domain.mjs及test、checkoutTransitions.mjs及test、recovery.mjs及test

## 自查及运行环境

- 对照brief逐项检查行身份、旧存储、必选规则、真实SKU、失效搭配、快照与幂等恢复。自查修正：追加库存上限、明确重选后的旧元数据、原生checkbox超限后视觉状态、被停用原SKU的商品仍可按已存productId重新选择，以及权限拒绝不能证明没有既存订单。
- 页面原本较长，本轮将新选择面板独立，移出顾客旧SKU/加料选择逻辑，不做无关重构。
- 只读HTTP发现运行中customer5174旧缓存：`/src/customer.js` 引用 `/node_modules/@restaurant/mini-core/src/index.mjs?v=ab256fcd`，该响应仍是旧fingerprint且没有cartSelectionIssue、selectionLine、isDefinitiveOrderRejection。已给协调器实际响应证据，未自行停服务；协调器核对自有PID并重启顾客服务。随后相同HTTP路径实读三个新导出均为True，商户5175也含新导出。
- 生成的微信 ProductSelection.js 未检出 window/document/MutationObserver/beforeunload；H5与微信采用同一Vue状态及uni请求行为。
- 未直接读写development数据库，未造单、改商品、收款或履约；没有停止API/Web/mini服务。未stage协调器现有README/config/progress/研究/需求/验收文档变更。

## 限制 / 后续协调器验收

没有已知实现阻塞。自动测试是本地行为与状态测试，不代替真实页面或SQL验收。协调器继续执行梧桐里样例的顾客选择→Web现金收款→履约→完成、停用加料后的原订单取消/预占释放、旧报价拒绝、权限/跨门店、离线恢复、刷新持久化及SQL历史快照核对；独立审查尚待执行。没有AppID/真实支付/域名/服务器，productionVerified保持false。客户端库存/金额仅作选择预估与早期反馈，最终报价与并发库存由后端裁定。


## 真实页面验收后的空口味组文案修复

来源：协调器在真实顾客选择→Web现金收款→履约的订单 `cmvgmuc7o000p3mz8jpulet98` 验收中，观察到后端历史快照包含可选组 `{groupName:"用餐习惯",options:[]}`。共享 attributeSummary 原来显示「辣度：不辣 · 用餐习惯：」，使三端历史详情出现空标签。协调器提供该实际页面发现；本实现者没有重新造单或改动源数据库。

- RED：先新增与真实后端形状相同的快照测试（一个已选必选组、一个 options=[] 可选组），执行 `node --test packages/mini-core/tests/product-selection.test.mjs`，exit1，8/9通过；明确断言失败为 actual「辣度：不辣 · 用餐习惯：」vs expected「辣度：不辣」。同时测试仅有空可选组时摘要为空，以及原快照与调用前 structuredClone 深度相等。
- 修复：只在 shared attributeSummary 的显示映射前过滤 options.length===0 的组；保持后端/订单/购物袋原快照对象及其 options=[] 记录不变。页面均复用该摘要，没有修改页面、订单状态、库存、报价、选择或幂等逻辑。
- GREEN：`pnpm --filter @restaurant/mini-core test` exit0，59/59；`pnpm --filter @restaurant/merchant-web test` exit0，20/20。新增真实形状、全空摘要及快照不可变断言均通过。
- 构建：`pnpm --filter @restaurant/merchant-web build` exit0（vue-tsc/Vite，1622模块）；`pnpm --filter @restaurant/customer-mini build` 与 `pnpm --filter @restaurant/merchant-mini build` 均exit0，H5与mp-weixin全部 DONE Build complete；仅出现既有uni工具更新/托管提示。`git diff --check` exit0。
- 变更范围仅 product-selection.mjs、新增断言及本报告。没有修改源库、协调器文档或其他功能；本实现者未声称再次完成真实页面验收，后续由原reviewer聚焦复核。
