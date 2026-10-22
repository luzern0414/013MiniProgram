# Task 2：shared 恢复与 Web 现金交班实施报告

日期：2026-10-21。依据 `.superpowers/sdd/cash-shifts-web-brief.md`、已批准设计、API 提交 `1d873cf` 与最终 `docs/architecture/api-contract.md` 实施。仅 shared / Web / 对应测试；未改 API、数据库、schema、merchant-mini 或顾客端。

## 已实施

- 新增 `packages/mini-core/src/cash-shifts.mjs` 及 index 导出。采用现有现金退款、挂单的 durable-before-send、读回确认、原 key/body 恢复约定。按身份仅一份 pending，包含原门店；每次新操作前重新发现其他已挂载控制器写入的 pending，禁止跨店覆盖。存储不存在与空串/null/损坏明确区分，写存储/读回失败不发 POST，清理/读回失败继续锁定。
- 开班、版本化关班、活动班次、明细与历史分页都走真实接口。校验返回身份、门店、状态、整数分与汇总等式；闭班展示服务器保存的实点/差额/原因。401/403、GET 离线及迟到响应不释放未知操作。身份、门店、dispose 后的响应不能发布或清理记录。
- 关班首次明确 SHIFT_CHANGED 可在成功 GET 后保留实点/原因、显示最新金额并要求重新明确确认；不自动使用新 revision 重关。原 unknown 的重放不采用首次拒绝分支，OPEN 查询不能清掉未知结果。显式读取到目标已 CLOSED 时可解除该目标的关班锁，文案仅陈述最终快照，不冒称该次关班由本客户端再次执行。原开班 unknown 只靠当前活动班次不能证明成功，须原 key 重放，或读取已保存 resultId 的凭证。
- 新增 `CashShifts.vue`，提供可发现的“现金交班”导航、店主开班、真实收退款笔数/金额/净额/应有金额、实点/差额预览、差额原因、带确认勾选的关班弹窗、店员只读、历史状态筛选/分页与固定闭班快照。活动班次 GET 未成功时不展示“没有班次”或开班表单。恢复区可聚焦，刷新发现原 pending，需明确恢复，不自动开下一班。
- App 加入独立 shift busy/pending 导航锁，与现金、挂单、退款、取餐、商品锁 OR；恢复发现优先保留现有现金/退款/挂单恢复路线，不能通过进入交班绕过未知现金。退出、切店、导航、刷新、beforeunload 同受锁保护。会话清理保留原身份的恢复记录。
- Cashier 新现金操作先读取活动班次；未开班保留原单/实收输入并提供店主开班入口。首次确定 SHIFT_REQUIRED 不伪装 unknown；此前已 unknown 的现金随后 SHIFT_REQUIRED，或 GET 仍 UNPAID，都保留原订单、实收金额和锁。只有真实 PAID 现金凭证或最终关闭事实可解除。补齐现金响应、订单查询在卸载/身份/门店变更后的发布保护。
- Web Orders 原直接现金 POST 改为最小 handoff：先 GET 原订单，再携带原实收金额进入现有 Cashier 状态机，跳转不收款。已有 cash unknown、已付/另一订单、跨店收银提示、退款/挂单/交班 pending 或损坏记录均禁止覆盖。通过真实 Orders SFC 验证原单/金额保留与无自动 POST；没有新增第二套现金状态机。
- shared 退款增加兼容的可选 `beforeNew` 与 `checkNew` 预读钩子，Web 在核对退款和新提交前检查活动班次，原 unknown 恢复跳过新班次预读。首次确定 SHIFT_REQUIRED 保留金额和原因，保存 definitive rejected 后清理本次 attempt，允许去开班；若清理失败继续锁并保留可只读清理的 rejected 事实。此前 unknown 不走此分支。退款可编辑输入按身份/门店保存，导航开班、返回后 GET 原订单并恢复金额/原因，不自动退款。
- `CashReceipt.vue` 使用真实 shiftId 展示收退款班次，nullable 旧凭证标明“历史收款/退款未归班”，不根据日期推断。金融错误文案及 Feedback 保留 requestId 显示。
- 页面新增样式以 14px 为基准、窄屏可换行，沿用全局 reduced-motion 并为新区域显式禁动画。实际像素/窄屏截图验收交由 root，未把源码或组件测试当作真实浏览器验收。

## TDD：真实 RED / GREEN 证据

1. `node --test packages/mini-core/tests/cash-shifts.test.mjs`
   - RED：18 tests，0 pass / 18 fail；断言 `shared controller must be exported`，实际 undefined，预期 function。此时尚无生产模块或导出。
   - 首轮 GREEN：18 / 18。后续按新边界先写 RED，最终该文件 21 项全部纳入共享完整 suite 通过。
2. `node --test --test-name-pattern='SHIFT_REQUIRED|missing.shift|prior unknown cash' packages/mini-core/tests/cash-refunds.test.mjs apps/merchant-web/src/cashierSetup.test.mjs`
   - RED：3 tests，1 pass / 2 fail；实际 Cashier `unpaid GET is not a receipt fact`（false != true）；shared 首次退款 SHIFT_REQUIRED 仍 blocked（true != false）。首次 Web 收款在可读 GET 时原已有部分正确行为，未把该通过项声称为新 RED。
   - GREEN：3 / 3，后随新预读回归组合运行 4 / 4。
3. `node --test apps/merchant-web/src/cashShifts.test.mjs`
   - 最初 RED：0 / 5；CashShifts SFC 尚不存在，Orders 两项实际行为因发出了 1 次 POST（预期 0）失败。
   - SFC 实现后首轮 5 / 6：关班弹窗通过 Teleport 输出，测试渲染器起初只读主 HTML；补上实际 SSR Teleport 内容后 6 / 6。该渲染夹具修正不作为产品缺陷。
4. `node --test --test-name-pattern='new refund checks|new Cashier payment' packages/mini-core/tests/cash-refunds.test.mjs apps/merchant-web/src/cashShifts.test.mjs`
   - RED：0 / 2；未调用预读钩子（0 != 1），Cashier 已发现金 POST（1 != 0）。实现后全部纳入 GREEN。
5. `node --test --test-name-pattern='refund input|App discovers' apps/merchant-web/src/cashShifts.test.mjs`
   - RED：退款输入回归失败 `saveRefundForm is not a function`；App 恢复/OR 行为已通过。
   - GREEN：2 / 2。两次挂载测试改为真实卸载再挂载，避免夹具 globals 清理顺序造成无关 window 错误。
6. `node --test --test-name-pattern='two already|explicit recovery|refund review' packages/mini-core/tests/cash-shifts.test.mjs packages/mini-core/tests/cash-refunds.test.mjs`
   - RED：0 / 3；第二个已挂载控制器发了 POST、CLOSED 事实仍锁、核对退款的预读方法不存在。
   - GREEN：3 / 3。
7. `node --test --test-name-pattern='conflict followed' packages/mini-core/tests/cash-shifts.test.mjs`
   - RED：原冲突 requestId 被随后的 GET 错误覆盖，undefined != revision-r。
   - GREEN：1 / 1，原编号保留。
8. `node --test --test-name-pattern='disposed Cashier' apps/merchant-web/src/cashShifts.test.mjs`
   - RED：销毁后的迟到现金响应仍把 state 变 PAID，实际 PAID != UNPAID；同时触发不应发生的后续查询。
   - GREEN：1 / 1，原 unknown 保留，响应不发布，运行约 1 秒，无残留 15 秒查询定时器。
9. `node --test --test-name-pattern='failed current GET' apps/merchant-web/src/cashShifts.test.mjs`
   - RED：GET403 后仍渲染“确认开班”；错误也被随后历史查询覆盖。
   - GREEN：1 / 1，不冒称没有活动班次，不显示开班表单，保留请求编号。
10. `node --test --test-name-pattern='first missing shift with failed removal' packages/mini-core/tests/cash-refunds.test.mjs`
    - RED：首次明确拒绝但清理失败后仍记作 unknown，实际 unknown != rejected。
    - GREEN：1 / 1，保留 rejected 事实，之后只读核对可清理，无再次退款。

## 最终验证

均使用隔离 transport/storage 夹具；Vite SFC 通过 middleware 加载真实组件，未连接源 API 或浏览器源服务。

| 命令 | 最终结果 |
| --- | --- |
| `pnpm --filter @restaurant/mini-core test` | **178 / 178**，0 fail / cancelled / skipped，exit 0 |
| `pnpm --filter @restaurant/merchant-web test` | **74 / 74**，0 fail / cancelled / skipped，exit 0 |
| `pnpm --filter @restaurant/merchant-web build` | `vue-tsc --noEmit && vite build` 全部 exit 0；1658 模块，产物 JS 295.36 kB / gzip 95.81 kB |
| `git diff --check` | exit 0 |

完整测试曾出现原/新 Vite 测试夹具竞争默认 WebSocket 端口的警告，虽然测试通过，不将该轮称为 pristine。自查后 Web 测试显式 `hmr:false, ws:false`；shared 既有 mini-render 夹具 `hmr:false`。随后有新测试/修复及夹具变更作为重跑依据，最后上表 suite 均无 WebSocket、Vue warn、WARN 或 ERR_ 输出。未停止任何既有服务，也未为了警告反复运行无关广泛 suite。

实际行为覆盖：店主/店员权限，汇总/差额/非零原因，explicit close 勾选前不写，原请求恢复，离线和鉴权失败，恢复/Modal 焦点、Tab trap/Escape、卸载恢复焦点，App 多锁 OR，刷新发现、跨店唯一 pending，原订单与实收/退款输入保留、无自动现金写。

## 文件范围

- shared：`packages/mini-core/src/cash-shifts.mjs`、`index.mjs`、`cash-refunds.mjs`。
- shared 测试：`tests/cash-shifts.test.mjs`、`cash-refunds.test.mjs`；`cashier-drafts-mini-render.test.mjs` 仅禁测试 HMR，未修改 mini 业务实现。
- Web：`CashShifts.vue`、小型适配 `cashShifts.mjs`、`App.vue`、`Cashier.vue`、`Orders.vue`、`CashRefund.vue`、`CashReceipt.vue`、`Feedback.vue`、`checkoutTransitions.mjs`、`domain.mjs`、`types.ts`。
- Web 测试：`cashShifts.test.mjs`、`cashierSetup.test.mjs`。
- 本报告。无新依赖。两份旧 catalog untracked diff 未暂存或改动，root 文档不属于本提交。

## 自查与限制

- 修复了自查中发现的并行控制器覆盖 pending、首次明确拒绝清理失败、GET 错误假空状态、冲突编号丢失、Cashier 销毁后迟到响应问题，均有对应先 RED 后 GREEN。
- 可选退款预读钩子不改变现有 mini 调用签名；merchant-mini / useMerchant 的班次集成及真实回归按 root 明确边界留 Task 3。本任务没有代改该端。
- shared storage 继续采用现有约定：缺失必须为 undefined，存在的空串/null 为损坏。Web adapter 复用既有实现；mini 后续须复用能枚举键、区分缺失的既有 uni adapter，不能直接把缺失空串当正常记录。
- Cashier/Orders 为已有较大组件，本任务仅作收银入口与恢复的必要改动，没有重构其他业务。Orders 改为 Cashier handoff 是 root 已明确批准的最小集成，避免复制金融状态机。
- 未执行源 API 请求、源 SQL、seed/reset/generate/迁移、服务启停或源业务写。本任务未声称真实浏览器/数据库端到端、窄屏截图、微信真机或生产验证。root 独占负责真实开班→新现金→关班、slow/lost-receipt、离线刷新发现、旧 revision409、只读 SQL 与视觉验收。独立代码审查尚由 root 后续安排；本报告是实现者自查和隔离验证证据。

## 独立审查修复追加：恢复组合与内容留白（2026-10-21）

依据 `.superpowers/sdd/cash-shifts-web-fix-brief.md`，修复独立审查的 Important（未挂载交班组件时持久 pending 丢锁）与 Minor（panel 正文、表单、按钮贴边）。原实现和上文的历史验证记录保持原样；本节是本轮修复证据。

### 修复内容

- App 在实际 `load` 时独立发现本身份的 shift pending / 损坏记录，与现金、退款、挂单及已有 busy 锁 OR 合并，不再依赖 CashShifts 是否挂载。导航、切店选择、退出、刷新按钮和 App 级 beforeunload 均受到该锁约束；进入旧现金/退款/挂单恢复页不会释放 shift 锁。
- 保留现有恢复路线优先级；从持久现金状态也可发现原 unknown，不再完全依赖可丢失的 `merchant-active-checkout` 导航提示。界面提供明确的“前往恢复交班”入口，只有其他原金融操作已核对且当前组件不忙时才进入持久记录中的原门店，转页不发金融 POST。退款核对后若仍有原现金/挂单记录，另有“继续核对原操作”入口，避免多个独立锁形成无出口的导航锁。
- Cashier 新现金操作在预读前后及真正发新现金前检查持久 shift；Orders 新退款核对/提交沿现有 `beforeNew` 钩子检查同一记录。未挂载 CashShifts、同身份另一门店 pending 或损坏记录同样拒绝新收退款，原订单、实收、退款金额和原因保留。已有现金/退款 unknown 仍按原订单/key/body 恢复，不改成新操作，也不自动重放。
- 补上“原下单 unknown 恢复出正式订单后，不得顺势开始新现金”的边界：仅允许恢复原订单创建，保留正式订单与实收输入，待交班核对后再由用户明确收款。已有现金 unknown 的原收款恢复继续可用。
- CashShifts 当前班次正文/表单、历史条目/空态、明细和恢复区统一使用内容 inset；桌面横向 25px，与 panel-title 对齐；1000px 以下统一 20px，与现有响应式 header 对齐。表单底部留白、记录内部分隔和 panel 间距一致，保留 14px、换行及 reduced-motion。没有添加镜像 CSS 正则测试。

### 本轮 TDD 证据

1. `node --test --test-name-pattern='App refresh|persistent shift|cash unknown plus|refund unknown plus|clearing shift|App discovers' apps/merchant-web/src/cashShifts.test.mjs`
   - RED：**0 / 8**。实际 App load + retained unpaid checkout + shift pending/损坏均为 `navigationLocked: false !== true`；实际 Cashier 发出新金融 POST，`1 !== 0`；实际 Orders 新退款核对 `true !== false`。旧 App OR 用例改为直接验证持久记录，不再以手动 `shiftBusy=true` 代替发现恢复状态。
   - GREEN：**8 / 8**，exit 0。覆盖保持 Cashier 路线、原班次跨店、切店与退出真实模板 disabled、navigate / requestLogout 无效、beforeunload、显式交班转页、原现金/退款 unknown 恢复与剩余锁。
   - 首次 RED 中一个后续断言失败使嵌套测试清理顺序产生 Vue unmounted hook 警告；后续组合测试将内层组件放入 try/finally 显式先卸载。早期 GREEN 还有原 App 测试删除了错误夹具 Map 的失败，修正为删除实际 storage backing Map 后通过。两者未当作产品缺陷或产品 RED 证据。
2. `node --test --test-name-pattern='recovering original order creation' apps/merchant-web/src/cashierSetup.test.mjs`
   - RED：**0 / 1**，恢复原下单后发了两次 POST（订单 + 新现金），`2 !== 1`。
   - GREEN：**1 / 1**，exit 0；仅原订单 POST，验证原 key、正式订单、实收及 `SHIFT_RECOVERY`，无新现金 POST。
3. `node --test --test-name-pattern='without navigation hint|return to remaining original' apps/merchant-web/src/cashShifts.test.mjs`
   - RED：**0 / 2**；现金 durable unknown 无导航提示时实际路由 `shifts !== cashier`；退款恢复后缺少 `recoverOriginal` 安全转交入口。
   - GREEN：**2 / 2**，exit 0；恢复优先保留原操作，退款核对后仍可明确回到剩余现金恢复，交班锁不丢。
4. 补充既有路径覆盖：`node --test --test-name-pattern='draft conversion recovery' apps/merchant-web/src/cashShifts.test.mjs`，**1 / 1**。实际 App 选回 Cashier，真实 draft controller 以 GET 核对正式订单，原 key 保留、draft pending 清除，仍有 shift 锁，显式交班前后无自动金融 POST。此项首次即通过，仅作为回归覆盖，不声称新 RED。

### 本轮最终验证（一次受影响专项 + Web 类型/构建）

| 命令 | 实际结果 |
| --- | --- |
| `node --test packages/mini-core/tests/cash-shifts.test.mjs packages/mini-core/tests/cash-refunds.test.mjs apps/merchant-web/src/cashShifts.test.mjs apps/merchant-web/src/cashierSetup.test.mjs` | **89 / 89**，fail / cancelled / skipped 均 0，exit 0，1630ms；无 Vue warn / WebSocket / WARN / ERR_ 输出 |
| `pnpm --filter @restaurant/merchant-web build` | `vue-tsc --noEmit && vite build` exit 0；1658 模块；JS 297.86 kB / gzip 96.54 kB；Vite build 2.53s |
| `git diff --check` | exit 0 |

未重跑无关 broad suite。修改仅 `apps/merchant-web/src/{App.vue,CashShifts.vue,Cashier.vue,Orders.vue,cashShifts.mjs,cashShifts.test.mjs,cashierSetup.test.mjs}` 与本报告；shared 源码/API/schema/DB/mini 均无变更，无新增依赖。

自查确认：清除现金或退款记录仍保留班次锁，单独清除班次仍保留真实现金 unknown 锁；转交恢复仅导航/GET，不自动重放。App/Cashier/Orders 为既有较大文件，本次只补必要 guard 与转交入口，未重构其他业务。测试使用 Vite middleware 加载真实 SFC 与隔离 storage/fetch，未连接源 API 或浏览器源服务。

已实际查看 root 留存的 `output/playwright/cash-shifts-web-empty-mobile-stable.png`、`cash-shifts-web-empty-desktop.png`，确认修复前内容/按钮贴边问题。本轮未控制浏览器或重截源页面；修改后的 390px 实际溢出、像素对齐、触点、真实金融与数据库端到端仍由 root 在独立复审后验收。未执行源请求、源业务写、SQL、seed/reset/generate/迁移或服务启停；未派子代理。两份旧 catalog diff 与 root 文档不暂存。
