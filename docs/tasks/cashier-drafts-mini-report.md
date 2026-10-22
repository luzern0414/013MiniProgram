# Task 3：商户小程序独立收银与跨设备挂取单

状态：实施、行为测试、自查与五构建完成，待 root 独立审查及真实跨端页面/只读 SQL 验收。未声称真机或生产验收完成。

## 基线与边界

- 派发基线 `4970b52991d0de407eb6ae8bb38887d2271d7aac`，分支 `codex/restaurant`；root 同期 `e563576` 仅文档，保持原样。
- 首读 `.superpowers/sdd/cashier-drafts-mini-brief.md`、`D:/Codes/开发规范.txt`、implementer contract、TDD、verification-before-completion；遇回归测试问题按 systematic-debugging 定位。执行已批准 Task3 设计，不重新设计或再派子代理。
- 未执行源库读写、生成订单、现金、退款、迁移、seed、reset、generate、依赖变更、服务启停。真实数据操作、SQL、README/config/需求台账与验收由 root 负责。A 草稿未被实施者操作。
- 未修改 API、Web、顾客小程序生产源码或共享草稿控制器；未暂存两份旧 catalog review diff。测试仅使用隔离内存 transport/storage，不连接真实 API。

## 实施结果

`cashier.js` 是移动适配层，所有草稿创建、CAS、取消、报价、转换及未知恢复复用 Task2 的 `createDraftController`。没有第二套草稿状态机。uni 存储先检查 `getStorageInfoSync().keys`；不存在返回 undefined，存在的空串/null 是损坏。键枚举不可用或读取异常按损坏锁定。写前、清除后回读沿共享控制器，不改变原 identity-wide `cashier-draft:v1:<userId>` 与 attempt 载荷。

移动购物袋复用 `selectionLine`、`cartSelectionIssue`、`selectionKey`、`hydrateDraft` 和 `createPickupSelection`。取单完整保留 SKU/数量/属性/加料/堂食桌码/预约/备注；失效选择展示服务端名称与原 ID、问题原因并允许明确修改/移除。失效行的金额显示“待重新核价”，不把无法解析的价格显示为零。无足够必选项、数量超99、SKU或加料库存不足都拒绝加入；已存失效选择仍允许挂单保留，由核价阻止下单。

`CashierSelection.vue` 只负责菜单、规格/属性/加料与购物袋编辑；`CashierDrafts.vue` 负责服务器分页列表、筛选、版本/时间、替换及取消确认、冲突和持久恢复入口；`CashierPanel.vue` 负责服务方式、桌台、预约、备注及保存/核价/转单/真实订单呈现。index.vue 仅接“收银”入口、面板和导航锁。原工作台、订单、商品、门店入口保留；顾客端没有员工草稿入口。

挂单必须名称1–60字。独立开单“保存并核价”先创建服务器草稿；已选草稿的本地变更先 CAS 保存再草稿 quote。冲突保留本地购物袋/输入并显示最新远端版本与选择，明确重新载入时再次 GET 当前版本。非空袋取单必须确认替换；取单慢读期间导航与关闭锁定，adapter 另以 accept ticket 保证取消或 dispose 后迟到响应不能发布 remote/edit/quote/order/cart。已转换/取消草稿禁编辑；开始下一单要明确清除确认。

转单仅发送原报价与生成一次的 order key；unknown 由共享 attempt 保存原 quoteId/key/body。刷新/重新登录发现原员工待核对操作，授权仍在时定位原店、进入收银。恢复默认只读草稿与真实绑定订单；仍 DRAFT 不解除 unknown 锁。显式“恢复原下单”才以原请求重放，不调用现金。CONVERTED 显示真实 orderId、真实总额和付款状态，点击“查看订单与收款”后进入现有订单现金入口，实收清空并需再次明确填写确认；不借用旧报价或旧冻结实收。

## 锁、账号与既有现金保护

`useMerchant` 持有按员工/门店绑定的 adapter。切店先 dispose，再建新 scope；新店读取失败也不恢复旧袋。会话失效 dispose 并清可见私有状态，恢复存储保留。异步菜单/取单按身份、门店和 alive/ticket 复核，原 load 也补身份复核。

草稿 busy/blocked、菜单/预约读取、原 busy、员工/商品/预约/核销 busy、refund busy/blocked、pendingCash 与 loggingOut 用 OR 合并。onBackPress、H5 beforeunload、切店/切页/退出遵守同一锁。原未知现金、退款仍有可发现恢复入口；当未知现金与未知草稿同时存在，现金恢复按钮只被活动请求/其他原锁禁用，不能被草稿 unknown 单独锁死。现金核对完成后可回原店核对挂单，反向不会通过取单替换现金订单。

root 明确要求同步修复原 `cash()` 既有恢复分支：已有 pendingCash 的 FORBIDDEN/NOT_FOUND/VALIDATION_ERROR 不再清除原 attempt。401、离线与 STATE_CONFLICT 后 GET 失败同样保留原 orderId/key/tendered 与本机恢复入口；重新建立同身份后仍锁定，权限/网络恢复后用户明确点击原请求恢复。新首次请求的明确拒绝保持原处理。没有修改后端现金业务规则或扩展现金状态机。

## TDD 证据

首次仅建空导出 adapter 与行为测试：

```text
node --test packages/mini-core/tests/cashier-drafts-mini.test.mjs
tests 10 / pass 0 / fail 10 / exit 1
AssertionError: uni storage adapter is available
actual 'undefined' / expected 'function'
AssertionError: mobile adapter must use shared draft controller
```

实现 adapter 后同命令10/10。补真实 useMerchant 接入测试后 RED：13项中10通过3失败，原店实际 s2/期望 s1、merchant adapter 缺失；接入后13/13。后续自查分别先加 RED：正式订单仍发取单GET、堂食专店初始PICKUP、重新载入未GET新版本、切店加载失败无当前收银scope；逐项修后通过。

原现金恢复 RED（root 确认原边界后）：

```text
node --test packages/mini-core/tests/cashier-drafts-mini.test.mjs
tests 22 / pass 21 / fail 1 / exit 1
AssertionError: FORBIDDEN: original attempt must survive refusal
actual undefined / expected {orderId:'original-cash', storeId:'s1', key:'frozen-original-key', tenderedFen:9900}
```

GREEN22/22，循环403/404/400/401/离线，真实 useMerchant+uni存储重建同身份、原金额/key恢复。新增实际 index 模板现金恢复按钮表达式测试 RED：草稿 blocked 时 disabled=true；改按钮只看草稿活动写 busy 后 GREEN23/23。另覆盖 failed GET 保留、原 key/body 精确重放及真实付款订单返回。

完整共享suite曾132/133失败：旧 session-isolation 夹具缺少真实 uni 的键枚举接口，新保护正确 fail closed 造成旧测试退出被锁。只补该夹具与 merchant-staff-session 的 `getStorageInfoSync`，保留测试原业务断言，恢复全通过。

## 最终验证

| 命令 | 结果 |
| --- | --- |
| `node --test packages/mini-core/tests/cashier-drafts-mini.test.mjs` | 23/23，exit0 |
| `node --test packages/mini-core/tests/*.test.mjs` | 143/143，exit0，最终现金按钮修正后重跑 |
| `pnpm --filter @restaurant/merchant-web test` | 51/51，exit0 |
| `pnpm --filter @restaurant/merchant-web build` | vue-tsc及Vite通过，exit0 |
| `pnpm --filter @restaurant/customer-mini build:h5` | DONE，exit0 |
| `pnpm --filter @restaurant/customer-mini build:mp-weixin` | DONE，exit0 |
| `pnpm --filter @restaurant/merchant-mini build:h5` | DONE，exit0，最终修正后重跑 |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | DONE，exit0，最终修正后重跑 |
| `git diff --check` / 暂存后 `git diff --cached --check` | 无空白错误 |

uni 编译输出仅有工具自身升级/托管宣传和微信工具导入提示，未升级依赖；不把构建视为真机或真实业务验收。生产源码新增组件全部字号最低14px；列表/选择反馈支持 prefers-reduced-motion。顾客源码搜索没有 cashier 员工入口。

## 文件与自查

- 新增 `apps/merchant-mini/src/cashier.js`。
- 新增 `apps/merchant-mini/src/components/CashierPanel.vue`、`CashierDrafts.vue`、`CashierSelection.vue`。
- 修改 `apps/merchant-mini/src/merchant.js`、`pages/index/index.vue`。
- 新增 `packages/mini-core/tests/cashier-drafts-mini.test.mjs`；两份既有会话测试仅补 uni 键枚举合约。
- 本报告。

自查已补正式订单覆盖、最初服务方式、CAS后重读、取消旧报价、切店失败scope及并存unknown恢复入口测试。没有共享 API 兼容变更。既有 index/merchant 文件较大，仅接入口与合并锁，完整移动收银状态位于 adapter/组件。

仍需 root 独立审查及真实 Web保存→商户H5取单编辑→Web旧revision冲突/重读→转单→原现金入口收款、刷新/重新登录、跨权限拒绝、转换竞争，以及只读SQL验证唯一订单、库存/预约/序号一次性变化。测试中的跨设备CAS与丢回执是明确隔离的内存夹具，不能代替这些真实证据。AppID、生产域名、微信支付和真机资源限制沿既有事实保留。

## 2026-10-21 独立审查 Important 修复：正式订单只读快照

按 root 派发的 `.superpowers/sdd/cashier-drafts-mini-display-fix-brief.md` 修复 Task3 `8796b0d` 的展示缺陷，派发基线 `734f640b8894029e9b66f8a3a357f069577c599a`。同期 root 文档提交保持原样，不暂存 root 台账、验收或两份旧 catalog diff。继续遵循开发规范、systematic-debugging、TDD、verification-before-completion 和 implementer contract；未再派代理。

根因：共享 controller 的 `recover('read')` 已发布真实 `drafts.order`，adapter 按恢复协议保留原购物袋和 edit；Panel 却无条件渲染原 `CashierSelection`、编辑表单及 `drafts.quote`，造成正式订单2份2400分与旧袋1份/旧核价1200分同时出现。本次只改变展示来源，无须清除恢复输入或改写共享 quote。

新增小型 `CashierOrderDetails.vue`，只读传入服务端订单，展示商品、历史规格/属性/加料及加料金额、数量、每行金额、订单总额、订单/付款状态、堂食桌台或取餐号/日期/历史窗口、备注。`CashierPanel.vue` 有正式订单时显示该组件并保留“查看订单与收款”；原购物袋/数量/估价、编辑表单、旧核价和生成订单操作全部位于无订单分支。真实0元按0元显示。组件最低14px且无新增动画；原 reduced-motion、开始下一单确认、原现金入口和未知现金金额/key保护均保留。

没有修改 adapter、merchant/index、共享生产代码、Web、API或顾客生产代码。没有源业务/API/SQL操作、迁移、seed、generate、服务启停或依赖变更，未操作 A 草稿。真实跨端页面与只读 SQL 仍由 root 承担。

### 实际组件 TDD

新增 `packages/mini-core/tests/cashier-drafts-mini-render.test.mjs`。使用商户项目已安装的 Vue `3.4.21` compiler/runtime，编译并执行磁盘上实际 Panel 及子组件的 setup/template，以 SSR 检查真实渲染结果；仅把 uni 原生 view/text/picker 识别为元素。Vite 仅 middleware 模式，不监听端口，不接运行中的开发服务；transport/storage 为隔离内存夹具，不访问真实 API。未复制模板或只用源码正则代替行为测试。测试加载器初期的 Vite CJS 入口/uni picker 解析问题已在生产修复前排除，以下 RED 为有效业务失败。

```text
node --test packages/mini-core/tests/cashier-drafts-mini-render.test.mjs
tests 5 / pass 1 / fail 4 / exit 1
AssertionError [ERR_ASSERTION]: 订单明细
```

其中无订单场景原购物袋和核价操作通过；其余4项确实缺少真实订单明细。新增组件和条件分支后同命令 GREEN `tests 5 / pass 5 / fail 0 / exit 0`，无 Vue/Vite 警告。

恢复组合用例先以原quote/key制造明确隔离的转单丢回执，再通过实际 `cashier.recover('read')` 读取另一员工已转换的远端2份挂单和2400分订单。断言仅原尝试有1次写请求、恢复全为GET、原cart1份/edit/quote1200仍保留，实际模板仅显示订单2份/行额2400/总额2400和历史数据，无旧袋/核价/编辑/转单操作；不会自动进入或确认收款，明确 `showOrder()` 才交给原入口。另外覆盖：无订单时原选菜和核价按钮可用；PICKUP历史窗口；PAID/COMPLETED与CLOSED/CANCELLED真实事实及0元行额/总额；外部原现金锁仍禁查看、下一单、保存和转单。原23项继续验证未知现金的实际原金额/key重放、reload、拒绝与GET失败保护。

### 本次最终验证与自查

| 命令 | 实际结果 |
| --- | --- |
| `node --test packages/mini-core/tests/cashier-drafts-mini-render.test.mjs` | 5/5，exit0 |
| `node --test packages/mini-core/tests/cashier-drafts-mini.test.mjs packages/mini-core/tests/cashier-drafts-mini-render.test.mjs` | 28/28（原23+新增5），exit0 |
| `node --test packages/mini-core/tests/*.test.mjs` | 148/148（原143+新增5），exit0；补强远端2份夹具后最终重跑 |
| `pnpm --filter @restaurant/merchant-mini build:h5` | `DONE Build complete.`，exit0 |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | `DONE Build complete.`，exit0 |
| `git diff --check` / `git diff --cached --check` | 无空白错误 |

构建仅有既有 uni 升级/托管宣传和微信开发工具导入提示，未升级依赖。此次生产改动仅两个 merchant-mini 组件；Web和顾客无改，未重复其构建，原 Task3 五构建范围与结果见本报告“最终验证”表。自查逐项确认订单快照来自 `drafts.order` 而非当前菜单/原袋，恢复证据没有被清除，原状态机与金融锁未更改。SSR验证不能替代视觉布局、真实跨端页面、SQL或微信真机验收，以上事项仍待 root 独立复审后完成。

## 2026-10-21 手机正式订单长编号换行最小修复

按 `.superpowers/sdd/cashier-drafts-mini-wrap-fix-brief.md`，基线 `8cc45f4`，仅调整 `apps/merchant-mini/src/components/CashierOrderDetails.vue` 的局部样式。遵循 systematic-debugging、verification-before-completion 与 implementer contract。未派发其他代理。

根代理已记录的真实失败证据：390px 商户 H5，正式订单编号 `R1792517893201757668AB03` 的首行 `.sheet-title` 容器宽312、scrollWidth392，26px 字号，`white-space: pre-line`、`word-break: normal`、`overflow-wrap: normal`，文档 scrollWidth431。连续无空格编号缺乏断行位置，造成溢出。该证据来自根代理已查看的真实页面与截图；本实现者没有操作浏览器或重复收款。

组件根节点增加可继承的 `word-break: break-all` 与 `overflow-wrap: break-word`，使编号、商品名、规格/属性/加料、桌台、取餐历史及备注中的长连续文字可以在容器内换行。使用兼容 H5/mp-weixin 的基础 CSS，保留原完整文本、字号和行高，没有截断、隐藏或全局横向溢出遮盖。模板、脚本、订单快照来源、金额/状态、挂单恢复和现金未知结果锁均未修改。

### 本次实际验证

| 命令 | 实际结果 |
| --- | --- |
| `node --test packages/mini-core/tests/cashier-drafts-mini-render.test.mjs` | 5/5，fail0，exit0，执行一次 |
| `pnpm --filter @restaurant/merchant-mini build:h5` | `DONE Build complete.`，exit0 |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | `DONE Build complete.`，exit0 |
| `git diff --check` / `git diff --cached --check` | 无空白错误，exit0 |

构建输出仅有既有 uni 升级/托管宣传及微信开发工具导入提示。按任务范围没有新增 CSS 源码断言，也未将 SSR 的5项行为测试或双构建当成布局验收。本次 RED 依据是根代理提供的真实390px溢出测量；本实现者没有新增自动布局测试。修复后的真实390px页面是否完整换行、是否消除横向溢出，仍须根代理独立审查后复验；微信真机未验收。

自查：生产 diff 仅为该组件根节点两项换行声明，动态文字继承规则；既有 display/margin 和14px最低字号保留。未改业务逻辑或合同，未访问源 API/DB/数据/库存/令牌，未 generate/迁移/seed、启停服务或增加依赖，未操作根代理 Playwright。仅提交组件与本报告，不暂存两份旧 catalog-api untracked diff；不重复无新风险的全 suite。

## 2026-10-21 刷新恢复创建后的购物袋名称最小修复

按 `.superpowers/sdd/cashier-drafts-mini-restored-display-brief.md`，基线 `53abddc`，遵循 implementer contract、systematic-debugging、TDD 与 verification-before-completion。根代理已定位真实 E 创建丢回执后刷新、明确恢复成功但购物袋仍为“原商品 · 原规格”的问题；本实现者未访问真实 E、API、DB、浏览器或服务。

根因复核：pending 初始化先在空 catalog 下 `applySelection`，得到保留原 ID 的 fallback cart；菜单加载只赋 catalog；`recover('replay'/'read')` 更新 controller 的远端事实而未更新 cart 名称。显式 reload 原本能更新，是因为它重新调用 `applySelection`。

生产改动仅 `apps/merchant-mini/src/cashier.js`：菜单加载成功、恢复读取/重放成功后，使用现有 `hydrateDraft` 重新计算本地购物袋的商品、规格、属性和加料显示字段。远端 display 通过现有 `selectionKey` 匹配 SKU/口味/加料组合，不能按远端行序或仅相同 SKU 套用另一搭配的名称；没有匹配则保留原显示信息。只复制呈现字段，原名称输入、选择 ID/数组/顺序/数量、mode、桌码、预约 slot、note、价格与 configurationRevision 均保持；不用 `applySelection` 重置预约选择状态。正式订单存在时跳过，保留其原袋审计快照。失效选择继续由现有 `lineIssue`/核价路径拒绝，不显示成已确认免费。没有新增请求，controller、幂等 key/body、恢复锁、scope/generation 和显式 reload 接受远端输入协议均未修改。

### 真实 adapter TDD 证据

测试直接调用实际生产 `createMiniCashier`、`uniDraftStorage` 与共享 controller，transport/storage 是隔离内存夹具，未复制恢复实现。

```text
node --test --test-name-pattern 'restored create|restored update read' packages/mini-core/tests/cashier-drafts-mini.test.mjs
RED: tests 3 / pass 0 / fail 3 / exit 1
loaded menu: '原商品' !== '面'
replay display: '原商品' !== '面'
update read: '原商品' !== '已下架原菜'
同命令首次实现后 GREEN: tests 3 / pass 3 / fail 0 / exit 0

node --test --test-name-pattern 'menu display refresh' packages/mini-core/tests/cashier-drafts-mini.test.mjs
自查追加 RED: tests 1 / pass 0 / fail 1 / exit 1
已知商品在空菜单刷新后名称被 fallback 覆盖：'原商品' !== '面'
补保留原名称/属性 fallback 后：
node --test --test-name-pattern 'restored create|restored update read|menu display refresh' packages/mini-core/tests/cashier-drafts-mini.test.mjs
GREEN: tests 4 / pass 4 / fail 0 / exit 0
```

新增4项覆盖：pending create 在空菜单初始化、loadMenu 后名称可读、原输入及持久化 pending 不变；无有效菜单时 replay 的远端 display 可核对但核价仍拒绝；原 key/body 精确重放且无额外写/收款/转换；unknown update read 在远端行序变化、同 SKU 另一搭配下只匹配原选择，GET 保留本地 name/mode/table/note/全部选择/pending 与写锁；失效行名称仍保留、价格不改、旧 configurationRevision 仍提示已调整。预约原 slot、needsRefresh 和 selected 状态均有断言。

### 最终验证、自查与提交范围

第一次 `node --test packages/mini-core/tests/*.test.mjs` 为151/152，实际 render 中“keep original bag for audit/recovery”断言发现正式订单恢复会更新原袋名称。修复为存在 `drafts.order` 时跳过呈现刷新，未放宽原 render 断言，最终同命令152/152、fail0、exit0。此为共享 mini-core 包回归，未运行 Web 或顾客应用 suite/构建。

| 命令 | 实际最终结果 |
| --- | --- |
| `node --test packages/mini-core/tests/cashier-drafts.test.mjs packages/mini-core/tests/cashier-drafts-mini.test.mjs packages/mini-core/tests/cashier-drafts-mini-render.test.mjs` | 56/56，fail0，exit0；最后补强 pending 存储断言后重跑 |
| `node --test packages/mini-core/tests/*.test.mjs` | 152/152，fail0，exit0；最终生产实现后重跑 |
| `pnpm --filter @restaurant/merchant-mini build:h5` | `DONE Build complete.`，exit0；正式订单保护后重跑 |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | `DONE Build complete.`，exit0 |
| `git diff --check` / `git diff --cached --check` | 无空白错误，exit0 |

uni 构建仅既有升级/托管宣传与微信工具导入提示，没有新增依赖或编译警告。仅提交 `apps/merchant-mini/src/cashier.js`、`packages/mini-core/tests/cashier-drafts-mini.test.mjs` 及本报告；两份旧 catalog-api untracked diff 不暂存。无全局 UI、shared 金融规则、API、DB、迁移、seed、generate、服务启停或外部数据改动。独立审查与真实 E 页面复验由根代理接续；上述测试和构建不能视为真实 E 已重放通过或微信真机验收。

## 2026-10-21 独立审查 Important 后续修复：已知名称的连续 fallback

按 `.superpowers/sdd/cashier-drafts-mini-restored-fallback-fix-brief.md`，基线 `fbd1b8a`，遵循原恢复显示 brief、implementer contract、systematic-debugging、TDD 与 verification-before-completion。仅本实现者活动，未派子代理。

根因：空 catalog 恢复初始化后，第一次菜单呈现刷新把“原商品/原规格/空加料”写入 `display`；有效菜单虽能解析出真实顶层名称，却没有同步更新下一次使用的 `display`。再次空菜单或选择失效时，旧 display 按现有合并顺序覆盖了已知名称。旧测试手动构造 `display: {}`，没有覆盖这条生产连续状态。

最小生产改动仅 `apps/merchant-mini/src/cashier.js` 的呈现赋值：把 hydrate 本次解析出的 `productName/skuName/modifierNames` 同步保存到呈现 fallback `display`，使顶层名称与下一轮 fallback 一致。没有把顶层未知占位直接提高到远端 display 之上；原匹配选择的远端 display 仍能提供可核对名称，菜单有效时仍由现有 hydrate 解析菜单真实名称。属性继续保留已知 attributes/远端 attributeNames 的原行为。原 `selectionKey` 匹配和正式订单跳过刷新保护均保留。

### 实际 adapter 与组件 RED → GREEN

先修改测试，再执行以下命令，生产代码保持原样：

```text
node --test --test-name-pattern 'menu display refresh|restored bag keeps known' packages/mini-core/tests/cashier-drafts-mini.test.mjs packages/mini-core/tests/cashier-drafts-mini-render.test.mjs
RED: tests 2 / pass 0 / fail 2 / exit 1
adapter: AssertionError: '原商品' !== '面'
actual mini panel: AssertionError: 已知商品 · 已知规格 ×1
```

两个失败均发生在空 catalog pending 初始化、有效菜单取得真实名称后，再次载入空菜单的阶段，属于预期业务失败。没有清空/修正 display 或复制实现。修改生产呈现赋值后，同命令 GREEN：`tests 2 / pass 2 / fail 0 / exit 0`。

adapter 用例替换旧手工空 display 测试：真实 `save()` 制造隔离 NETWORK unknown，uni storage 保留 pending，再由真实生产 adapter 恢复；同一实例依次载入有效菜单、空菜单、移除原属性的失效菜单。断言已知商品/规格/加料/属性、原选择 ID/数量、mode/table/note/name、pending/edit 及持久化原 key/body、价格和 configurationRevision 全部保留，写锁仍在；三次菜单共6次 GET、无写请求，失效项有 lineIssue，核价被拒绝。保留原 configurationRevision 已调整警告测试。

新增真实组件用例使用相同 uni pending 恢复链路，以既有 Vue 3.4 SSR 编译实际 Panel/子组件：有效菜单→空菜单→移除原加料的失效菜单，均显示已知名称、属性和加料并显示“待重新核价”，不显示占位名称或0元。原预约 slot/needsRefresh/selected、原输入、pending、价格和 revision 不变。随后明确 replay，匹配远端 display 的商品/规格/加料显示正确，原 name/note/selection/预约不被远端输入覆盖；仅精确原 key/body 的1次 POST及核对 GET，共8次请求，清锁后失效选择仍拒绝核价且不发新请求。原无有效菜单 replay 用例继续验证未知占位不会覆盖真实远端 display；原 update read 选择匹配、unknown 锁和正式订单原袋审计断言均原样通过。

### 最终验证、自查、限制与提交

| 命令 | 实际结果 |
| --- | --- |
| 上述 focused RED/GREEN 命令 | RED 0/2，exit1；GREEN 2/2，exit0 |
| `node --test packages/mini-core/tests/cashier-drafts.test.mjs packages/mini-core/tests/cashier-drafts-mini.test.mjs packages/mini-core/tests/cashier-drafts-mini-render.test.mjs` | 57/57，fail0，exit0，无警告 |
| `pnpm --filter @restaurant/merchant-mini build:h5` | `DONE Build complete.`，exit0 |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | `DONE Build complete.`，exit0 |
| `git diff --check` / `git diff --cached --check` | 无空白错误，exit0 |

自查确认生产 diff 只新增已解析名称到 display 的一致 fallback，没有改 selection、数量、价格、configurationRevision、mode/table/slot/note/name、controller、pending、key/body、scope/generation、写锁或正式订单原袋。没有新增请求、自动取单覆盖输入、收款或转单。测试使用隔离内存 transport/storage，Vite middleware 不监听端口；没有访问源 API/DB/root 浏览器、服务启停、generate/迁移/seed 或依赖更改，也没有重跑 Web/顾客/无关 suite。构建输出仅既有 uni 升级/托管宣传和微信工具导入提示。

提交范围明确为 cashier.js、上述两份 mini 测试及本报告；两份旧 catalog-api untracked diff 保持不暂存。提交标题：`fix: retain resolved mini draft names across menu refreshes`（本节所在提交，身份 Codex/codex@local.invalid）。本次验证不能替代真实 E 页面复验或微信真机验收；根代理独立复审后继续源页面复验，未提前宣称真实 E 已通过。
