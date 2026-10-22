# Task 2：现金退款前端实施报告

日期：2026-10-20。基线 `e15cdf4711bbc6c1df7681b6b8e39bfa26ec453a`。实现提交 `0f5eb4d`（feat: add recoverable cash refund interfaces and receipts），本报告单独文档提交。范围按 `.superpowers/sdd/cash-refunds-ui-brief.md`，消费 Task 1 已批准 API；未修改 API、迁移、源数据或运行服务，未运行 Prisma generate，未造单、收款或退款。

状态：**已实现并通过前端行为测试和五构建，等待独立审查及 root 真实页面/业务验收**。没有标记真机、微信支付、源库退款或生产 verified。

## 改动

- mini-core 独立 `cash-refunds.mjs` 负责金额、持久恢复校验、发送前可靠保存、唯一 key、规范化载荷、拒绝/未知/已确认状态与订单重读。Web 和 merchant-mini 共用该控制器，不向订单页面堆入退款状态机。
- Web 独立 CashRefund、CashRefundRecovery、CashReceipt；两商户详情、顾客详情及 Cashier 已付/恢复区展示真实现金原入账、实收、找零、累计退款、净实收、金额/原因/时间及全退标记。已完成全退保留原完成状态与快照；无现金凭证不渲染现金凭证。旧收款无新增字段时按累计 0 / 原入账显示。
- 仅 OWNER 有新增/重放入口，控制器发送前也检查当前 OWNER；CLERK 可以真实重读凭证。服务端继续负责当前有效身份与门店授权检查。Web ApiError 保留 HTTP status，使明确拒绝与未知失败可区分。
- 金额默认空，按原入账减累计退款校验整数分，0.01 有效，不能以实收现金扩大余额。核对区显示本次/退后剩余、退款不增加商品库存、预约已确认产能保留；明确确认已交还现金后才发送。
- 退款 busy/blocked 与原核销 busy 合并，Web Orders 向 App 发合并锁，mini 保留独立原 pickupOperationBusy 并与 refundBusy 计算合并；关闭详情、切店、导航、退出及其他订单写入受锁，原锁释放不能提前解除另一锁。Web beforeunload、mini onBackPress/H5 beforeunload 接入。
- 登录后发现本人待核对记录自动进入原授权门店的订单区；退款恢复区域可直接真实读取原订单或显式重放。Web 的 modal 内外均有相应恢复入口，不要求先手工找回订单。损坏记录展示核对指引并禁止新增。
- 保持暖白/深绿/橙色现有视觉，凭证用清晰金额行和退还明细竖线区分；表单轻微展开动效、reduced-motion，文字不小于 14px。mini 输入复用 AccessibleInput 绑定 H5 native input 的可访问名称，确认按钮有文字及 aria-pressed。

## 恢复与存储设计

每个身份一个 `cash-refund:v1:<userId>` 记录，跨门店发现，载荷含 version/userId/storeId/orderId/key/amountFen/trim 后 reason/phase。Web 存于 sessionStorage（沿现有会话隔离策略），mini 用 uni 同步存储；mini 读取 keys 区分不存在与已有空值/null，Web 缺省 null 映射为 undefined。已有空字符串、null、坏 JSON、不支持版本、缺字段、非法金额/归属等均 fail closed，不静默放行。读取失败同样 fail closed。

首次发送前先 set，再回读并逐字比较完整规范化记录；抛错或静默未保存均禁止 POST。busy 在保存前已加锁。只有保存可靠才能发送，原 key/金额/原因永不因新余额、编辑草稿或刷新而改写。未知请求不自动重试；重新加载恢复原尝试。GET 只更新真实事实，即使出现同金额同原因也保持 unknown；只有显式同 key/原载荷 POST 的确定响应，随后 GET 成功，才清本次恢复记录。成功响应缺少匹配订单/门店/现金凭证/退款集合时按 unknown 处理。

确定成功但 GET 失败，持久 phase=confirmed，继续锁并保留读取入口；后续只读就能完成确认，不再 POST。明确首次 400/409（以及此前从未未知的明确权限/不存在拒绝）持久 phase=rejected，必须成功重读原订单后才清尝试、允许编辑；原服务端 code/requestId 仍显示。未知之后的 401/403/409 不当作原写未成功，仍保留原恢复尝试。移除恢复记录失败也不解锁。

退出/会话过期沿已有会话策略清可见私有状态，保留本人持久记录供重新认证；另一身份不读取此 key。控制器 dispose 与 user/store/order 上下文检查禁止卸载后、身份改变、同店换单或跨店的异步响应发布到新上下文；旧恢复记录不因此删除。

## RED / GREEN（真实执行）

初始先编写业务测试并运行，7 项因尚无退款行为导出而 RED。另专门补充并观察了以下**真实行为断言 RED**，不是源码字符串测试：

```text
node --test packages/mini-core/tests/cash-refunds.test.mjs
pass 7; fail 3
an existing empty recovery value ... false !== true
a late refund response ... 1 !== 0
malformed success response ... false !== true
```

修正空值识别、上下文校验和成功响应完整性后 10/10 GREEN。后续分别先 RED 再修正：

```text
confirmed write waits for readable receipt ... /已登记/ did not match ''
tests 12; pass 11; fail 1

an existing null mini storage record ... false !== true
tests 13; pass 12; fail 1

read-only staff ... 1 !== 0
tests 14; pass 13; fail 1
```

最终退款共享专项 14/14，mini 会话/发现/锁集成 2 项，Web 存储与真实响应等待时的双 busy 合并 2 项，合计新增 18 项。覆盖 1 分钱、实收/找零不能扩大上限、原 key 原金额原因、重载、损坏/空/null/版本失败、抛错及静默存储失败不发送、重复点击、GET 失败、相同金额原因的其他退款不误认、明确拒绝后重读、401/403 未知保留、已确认写只读恢复、角色/身份/门店隔离、卸载与同店换单迟到响应、mini 登录发现/禁止导航退出写入、session expiry 及并发 busy 释放顺序。

## 最终命令与原输出摘录

所有命令在 `D:/Codes/013MiniProgram` 执行；以下最终轮代码之后无业务代码变化。

| 命令 | 结果 |
| --- | --- |
| `node --test packages/mini-core/tests/*.test.mjs` | tests 95; pass 95; fail 0; cancelled 0; skipped 0; exit 0 |
| `pnpm --filter @restaurant/merchant-web test` | tests 22; pass 22; fail 0; cancelled 0; skipped 0; exit 0 |
| `pnpm --filter @restaurant/merchant-web build` | vue-tsc --noEmit; 1646 modules transformed; built in 2.60s; exit 0 |
| `pnpm --filter @restaurant/merchant-mini build:h5` | Compiler version 4.66; DONE Build complete; exit 0 |
| `pnpm --filter @restaurant/customer-mini build:h5` | Compiler version 4.66; DONE Build complete; exit 0 |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | DONE Build complete; import dist/build/mp-weixin; exit 0 |
| `pnpm --filter @restaurant/customer-mini build:mp-weixin` | DONE Build complete; import dist/build/mp-weixin; exit 0 |
| `git diff --check` | exit 0，无 whitespace 错误，仅部分既有文件 CRLF→LF 提示 |

Web 最终原输出：

```text
vite v6.4.1 building for production...
✓ 1646 modules transformed.
dist/index.html                   0.53 kB │ gzip:  0.36 kB
dist/assets/index-Hyhj38ID.css   31.19 kB │ gzip:  7.60 kB
dist/assets/index-ZUEiQFYw.js   245.27 kB │ gzip: 81.51 kB
✓ built in 2.60s
```

首次 mp-weixin 构建观察到真实失败：`Invalid pattern ../../../packages/mini-core/src/CashReceipt.js for output.chunkFileNames`。按 systematic-debugging 对照现有应用内 Vue 组件路径，根因是 uni 编译器给应用目录外 Vue 文件生成相对 chunk 名。将纯展示 CashReceipt 放入各 mini 的本地 components；金额/请求/恢复仍共用 mini-core。随后双 mp-weixin、双 H5 全部重新构建通过。没有修改 Vite 配置绕过错误。uni 构建输出自带新版/托管推广提示，不是编译错误；没有运行其升级命令。

格式化使用临时 `pnpm dlx prettier@3.6.2`，未增加项目依赖或修改 lockfile。早期探测 `pnpm exec prettier --version` 显示本项目没有该命令，随后使用上述固定版本完成。

## 自查、限制与交付

- 对照 brief 全部 UI/恢复要求；原现金字段、订单菜品、原收款/预约逻辑未改写；全退履约关闭继续由服务端返回事实决定。
- 显式只暂存本任务前端、mini-core/types/tests 和本报告；两个原 catalog reviewdiff 保留不动；README/config/requirements/progress 留给 root。
- 本实现者没有使用源订单执行退款，也没有修改任何运行中服务；自动化只使用隔离内存传输/存储，不访问源 API。root 仍需真实页面操作、网络丢回执/离线恢复、真实余额及 SQL/库存/预约统计闭环验收；本报告不将构建成功等同于业务验收。
- 用户自行删除浏览器 sessionStorage、关掉整个 tab 导致现有 sessionStorage 生命周期结束或清除 mini 数据会失去本地恢复能力，这是指定存储介质边界；UI 不提供丢弃 unknown 的按钮。撤权后的 unknown 不能靠失败响应解锁，需原授权身份重新认证核对。损坏记录没有自动修复/清除入口，必须先人工核对。
- 实现提交 `0f5eb4d`；报告及代码共同交付，root 独立审查后再进行真实验收。

## 真实验收发现项修复（2026-10-20）

范围按 `.superpowers/sdd/cash-refunds-acceptance-fix-brief.md`；修复基线 `a837194893a65b3c8085eb465080e78e4fed0c71`。实现提交 `d5e71b2`（fix: clear recovered refund errors and duplicate mini receipt）。此前 Task2 已独立审查，root 在真实页面发现以下两项，本段仅记录实现者修复和本地验证；修复后的真实页面复验及独立复审仍由 root 执行。

- `packages/mini-core/src/cash-refunds.mjs`：`load()` 成功读取当前上下文且凭证完整后清除旧 `error`。根因是成功分支只更新订单及 notice，先前 GET 失败的 NETWORK 错误仍残留。新逻辑在已有 `read()` 的完整性及上下文检查后执行；失败 GET 仍保留错误与锁，不凭 GET 判断 unknown 退款成功，confirmed/rejected 的原清理和成功提示流程不变。
- `packages/mini-core/tests/cash-refunds.test.mjs`：新增真实控制器行为测试，先使 POST 结果未知、再使 GET 失败，验证 NETWORK/code/requestId、unknown 锁、原 attempt 及存储仍保留；GET 恢复后验证旧错误为空、发布最新真实订单、notice 仍要求原退款核对、attempt/key/规范化金额原因/存储完全不变，且写请求总数仍为 1。
- `apps/merchant-mini/src/pages/index/index.vue`：移除旧“现金收款凭证”三行重复区域，将唯一 `CashReceipt` 放在应收金额下方、履约操作上方。该现有组件继续展示真实原入账、实收现金、找零、累计已退、净实收及退款明细。未改写组件数据、订单状态、按钮权限、待现金收款或恢复流程；顾客/Web 无重复故未改。

### 本次 RED → GREEN 原输出

先仅添加行为测试，未修改实现，运行：

```text
node --test --test-name-pattern='successful GET clears a previous network error' packages/mini-core/tests/cash-refunds.test.mjs
tests 1; pass 0; fail 1; exit 1
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'network unavailable（NETWORK） 编号 network-request'
- ''
```

失败正是 GET 已成功但旧错误仍显示。随后最小修复成功读取分支，执行同一命令：

```text
✔ successful GET clears a previous network error while preserving the unknown attempt and original key
tests 1; pass 1; fail 0; exit 0
```

### 本次最终验证及自查

| 命令 | 本次真实结果 |
| --- | --- |
| `node --test packages/mini-core/tests/cash-refunds.test.mjs` | tests 15; pass 15; fail 0; cancelled 0; skipped 0; exit 0 |
| `pnpm --filter @restaurant/merchant-mini build:h5` | Compiler version 4.66（vue3）; DONE Build complete; exit 0 |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | DONE Build complete; import dist/build/mp-weixin; exit 0 |
| `git diff --check` | exit 0，无 whitespace 错误；仅 index.vue CRLF→LF 提示 |

共享会话契约、存储结构、权限、异步上下文判定与多 busy 合并均未变；原 confirmed/rejected、身份隔离和未知恢复专项随完整 15 项回归通过。未重复运行不受本次修复影响的 Web/customer 构建。uni 输出自带升级和托管推广提示，未执行其命令。

自查确认只有上述三份代码/测试文件及本报告属于本次提交；没有改后端、迁移、生成客户端、依赖或 lockfile，没有源库写入、造单、收款、退款、服务启停或重置。两个 catalog reviewdiff 及 root 的 brief/验收/README/config 均不暂存。金额、原 key 和完整凭证保留，既有 14px/reduced-motion 样式未改动。修复后业务 UI 未由本实现者操作，不将双构建或内存行为测试标为真实运行库复验通过；没有新增已知实现问题。
