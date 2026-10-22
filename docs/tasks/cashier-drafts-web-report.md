# Task 2：电脑收银挂单与共享恢复控制器

状态：代码、共享/Web行为测试、Web类型检查及构建已完成；等待 root 独立审查和实际页面/SQL验收。本文不将 REQ-079/080 标为全部验收完成；Task 3 商户 mini 收银尚未实施。

## 基线与边界

- 派发时记录的 BASE：`f2ff8163417616e64beadac4820dcf5a1e0f785b`。首读 `.superpowers/sdd/cashier-drafts-web-brief.md`，随后阅读 `D:/Codes/开发规范.txt`、TDD、verification-before-completion、subagent-driven-development；排查自测边界时另读 systematic-debugging。未派发子代理。
- 实际接口采用 `docs/architecture/api-contract.md`、Task 1 API报告及已实现验证器：revision 从0开始，`quote.cashierDraft`仅含id/revision，DraftView不包含幂等键，OrderView未承诺返回幂等键。
- 未执行源库业务写、造单、现金或退款；未执行generate/迁移/seed/reset；未停止或重启服务；未增加依赖。仅编辑Web、共享模块、类型、测试及本报告。
- root 同期文档提交保留；未暂存或更改两份旧catalog review diff、root的README/config/台账/验收文档。
- 实施提交：`ac11944`（`feat: add cashier draft workspace and durable recovery controller`），身份为Codex / codex@local.invalid。报告以单独文档提交交付，最终提交号见本任务交付消息。

## 实施结果

`CashierDrafts.vue`独立承担授权门店分页列表、状态筛选、版本与真实更新时间、取单前替换确认、取消确认、冲突远端详情、未知请求恢复入口与已转订单入口。非空购物袋取单必须明确选择取消或替换；新一单若存在未保存修改，也要求明确确认清除。

`Cashier.vue`保留原现金收款、现金凭证/退款状态、预约、规格/口味、旧订单创建恢复与原key逻辑，只增加草稿联动。未形成正式订单、没有未知收款等原锁的购物袋才能挂单。选中草稿的“保存并核价”会先CAS保存有变化的本地输入，再调用草稿quote；保存后GET发现其他人又修改了内容时停止核价，保留本地输入供核对。比较规范化字段与ID集合，不依赖PostgreSQL JSON键顺序。

`draftSelection`只提取原SKU/数量/全部选项ID及服务上下文。`hydrateDraft`使用现有`selectionLine`；解析失败仍保留所有原ID、数量、服务端display和issue，不使用`initialSelection`替换。原桌台、服务方式或预约失效时保留原选择并明确提示，不自动退为即时自取；原属性名称仍可从display展示。所有挂单金额均标示为预估或实际报价，恢复正式订单直接使用真实订单总额，未合成报价或已付事实。

共享模块为Task 3提供以下接口（已从mini-core index导出）：

```text
draftSelection(cart, context)
hydrateDraft(draft, catalog)
draftStorageKey(userId)
readDraftAttempt(storage, userId)
draftLocked(...locks)
createDraftController({state, request, storage, userId, storeId, onChange})
  .load({page,pageSize,state}) / .get(id)
  .create() / .update() / .cancel() / .quote()
  .convert({quoteId,orderKey}) / .recover(action)
  .isDirty(edit?) / .detach() / .dispose()
```

userId/storeId可传值或getter。request采用mini-core现有`(path,{method,data,headers})`约定；Web用`webDraftRequest`映射到现有api的body/key。state.edit为`{name,selection}`；state.remote是服务端事实；state.order只来自授权GET。`isDirty`用于离开未保存购物袋前的确认，不触发写入。

## 持久恢复协议

storage接口为`get/set/remove`。不存在的键必须返回`undefined`，已存在的空字符串/null属于损坏，不能归为“无待处理操作”。Web适配器使用sessionStorage，序列化对象并保留空值与缺失值的区别。Task 3若使用uni原生存储，必须先区分键不存在与`getStorageSync`可能返回的空字符串，不能直接把空值当不存在。

记录键为`cashier-draft:v1:${encodeURIComponent(userId)}`：同身份跨店只有一个待核对操作。载荷包含version=1、kind、userId、原storeId、原edit、原method/path/data，以及需要时的draftId、expectedRevision、原key、原quoteId；写成功回执取得id后可增加resultId，但原edit/data/key不改变。恢复验证身份、版本、方法、路径、选择白名单、数量/选项格式以及原data与操作类型的对应关系，损坏或不支持版本fail closed。

每次首次写入前先set并立即read-back验证；失败或静默丢写时不发送HTTP写。未知请求不能“丢弃并新建”，也不能用当前修改过的输入重建原请求。

- 创建unknown：用户明确点击“恢复原挂单”，以相同method/data/key重放；成功后真实GET核对版本与时间再清理记录。创建成功而确认GET失败时保留resultId及原请求。
- 更新/取消/报价unknown：恢复只GET原草稿，不自动重发CAS。GET后仍保留锁和本地输入，用户明确选择“重新载入”或“保留输入，按最新版本保存”才清理恢复记录。后者不会自动写，只允许下一次用户点击保存使用当前远端版本。
- 已知`DRAFT_CHANGED`等拒绝：真实GET当前事实后保留本地edit，展示远端revision/选择并进入review；GET失败不释放待核对记录。
- 转单：使用同一个`/orders`及原quoteId/orderKey；unknown默认只GET草稿，并在它已CONVERTED时GET真实orderId。草稿仍DRAFT不能证明先前下单未发生，继续保留锁和原attempt。显式“恢复原下单”才重放原`/orders`请求，返回的orderId还必须与草稿真实绑定一致。
- GET发现CONVERTED只证明存在该草稿的唯一正式订单，界面明确提示也可能由其他收银员转单；不虚构字段、不声称原key已被确认。GET或显式原请求重放后的恢复路径都只展示/核对实际订单，不自动调用现金收款。现金必须由用户再次明确点击确认。
- GET失败、后续401/403都不证明原写未发生，记录与锁保留。成功的恢复会清除旧NETWORK错误。清理存储也必须read-back确认；清理失败继续保留锁。

Web旧`merchant-checkout:<user>:<store>`版本1恢复格式保持兼容，仅增加draftRemote/draftName可选字段；原quote、orderKey、冻结实收、订单及现金凭证均保留。重新载入一个普通已选草稿时重新GET元信息、保留本地购物袋/名称并要求重新核价。原未知非草稿交易仍走原恢复流程。会话失效/重新登录不会删除本身份待核对记录；App启动会发现原店记录并进入收银。

## 锁与异步边界

Cashier将原mutation.busy、原uncertain、草稿busy、草稿blocked用OR合并到checkoutBlocked；编辑锁还包括已形成订单及非DRAFT状态。原App的商品/预约/退款导航锁保持原有OR组合。保存慢或unknown时导航、切店、退出和beforeunload均受锁约束，某一busy变false不能解除其他活动锁。正式订单不能通过另存挂单或取单替换绕过。

controller按身份、门店、选中草稿与generation复核异步上下文，dispose后不再发布迟到结果、不清理原恢复存储。切换至另一草稿清除上一草稿的订单事实；未确认的原写保持原记录。迟到响应、静默存储失败、重复点击均有真实controller接口测试。

## RED证据（原输出摘录）

首次只增加行为测试，通过index已有模块导入来获得真实断言失败，生产实现尚不存在：

```text
node --test packages/mini-core/tests/cashier-drafts.test.mjs
✖ hydration preserves all original IDs and server display when a required option disappears
✖ draftSelection sends only original selections and retains service context
✖ successful create persists original request before send and GET verifies version and time
...
ℹ tests 16
ℹ pass 0
ℹ fail 16
AssertionError [ERR_ASSERTION]: shared draft controller is exported
actual: 'undefined'
expected: 'function'
Exit 1
```

Web首次运行因模块不存在出现ERR_MODULE_NOT_FOUND，这次不计作行为RED；补空模块后重新运行，四项因缺失能力得到预期断言失败：

```text
node --test apps/merchant-web/src/cashierDrafts.test.mjs
✖ web adapter preserves original method body and idempotency key
✖ web session adapter distinguishes absent from damaged empty record
✖ nonempty bag requires replacement confirmation and cancel keeps bag untouched
✖ all cash, refund, appointment and draft locks combine with OR
ℹ tests 4
ℹ pass 0
ℹ fail 4
actual: 'undefined'
expected: 'function'
Exit 1
```

后续自审先补失败测试，再修正7个具体边界；同一focused命令出现的RED为：

```text
16 pass / 2 fail:
  save then quote refuses a remotely changed selection rather than hiding unsaved input
    true !== false
  a previously selected draft cannot receive late write results after selection context changes
    'd1' !== 'd2'
18 pass / 1 fail:
  switching from one loaded draft to another releases read busy and keeps new context
    true !== false
19 pass / 2 fail:
  quote compares normalized selections independently of JSON database key ordering
    false !== true
  recovery rejects injected edit fields rather than replaying extra API data
    assert.ok(core.readDraftAttempt(storage, 'u1').error)
21 pass / 1 fail:
  selecting a different draft removes the previous draft order fact
    actual: { id: 'o1', storeId: 's1' }, expected: null
22 pass / 1 fail:
  dirty state recognizes unsaved bag and name changes without treating key order as changes
    actual: 'undefined', expected: 'function'
```

原因分别为：保存后GET可能读到更晚选择；异步写缺少当前草稿上下文检查；get切换需免除旧draftId但仍验证generation；比较应固定字段顺序；恢复edit需白名单；新详情必须清理旧order；开始新单前需可复用的未保存检查。最终focused测试为23/23通过。测试调用真实共享controller与可控制Promise，不以源码字符串断言代替业务行为。

## 最终GREEN（实际命令与原输出摘要）

以下命令在实现提交前、最终代码上运行，均exit0：

```text
pnpm --filter @restaurant/mini-core test
> node --test tests/*.test.mjs
ℹ tests 119
ℹ suites 0
ℹ pass 119
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 478.7643

pnpm --filter @restaurant/merchant-web test
> node --test src/*.test.mjs
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 249.6878

pnpm --filter @restaurant/merchant-web typecheck
> vue-tsc --noEmit
[无错误输出，exit0]

pnpm --filter @restaurant/merchant-web build
> vue-tsc --noEmit && vite build
vite v6.4.1 building for production...
transforming...
✓ 1651 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.53 kB │ gzip:  0.35 kB
dist/assets/index-DrxrqVOO.css   31.98 kB │ gzip:  7.72 kB
dist/assets/index-BNvva-OL.js   270.00 kB │ gzip: 88.78 kB
✓ built in 2.49s

git diff --check
[无输出，exit0]
```

mini-core回归包含原现金退款、会话、预约、商品规格、客户下单恢复；Web回归包含原checkoutTransitions/recovery/session/refundRecovery。没有调用含API generate的workspace build。

## 仍需root与Task 3完成的验证

- 本任务未进行真实浏览器写入或SQL业务验收，不能以内存行为测试/类型检查/构建替代。root须执行真实Web挂单/刷新/恢复/409/慢写/离线，并只读SQL核对挂单前后库存、预约容量、序号及现金零变化。
- Web恢复采用现有sessionStorage范围，覆盖刷新与同tab重新登录；不宣称关闭tab后重新打开仍保留浏览器恢复记录。服务端已保存草稿独立持久存在；未确认操作由beforeunload提示和本tab原请求恢复保护。
- Task 3尚未实现；跨设备/商户mini闭环及真机未验证。无AppID/支付/生产域名或服务器资源，不声称生产或真机已通过。
- 本实现只消费Task 1既有接口，不新增客户端计价、预占、现金账目或订单快照，不改历史事实。已转换草稿始终不可再次编辑或转单；后续取消/退款不会把它恢复为草稿。

## 2026-10-21 独立审查 Important 修复

状态：两项修复的可执行行为测试、mini-core/Web全量测试、Web类型检查及构建已完成，仍待root独立复审及实际业务页面/SQL验收。修复派发基线为 `b3c6f38ab3b16a25374678440ae24b64406ac641`，先读 `.superpowers/sdd/cashier-drafts-web-fix-brief.md`、原brief、本报告和 `D:/Codes/开发规范.txt`，遵循systematic-debugging、test-driven-development及verification-before-completion；单实施者，未再派子代理。

### 取消取单的异步边界

根因：旧 `createDraftTakeover.accept()` 在等待load期间没有取消代次检查；取消仅清candidate，迟到load仍会apply。实际CashierDrafts.vue的load调用共享controller.get，而get在apply前已经提交remote/edit/quote/order，单独阻止购物袋替换也会让后续保存指向另一草稿。

修复：takeover使用代次令牌和单次在途保护，重复accept不重复load，取消/改变候选使原令牌失效，组件卸载也取消。CashierDrafts.vue把令牌检查传入 `controller.get(id, {accept})`；共享读取先暂存草稿与必要的正式订单GET结果，验证当前上下文与accept后才发布remote/order，get随后提交edit/quote。取消不再改购物袋或原草稿CAS上下文，既有get调用默认accept保持兼容。

先增加可控Promise行为测试再运行，真实RED：

```text
node --test apps/merchant-web/src/cashierDrafts.test.mjs
✖ cancel during accepted load prevents late bag replacement
✖ repeated accept loads once and changing candidate invalidates the original load
✖ cancelled takeover preserves controller selection through late draft GET
✖ cancelled takeover preserves controller selection through late order GET
ℹ tests 8
ℹ pass 4
ℹ fail 4
AssertionError [ERR_ASSERTION]: true !== false
Exit 1

node --test packages/mini-core/tests/cashier-drafts.test.mjs
✖ cancelled selection GET never publishes remote, edit, quote or converted order
ℹ tests 24
ℹ pass 23
ℹ fail 1
AssertionError [ERR_ASSERTION]: true !== false
Exit 1
```

最小实现后同两文件组合为32/32通过。Web测试组合真实共享controller和Web takeover，分别在草稿GET与转换订单GET尚未完成时取消，除apply次数为0外，同时核对remote/edit/order/quote原值不变与busy最终释放；重复accept/候选改变也有行为断言。

### 已核对草稿订单与重新确认实收

根因：Cashier.vue的recoverDraft使用通用RECONCILED；该事件为已有现金未知回执保留submittedFen和原quote，导致尚未发出现金请求的未知草稿转单恢复后也冻结旧实收。SUBMIT又优先取旧quote.totalFen，真实订单2000分仍可能保留1000分旧实收。

修复：实际页面recoverDraft及转换冲突分支改用 `recoverDraftCheckout`。该入口必要时调用真实controller.recover，要求无pending/blocked/busy且CONVERTED草稿的orderId、storeId与授权GET订单一致，才派发 `DRAFT_ORDER_RECONCILED`。草稿仍DRAFT、读取失败、恢复尚在途或存储清理未确认时，不释放原请求、quote/key及冻结金额，不发现金。首次本地绑定订单、尚无order/paid时清旧quote/submittedFen并以真实订单总额展示实收建议；Cashier.applyEvent实际接回tendered，输入因submittedFen清空恢复可编辑，仍必须由用户下一次明确提交才收现金。原orderKey始终保留。

已有本地正式订单说明现金请求可能已发出：同orderId重读不清冻结金额/原key，另一orderId拒绝替换。SUBMIT始终优先使用真实order.totalFen核对，旧quote不再降低实收下限。原未知现金/非草稿恢复继续使用既有RECONCILED逻辑。

真实RED（初次新事件测试曾直接读取未绑定order.id引出TypeError，改为deepEqual行为断言后以下才计作有效RED）：

```text
node --test apps/merchant-web/src/cashierDrafts.test.mjs apps/merchant-web/src/checkoutTransitions.test.mjs
✖ Web draft recovery reconciles the real bound order before releasing tender and sends no cash
✖ Web recovery refuses stale, unbound or still blocked draft order facts
  AssertionError: actual 'undefined', expected 'function'
✖ reconciled draft binding releases the old quote and tender for explicit cash confirmation
  AssertionError: actual undefined, expected { id:'o2', totalFen:2000, ... }
✖ actual order total governs submission even when an old quote remains in cash recovery
  AssertionError: actual undefined, expected '实收现金不能少于应收金额。'
✖ draft recovery cannot replace another existing financial order
  AssertionError: assert.ok(result.error)
ℹ tests 19
ℹ pass 14
ℹ fail 5
Exit 1
```

新增Web集成行为测试调用实际页面已接线的recoverDraftCheckout、真实共享controller与checkoutTransitions，先发出丢回执的原/orders请求，读取仍DRAFT不解锁，再挂起真实订单GET，确认pending原quoteId/key在GET完成前不动。真实订单2000分返回后才解除旧1000分实收，明确20.00的SUBMIT得到2000分；恢复全部路径没有cash-payment调用。再次查看同order并处于未知现金状态时保留3000分冻结额与原key。还覆盖忙/blocked/不匹配绑定/失败recover的旧order事实拒绝接入，以及单独状态机的实际订单金额下限与不同金融订单拒绝替换。

### 最终验证与边界

以下命令均在最终实现代码上实际运行，exit0：

```text
node --test apps/merchant-web/src/cashierDrafts.test.mjs apps/merchant-web/src/checkoutTransitions.test.mjs packages/mini-core/tests/cashier-drafts.test.mjs
ℹ tests 43
ℹ pass 43
ℹ fail 0

pnpm --filter @restaurant/merchant-web test
> node --test src/*.test.mjs
ℹ tests 36
ℹ pass 36
ℹ fail 0
ℹ duration_ms 333.3133

pnpm --filter @restaurant/mini-core test
> node --test tests/*.test.mjs
ℹ tests 120
ℹ pass 120
ℹ fail 0
ℹ duration_ms 464.3248

pnpm --filter @restaurant/merchant-web typecheck
> vue-tsc --noEmit
[无错误输出，exit0]

pnpm --filter @restaurant/merchant-web build
> vue-tsc --noEmit && vite build
vite v6.4.1 building for production...
✓ 1651 modules transformed.
dist/index.html                   0.53 kB │ gzip:  0.36 kB
dist/assets/index-Do_S7tYW.css   31.98 kB │ gzip:  7.72 kB
dist/assets/index-CHHRKtFZ.js   270.79 kB │ gzip: 89.09 kB
✓ built in 2.50s

git diff --check
[无输出，exit0]
```

此次只修改必要Web/shared实现、对应测试并追加本报告；未源库业务写、造单、现金/退款、停服务、generate、迁移或升级依赖。README/config/ledger/验收文件由root保留，未暂存两份旧catalog review diff。提交身份Codex / codex@local.invalid；本节随修复实现一同提交，commit由最终交付消息给出，避免文档自引用commit。

仍需root独立复审并真实页面验收慢取单取消/原草稿保存上下文、其他员工转单后的实单金额及明确现金确认；本报告不把自动化测试、类型检查或构建等同真实业务、跨设备mini或生产验收。此前sessionStorage同tab范围、Task3未实施及无真机/生产资源的限制继续有效。

## 2026-10-21：首次空收银 setup 崩溃修复

基线为 `ad094c4edabc2707ce25c559c6af930b26196b4f`；依据 `.superpowers/sdd/cashier-drafts-empty-checkout-fix-brief.md`、原 Task2 brief、开发规范及 systematic-debugging/TDD/verification-before-completion 执行。root 的真实 CLERK 页面发现：无收银恢复记录时，`restored` 为正常的 null，但恢复报价判断两侧缺失 ID 均为 undefined，比较结果为 true，随后读取 null.quote 导致 setup 中断。相同判断还会把没有草稿绑定的普通历史报价误放入 drafts.quote。

生产修改仅 Cashier.vue 的一行判断：必须存在当前远端草稿 ID，并与恢复报价的 cashierDraft.id 相等，才恢复草稿报价。未改变原 quote/order/submittedFen/orderKey 恢复流程、上一轮已批准的取消取单与转单实收修复，未新建 helper 或修改 shared。

新增 `cashierSetup.test.mjs` 使用现有 Vite/Vue 依赖直接加载真实 Cashier.vue，挂载实际 setup 和生命周期，只将模板替换为空渲染；读取实际 setupState 断言。测试的内存 sessionStorage、window 与隔离 fetch 仅用于 Node 行为测试；没有源码字符串断言，没有用假恢复记录修补实际页面。Vite 采用 middlewareMode，不监听端口；测试结束关闭自身测试资源，不访问或停止既有服务。fetch 在挂载后和异步清理后均断言仅有 GET，无下单或收现金请求。

### 实际 RED / GREEN

测试适配层最初分别遇到 Node mock.property 不支持不存在属性、SSR 编译需要上下文的问题；在生产代码尚未修改时修好适配层，这些失败未计作业务 RED。随后以下命令在原生产判断下得到正确 RED（原输出节选，exit1）：

```text
node --test apps/merchant-web/src/cashierSetup.test.mjs
✖ actual cashier setup opens an empty bag for absent checkout (638.2636ms)
✖ actual cashier setup opens an empty bag for null checkout (2.5289ms)
✖ actual cashier setup opens an empty bag for undefined checkout (1.7172ms)
✖ actual cashier setup does not borrow a draft quote for missing remote and quote (5.8344ms)
✔ actual cashier setup does not borrow a draft quote for bound quote without remote (1.7706ms)
✔ actual cashier setup does not borrow a draft quote for remote without quote (1.8873ms)
✖ actual cashier setup does not borrow a draft quote for ordinary quote without draft binding (1.5596ms)
✔ actual cashier setup does not borrow a draft quote for different draft binding (2.0878ms)
✔ actual cashier setup restores a quote only for the same bound draft (2.0787ms)
✖ actual cashier setup preserves legacy unknown cash amount, key and order (1.9773ms)
ℹ tests 10
ℹ pass 4
ℹ fail 6
ℹ duration_ms 1025.9761

TypeError: Cannot read properties of null (reading 'quote')
    at setup (D:/Codes/013MiniProgram/apps/merchant-web/src/Cashier.vue:88:90)
TypeError: Cannot read properties of undefined (reading 'quote')
    at setup (D:/Codes/013MiniProgram/apps/merchant-web/src/Cashier.vue:88:90)
```

另外三项断言失败分别为 drafts.quote 被错误赋为 undefined、普通 quote、legacy quote，期望均为 controller 初始的 null。旧现金金额/key/order 的断言已先通过，旧现金测试失败点仅是误借报价。

仅增加有效草稿 ID 判断后，同命令正确 GREEN（原输出，exit0）：

```text
node --test apps/merchant-web/src/cashierSetup.test.mjs
✔ actual cashier setup opens an empty bag for absent checkout (640.6654ms)
✔ actual cashier setup opens an empty bag for null checkout (1.4794ms)
✔ actual cashier setup opens an empty bag for undefined checkout (1.2687ms)
✔ actual cashier setup does not borrow a draft quote for missing remote and quote (1.3411ms)
✔ actual cashier setup does not borrow a draft quote for bound quote without remote (1.4957ms)
✔ actual cashier setup does not borrow a draft quote for remote without quote (1.8594ms)
✔ actual cashier setup does not borrow a draft quote for ordinary quote without draft binding (1.1667ms)
✔ actual cashier setup does not borrow a draft quote for different draft binding (1.6317ms)
✔ actual cashier setup restores a quote only for the same bound draft (1.7027ms)
✔ actual cashier setup preserves legacy unknown cash amount, key and order (2.1258ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1003.2357
```

覆盖真实缺失记录/null/undefined、无 draftRemote、无 quote、匹配绑定恢复及不匹配绑定拒绝借用。有效草稿恢复保留原远端事实和本地未保存名称；旧有效 checkout 保留原 order、quote、5000分冻结实收、50.00输入、original-key、uncertain 和收银锁。GREEN 后仅补异步清理阶段 GET-only 断言，以下最终完整 suite 包含此断言。

### 最终 Web 验证与交付边界

最终实现上完整 Web suite、typecheck、build 各执行一次，均 exit0；shared 无修改，未重复执行 mini-core suite。原输出：

```text
pnpm --filter @restaurant/merchant-web test
> @restaurant/merchant-web@0.1.0 test D:\Codes\013MiniProgram\apps\merchant-web
> node --test src/*.test.mjs
ℹ tests 46
ℹ suites 0
ℹ pass 46
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1206.1468

pnpm --filter @restaurant/merchant-web typecheck
> @restaurant/merchant-web@0.1.0 typecheck D:\Codes\013MiniProgram\apps\merchant-web
> vue-tsc --noEmit
[无错误输出，exit0]

pnpm --filter @restaurant/merchant-web build
> @restaurant/merchant-web@0.1.0 build D:\Codes\013MiniProgram\apps\merchant-web
> vue-tsc --noEmit && vite build
vite v6.4.1 building for production...
transforming...
✓ 1651 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.53 kB │ gzip:  0.35 kB
dist/assets/index-Do_S7tYW.css   31.98 kB │ gzip:  7.72 kB
dist/assets/index-D9ulacjg.js   270.80 kB │ gzip: 89.09 kB
✓ built in 2.47s
```

此次只提交必要 Web 一行实现、直接 setup 行为测试与本报告追加；未源库业务写、停服务、generate/迁移或升级依赖，未改动 root 保留的 A 草稿业务事实。root ledger/brief/验收和两个旧 catalog diff 均不纳入提交。身份 Codex / codex@local.invalid，commit 在最终交付消息提供。

仍需 root 独立复审后重新载入真实 CLERK 空收银并继续 Task2 实际页面与 SQL 验收；这里的自动化结果不代表真实页面、跨设备 mini 或生产验收。Task3 仍未派发。

## 2026-10-21：恢复正式订单后仍显示旧购物袋与 NETWORK 修复

派发基线 `4ba9586c73f6db2b3075174ba4e7be4fdb54dc95`。依据 `.superpowers/sdd/cashier-drafts-recovered-display-fix-brief.md`、原 Task2 brief、本报告、开发规范及 systematic-debugging/TDD/verification-before-completion 执行；单实施者，未派子代理。root 已真实复现 C 草稿经其他员工改为 2 份并转成 6160 分订单，原员工恢复后仍显示本地 1 份/3080 分及旧 NETWORK。本次不改动该草稿、订单或付款期限。

### 根因与最小修复

追踪实际 Cashier.vue 的恢复与模板边界：`recoverDraftCheckout` 正确核对草稿绑定并发布正式订单，金融事件也已经释放首次绑定的旧 quote/submittedFen，但商品行模板、件数和服务提示继续读取本地编辑 cart/mode；旧 mutation.error 也未在核对成功后清理。旧现金重读还必须保留原 quote/submittedFen/key，直接覆盖或重新计价 cart 会破坏恢复线索。

新增仅承担呈现的 `CashierOrderDetails.vue`，由实际 Cashier 的 order 接线，显示真实订单商品名、规格、属性组/选项、加料名及价格、数量、行金额和服务上下文（堂食桌台，或自取号/服务日/预约窗口）及备注快照。组件没有金融状态机或菜单计价。已有 order 时隐藏旧编辑袋、旧服务失效提示和旧报价明细；原 cart/quote 恢复记录仍保留，金额和现金确认继续沿原订单状态机。首次恢复、已有 order 刷新和后续同单读取使用同一明细入口，已付款或关闭订单也保留订单快照明细。

`recoverDraft` 仅在桥接入口返回已核对绑定订单后调用 mutation.clear；失败、仍是 DRAFT 或尚在等待 order GET 时不清旧 NETWORK、不提前释放 pending/blocked/冻结实收/key。未改 shared、types 或 checkoutTransitions。

### 实际 RED / GREEN 与行为覆盖

扩展已有真实 SFC setup/lifecycle 测试，通过 Vue 的 renderToString 渲染实际 Cashier 模板和子组件，复用实际 setup state，检查最终 HTML；没有源码字符串断言。测试 fetch 完全隔离，不访问真实服务。成功路径通过实际 checkout 发出隔离的原 /orders 请求并模拟丢回执，再通过真实共享 controller 读草稿及可控 Promise 的订单 GET。最初因恢复 fixture 未初始化 edit.selection 出现 VALIDATION_ERROR，使用实际 syncDraft 补齐原编辑上下文后才计作有效 RED；生产代码在此前未修改。

原生产代码上的有效 RED（原输出摘要，exit1）：

```text
node --test apps/merchant-web/src/cashierSetup.test.mjs
✔ actual cashier template renders the editable bag before an order exists
✖ actual cashier recovers real order snapshots and clears the previous NETWORK only after binding
✖ actual cashier refresh renders real order facts and preserves unknown cash amount and key
ℹ tests 14
ℹ pass 12
ℹ fail 2
ℹ duration_ms 1034.6324

AssertionError: actual ApiError { code: 'NETWORK' }, expected undefined
AssertionError: rendered HTML did not match /订单明细/
实际 HTML 仍为 当前账单 / 1 件 / 本地旧商品 / ¥30.80，与应收 ¥61.60 并列。
```

最小生产修复后的 focused GREEN（原输出摘要，exit0）：

```text
node --test apps/merchant-web/src/cashierSetup.test.mjs
ℹ tests 14
ℹ pass 14
ℹ fail 0
ℹ duration_ms 1037.9536
```

GREEN 后仅补强断言和增加仍 DRAFT 的核对路径，没有继续修改生产代码；最终 Web suite 包含全部 15 项实际 setup/模板行为测试。断言覆盖旧 cart 1/3080 → 正式订单 2/6160、历史商品/规格/属性/加料、真实桌台/备注、旧袋及旧报价不再显示、订单行无数量/重选操作、本地袋内容不变。首次绑定成功时旧 NETWORK 消失、61.60 输入可编辑；离线订单 GET 与仍 DRAFT 均保留旧错误、pending、锁、3080 分冻结额和原 key；慢 order GET 完成前也不清理。已有未知现金同单刷新/重读后仍保留 7000 分冻结实收、70.00 禁用输入、原 quote 与原 key，显示继续以实际 6160 分订单为准。恢复路径没有任何 cash-payment 调用，唯一写调用是隔离测试中的原 /orders 请求。

### 最终验证与限制

最终实现上的 Web suite、typecheck、build 各执行一次，均 exit0。shared 未修改，因此未重复 mini-core suite。原输出：

```text
pnpm --filter @restaurant/merchant-web test
> node --test src/*.test.mjs
ℹ tests 51
ℹ suites 0
ℹ pass 51
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1284.2071

pnpm --filter @restaurant/merchant-web typecheck
> vue-tsc --noEmit
[无错误输出，exit0]

pnpm --filter @restaurant/merchant-web build
> vue-tsc --noEmit && vite build
vite v6.4.1 building for production...
✓ 1653 modules transformed.
dist/index.html                   0.53 kB │ gzip:  0.36 kB
dist/assets/index-Do_S7tYW.css   31.98 kB │ gzip:  7.72 kB
dist/assets/index-xB0GwioS.js   272.13 kB │ gzip: 89.53 kB
✓ built in 2.50s
```

此次仅提交必要 Web 呈现/恢复错误清理、对应真实 setup/模板测试及本报告追加。未源库业务写、收现金、退款、停服务、generate、迁移或升级依赖；未改动或暂存 root 文档、ledger、brief 及两个旧 catalog diff。身份 Codex / codex@local.invalid，commit 在最终交付消息提供。

仍需 root 独立复审，并在真实页面与只读 SQL 重新验收 C 草稿/订单快照、错误清理与零自动现金；自然关闭的订单沿实际关闭事实展示，不更改期限或重开。测试 fixture 不代表真实业务验收。sessionStorage 同 tab、Task3 未实施及无真机/生产资源等原限制继续有效。
