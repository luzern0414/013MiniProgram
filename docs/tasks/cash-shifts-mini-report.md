# 现金交班 Task 3 商户小程序实现报告

日期：2026-10-21。派发基线 `4a6917ac8bba3813e13846016fa0d6eb7485729c`，分支 `codex/restaurant`。实现期间 root 另提交 `300679f`，仅准备文档，不属于本任务代码。本任务只实施商户 Mini、相应行为测试及本报告；未修改 API、数据库、Web 或顾客小程序源码，也未修改 shared 运行时代码。

## 实现范围

- `apps/merchant-mini/src/cash-shifts.js`：复用真实 `createCashShiftController`，仅适配 uni storage、持久记录独立发现、其他操作锁及 dispose。不另建开关班状态机。uni 缺失键经枚举转换为 `undefined`；空串、null、损坏及枚举失败由 shared 按损坏处理；写入和删除继续由 shared 执行 readback。
- `apps/merchant-mini/src/components/CashShifts.vue`：真实 current、分页历史、状态筛选、详情和 CLOSED 保存快照；店主开关班、店员只读；服务端收款/退款/应有金额，实点仅作差额预览；差异必填原因、零差额可空，负应有现金正常显示，关闭须另行勾选式确认按钮和明确提交。待恢复面板显示冻结原金额、原原因；读取失败保留 pending，不自动开下一班。
- `apps/merchant-mini/src/merchant.js`：初始化、refresh、重登在组件挂载之外发现独立交班 pending/损坏。原现金、退款、挂单和交班以及预约/auxiliary 锁按 OR 组合；恢复顺序保留现金→退款→挂单→显式交班入口，班次恢复不能放开其他 unknown。无路由 hint 时也可到原门店恢复；跨店退款提供显式返回；同店现金恢复后展示另一张订单也不能阻塞原退款自己的订单。
- 新现金提交前、新退款核对和提交前读取活动班次；缺班保留原订单、实收/退款金额和原因。交班页面有明确“返回原收款/退款”入口，返回时 GET 原订单，保持输入，禁止自动付款/退款。首个确定 `SHIFT_REQUIRED` 与原 unknown 恢复分开：原 unknown 读取原凭证、保留原 key/载荷，不能把缺班错误当第一次未入账。恢复旧现金/退款不执行新操作 current preflight。
- `apps/merchant-mini/src/pages/index/index.vue`：最小接入口、待恢复提示、原金融恢复入口和 `onBackPress` / H5 `beforeunload` OR 锁；页面卸载 dispose。交班提示位于正文，避免挤入窄屏顶部横栏。
- `CashRefund.vue` 在退款核对前调用 shared `checkNew()`；`CashReceipt.vue` 展示真实 `cashReceipt.shiftId` / `cashRefunds[].shiftId`，null 显示“历史未归班”，不按日期推断归班。
- 本次新增界面文字及按钮最低 14px，按钮可换行、最小点击高度 44px；窄屏筛选/金额行换行，新增区域遵守 reduced-motion。

## TDD 证据

所有请求均通过隔离的 uni request fixture / 内存 storage，未调用源业务接口。SFC 测试编译实际 Vue 3.4.21 组件，在自定义 renderer 运行 setup、watch、生命周期和按钮事件；Index 取得的仍是实际 `useMerchant` 实例，仅桥接 uni 的返回键回调及环境对象。不是源码正则或手动 busy 的替代验收。

1. 初始 RED：

   ```text
   node --test packages/mini-core/tests/cash-shifts-mini.test.mjs
   tests 13 / pass 0 / fail 13
   Expected undefined to strictly equal true (shiftBusy 尚未提供)
   new cash ... Expected 1 to strictly equal 0 (缺班仍发收款)
   original unknown SHIFT_REQUIRED ... assert.ok(GET /orders/o1) 失败
   ```

   这些失败确认缺少独立发现、preflight、原现金核对及恢复导航。接入 shared 后该轮 13/13 GREEN。

2. 实际 SFC 初始 RED：

   ```text
   node --test packages/mini-core/tests/cash-shifts-mini-sfc.test.mjs
   tests 4 / pass 0 / fail 4
   actual merchant Mini CashShifts.vue exists 断言失败
   Index 实际文本缺少“原交班操作待核对”
   ```

   页面及 Index 接入后该轮 4/4 GREEN。

3. 逐边界 RED→GREEN：

   - 跨店现金后原退款返回：14 项中 13 通过，缺少 `returnToRefundStore`；实现显式原门店返回后 14/14。
   - 离开收款 sheet 后迟到确认 + 顶部布局：组合 29 项中 27 通过；迟到 modal 仍写入、恢复提示位于 top 的断言失败。冻结所选订单并重验 sheet/身份/门店，提示移正文后 29/29。
   - 原输入返回：17 项中 15 通过，缺少 `resumeCash` / `resumeRefund`；实现 GET 后显式恢复输入后通过。随后用实际 Index 点击“现金交班”及“返回原收款/退款”再验证未发金融 POST。
   - 原金额显示：实际恢复 SFC 未显示 `原期初现金 ¥1.23`，断言失败；补显示冻结载荷后通过。该轮另发现测试自定义节点缺少原生 v-model 使用的 DOM 事件方法，补测试宿主后才验证实际现金 sheet，不把宿主错误当业务 RED。
   - 活动班次读取期间挂单返回 / 过期会话迟到交班切店：19 项中 17 通过；旧返回会替换活动控制器、迟到 handoff 仍改路由。补 shift.busy 和身份/门店校验后通过。
   - 同店不同退款原单：20 项中 19 通过，现金恢复后 `refundCtl.load()` 返回 false；refund context 保留 pending 自己的原订单后 20/20。

4. 曾跑完整 mini-core：194/195，唯一失败是旧挂单测试将实际模板 `disabled` 字符串 eval，新增依赖未在假 context 中定义（`refund is not defined`）。移除该源码正则/eval 用例，由实际 Index+真实 useMerchant+现金/挂单/交班三 pending 的事件测试覆盖：旧现金恢复可达、活动挂单请求禁用恢复、现金恢复后挂单读取可达、转单恢复不顺势收款、最后显式进入交班。

   同轮两个 Vite middleware SFC 测试争用默认 HMR websocket 端口。将新旧两个测试 HMR 连接到**未 listen 的 HTTP 对象**，不创建监听端口；之后相关与完整测试无该噪声。该调整仅为隔离测试宿主，不触碰源服务。

## 验证结果

首轮集成（后续仅再验证受影响项）：

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @restaurant/mini-core test` | 205/205，0 failures，HMR 噪声已消除 |
| `pnpm --filter @restaurant/merchant-web test` | 85/85，0 failures |
| `pnpm --filter @restaurant/merchant-web build` | exit 0，vue-tsc + Vite 1658 modules，built |
| `pnpm --filter @restaurant/merchant-mini build:h5` | exit 0，DONE Build complete |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | exit 0，DONE Build complete |
| `pnpm --filter @restaurant/customer-mini build:h5` | exit 0，DONE Build complete |
| `pnpm --filter @restaurant/customer-mini build:mp-weixin` | exit 0，DONE Build complete |

最终受影响代码复验（含返回原输入、迟到响应、同店不同原退款单的后续修正）：

```text
node --test packages/mini-core/tests/cash-shifts.test.mjs packages/mini-core/tests/cash-shifts-mini.test.mjs packages/mini-core/tests/cash-shifts-mini-sfc.test.mjs packages/mini-core/tests/cash-refunds.test.mjs packages/mini-core/tests/cash-refunds-merchant.test.mjs packages/mini-core/tests/cashier-drafts-mini.test.mjs packages/mini-core/tests/cashier-drafts-mini-render.test.mjs

tests 111
pass 111
fail 0
cancelled 0
skipped 0
```

最终重复 `pnpm --filter @restaurant/merchant-mini build:h5`、`pnpm --filter @restaurant/merchant-mini build:mp-weixin`，均 exit 0 / DONE Build complete。uni 输出自身升级/托管提示，未升级依赖。最终 `git diff --check` exit 0、无输出。

覆盖存储不存在/损坏/写失败/静默写失败/readback失败/清理失败；同 key 冻结金额及原因；跨 reload/重登可发现；账号、门店、dispose 迟到结果不发布；权限只读；close409 保留输入及 requestId；零差额/负应有/差异原因；新现金/退款 preflight；unknown 的原金融恢复不走新操作 preflight；现金+退款+挂单+交班锁及实际返回/卸载事件组合。

## 文件与自查

提交文件：

- `apps/merchant-mini/src/cash-shifts.js`
- `apps/merchant-mini/src/components/CashShifts.vue`
- `apps/merchant-mini/src/components/CashReceipt.vue`
- `apps/merchant-mini/src/components/CashRefund.vue`
- `apps/merchant-mini/src/merchant.js`
- `apps/merchant-mini/src/pages/index/index.vue`
- `packages/mini-core/tests/cash-shifts-mini-fixture.mjs`
- `packages/mini-core/tests/cash-shifts-mini.test.mjs`
- `packages/mini-core/tests/cash-shifts-mini-sfc.test.mjs`
- `packages/mini-core/tests/cashier-drafts-mini-render.test.mjs`
- `packages/mini-core/tests/cashier-drafts-mini.test.mjs`
- 本报告。

自查已修正：恢复提示位置、late modal、原输入返回可达性、活动读取时不能经挂单返回 dispose、late handoff 不改新作用域、同店不同原退款单。现有 merchant.js 与 Index 本身已较长，本任务沿用现有职责，班次状态机与页面拆在适配/组件内，未在 Index 复制状态机。未暂存两份旧 catalog-api diff 或 root 文档。最终提交身份为 Codex / codex@local.invalid。

## 限制与交接

本任务是代码和隔离行为验证完成，等待 root 的独立 spec/quality review 及源跨端业务验收。未做源业务请求、SQL（含读写）、浏览器控制、generate、迁移、seed/reset、服务启停；既有商品、订单、凭证、库存及 W 单未触碰，样品售罄未回填。

root 独占执行并记录 Web A→Mini 收款→Web 关闭→Mini 关闭快照→Mini B→针对独立验收原单部分退款、跨设备冲突、旧凭证重放及数据库旧/新账本检查。本报告不将 fixture、SFC renderer 或构建声称为这条源验收，也不声称微信真机、生产域名/支付或完整 REQ-090 已验证。当前无 AppID/支付/域名/服务器资源，未新增依赖或生产配置。

## 独立审查 Important 修复：现金冲突核对迟到响应

修复日期：2026-10-21。派发基线 `4161492bd3352d4d0105adf4debb41a10abb1f5b`。本节是独立审查后的增量修复与最终复验，保留上文首轮集成范围，不将此前已通过的无关 suite 记为本轮重跑。

根因经实际代码核对并用真实 `useMerchant` / uni fixture 复现：`cash()` 收到 `STATE_CONFLICT` 后 GET 原订单，等待期间会话过期或身份/门店变化，返回后仍直接发布订单、切换 sheet/tab 并清原现金记录。相邻 `SHIFT_REQUIRED` 已有作用域校验，此分支遗漏；错误 id/store 或缺失状态也会被错误视为可解锁事实。

本次仅修改 `apps/merchant-mini/src/merchant.js`，在该 GET 返回后、任何视图/存储写回之前验证原身份对象与原门店（同账号的新会话也不接受旧结果），以及返回订单 id/storeId、已知订单/付款状态和显式 cashReceipt 字段。存在凭证时检查收款/实收/找零为非负安全整数且相互一致；无效或不完整事实保留原 pending，提示继续核对并保留原冲突 requestId。正常原凭证或关闭单的原有恢复路径继续执行，不新增金融请求、不改变原 key/载荷，不清其他 pending。

新增 `packages/mini-core/tests/cash-shifts-mini-conflict.test.mjs` 使用既有隔离 uni request/storage fixture，挂起真实 GET 后触发实际 `session-expired` 事件；门店、其他身份和同账号新身份对象通过真实 merchant ref 改变作用域（正常切店本来受锁限制）。逐项比较迟到返回前后订单、sheet、tab、成功提示与持久现金/交班/退款记录，并验证过期后重登仍发现原现金。正常恢复用原收款凭证和关闭单验证仅原现金解锁，其他 pending 和导航/切店/退出 OR 锁继续生效。

聚焦 TDD 命令：

```text
node --test packages/mini-core/tests/cash-shifts-mini-conflict.test.mjs
```

- 首轮 RED：13 项，pass 2 / fail 11；失败为迟到响应发布订单/成功提示、错误归属及缺字段仍替换视图；原收款与关闭单两项正常基线通过。
- 补齐不完整事实边界后 RED：17 项，pass 2 / fail 15（同一文件，`--test-reporter=dot`）；未知状态、缺凭证字段及空凭证同样错误发布/解锁。
- 仅加入上述校验后 GREEN：17 项，pass 17 / fail 0，exit 0。

本轮一次受影响恢复回归（含原现金、退款、挂单与交班 OR 锁及实际 SFC 组合）：

```text
node --test packages/mini-core/tests/cash-shifts-mini-conflict.test.mjs packages/mini-core/tests/cash-shifts.test.mjs packages/mini-core/tests/cash-shifts-mini.test.mjs packages/mini-core/tests/cash-shifts-mini-sfc.test.mjs packages/mini-core/tests/cash-refunds.test.mjs packages/mini-core/tests/cash-refunds-merchant.test.mjs packages/mini-core/tests/cashier-drafts-mini.test.mjs packages/mini-core/tests/cashier-drafts-mini-render.test.mjs

tests 128 / pass 128 / fail 0 / cancelled 0 / skipped 0
exit 0
```

随后 `pnpm --filter @restaurant/merchant-mini build:h5` 与 `pnpm --filter @restaurant/merchant-mini build:mp-weixin` 均 exit 0 / `DONE Build complete`；uni 自身输出升级/托管提示，未升级依赖。`git diff --check` exit 0，无输出。本轮提交仅 merchant.js、新增冲突行为测试、本报告；API/shared/Web/顾客源码均未改动。

未发源 API/SQL/业务请求，未控制源浏览器，未执行 generate/迁移/seed/reset 或服务启停，未触碰源商品、库存、订单、现金/退款及 W 单。本轮是隔离行为与双构建验证，等待独立复审及 root 的源验收，不能视为源 UI、微信真机或完整 REQ-090 验收。
