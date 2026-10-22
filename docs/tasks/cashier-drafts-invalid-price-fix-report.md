# Web 失效草稿金额呈现修复报告

日期：2026-10-21。分支：`codex/restaurant`。派发基线：`8796b0db357cf5146abeeeedaeff39ca2c04ac11`；实施开始时 HEAD 为 root 后续文档提交 `80ef946`。

## 问题与最小修复

按 brief、`D:/Codes/开发规范.txt`、implementer contract、systematic-debugging、TDD、verification-before-completion 执行，未派子代理。

沿真实调用 `takeDraft → hydrateDraft → selectionLine` 追踪：失效选择无法重建价格时，hydrate 保留原 SKU、数量、选项 ID、display、issue，并将内部价格/可售库存兜底为 0。原 Web 模板无条件格式化行价和合计，导致失效行显示 `¥0.00`；混合其他有效行时，会把有效行部分合计展示为整单预估。

只修改 Web 呈现：

- `Cashier.vue` 为 `Line` 声明已有的可选 `issue`；用 `linePricePending` 同时检查 hydrate 遗留 issue 和当前 `lineIssue`，用 `cartPricePending` 汇总同一规则。未形成正式订单的未知行金额显示“待重新核价”；无 quote/order 时只要有未知行，整单预估同样显示“待重新核价”。有效行仍可显示其行金额。
- 保留 hydrate issue 很关键：菜单刷新后原选项重新可售，`cartSelectionIssue` 可能已通过，但袋内仍是旧 fallback 0。仅刷新菜单不会把该数值重新解释为免费；明确重新取单/hydrate 或重选后才展示重新解析的价格。
- 服务端 order/quote 金额继续使用原有 `order.totalFen ?? quote.totalFen`，包含真实 0；正式订单只读快照、已付金额和金融恢复逻辑未修改。有效且无 issue 的 0 元商品仍显示 `¥0.00`。
- 未修改选择 ID/display、数量、原失效提示和现有核价禁用条件；未修改 mini/shared/API、事务、依赖或服务。

## 实际 SFC 行为测试

在现有 `cashierSetup.test.mjs` 中增加 8 个行为用例；沿 Vite 加载真正 `Cashier.vue`，执行 setup/lifecycle，再 SSR 渲染真实模板，未使用源码字符串断言。

新增 fixture 只在本测试进程的 fetch/sessionStorage mock 中运行，响应均检查 GET，既不连接源 API，也不写源数据库。菜单对象逐例创建，现有 harness 在每例卸载组件并恢复全局存储/窗口；未产生需源库清理的数据。

覆盖：停用原口味、缺失原口味，各自有/无其他有效行；原商品/规格/少辣展示、原 SKU/属性 ID/数量、内部 fallback 0 保留、现有核价 disabled；有效行 `¥24.00` 不冒充整单预估；菜单刷新恢复可售但未重新 hydrate 时仍待核价、随后明确重新取单显示 `¥60.00`；真正有效 0 元行/总预估；失效本地行不影响 quote 的 0/4321 分服务端金额。原有实际订单 2 件/6160 分、原历史属性快照、未知现金冻结金额/key、恢复失败保锁等实际 SFC 用例继续通过。

## TDD RED 证据

生产代码修改前运行：

```text
pnpm --filter @restaurant/merchant-web exec node --test src/cashierSetup.test.mjs
ℹ tests 22
ℹ pass 18
ℹ fail 4
exit 1
```

4 个停用/缺失口味测试因缺少预期行价文案正确失败，失败原输出包含：

```text
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /<strong>待重新核价<\/strong>/.
<p class="notice">所选口味已失效，请重新选择</p>
<strong>¥0.00</strong>
```

随后让混合行优先断言总预估，并在生产代码修改前重跑：

```text
pnpm --filter @restaurant/merchant-web exec node --test --test-reporter=dot src/cashierSetup.test.mjs
.XXXX...............
..
exit 1
```

两个混合行用例因总预估文案缺失失败，原输出包含：

```text
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /<div class="payment-total"><span>商品合计（预估）<\/span><strong>待重新核价<\/strong>/.
<div class="payment-total"><span>商品合计（预估）</span><strong>¥24.00</strong></div>
```

最初使用当前 `lineIssue/invalidCart` 的呈现修复获得 22/22 GREEN 后，向 root 报告菜单重新可售但 fallback 未重建的同根因边界。root 明确要求同时考虑原 hydrate issue；先增加真实 `refreshMenu()` 回归，再运行：

```text
pnpm --filter @restaurant/merchant-web exec node --test --test-name-pattern='after menu availability returns' src/cashierSetup.test.mjs
✖ actual cashier keeps an unresolved hydrated price pending after menu availability returns
ℹ tests 1
ℹ pass 0
ℹ fail 1
exit 1
```

该失败先确认 `invalidCart === false`、原 hydrate issue 仍存在、袋内 `unitPriceFen === 0`，实际模板又显示 `¥0.00`，因此正确暴露只看当前可售检测仍会误报免费。随后才加入保留 issue 的呈现 guard。

## GREEN 与最终验证

最终实现完成后运行：

```text
pnpm --filter @restaurant/merchant-web exec node --test src/cashierSetup.test.mjs
ℹ tests 23
ℹ pass 23
ℹ fail 0
ℹ skipped 0
exit 0

pnpm --filter @restaurant/merchant-web test
> node --test src/*.test.mjs
ℹ tests 59
ℹ pass 59
ℹ fail 0
ℹ skipped 0
exit 0

pnpm --filter @restaurant/merchant-web typecheck
> vue-tsc --noEmit
exit 0

pnpm --filter @restaurant/merchant-web build
> vue-tsc --noEmit && vite build
vite v6.4.1 building for production...
✓ 1653 modules transformed.
dist/index.html                   0.53 kB │ gzip:  0.36 kB
dist/assets/index-Do_S7tYW.css   31.98 kB │ gzip:  7.72 kB
dist/assets/index-BLG3Wzy7.js   272.30 kB │ gzip: 89.53 kB
✓ built in 2.50s
exit 0

git diff --check
无输出，exit 0
```

以上为真实执行结果摘要；最终 focused/full suite、类型检查和构建无 warning/error。最终 Web 全 suite、typecheck、build 各运行一次；shared/mini 无改动，未运行其 suite。

## 文件、自查与限制

本人交付只包含：

- `apps/merchant-web/src/Cashier.vue`
- `apps/merchant-web/src/cashierSetup.test.mjs`
- 本报告 `docs/tasks/cashier-drafts-invalid-price-fix-report.md`

自查：金额未知使用状态/issue 判断，未以数值 0 作为未知条件；整单未知不使用有效行部分合计；order/quote 的非空优先级保留 0；没有复制金融状态机、重算历史快照或新增业务写入；原核价控制和选择恢复规则未扩展。现有 Cashier.vue 较长，本次只加入必要呈现 guard，未结构重整。

本交付证明 Web SFC 行为和本地构建通过。未源写、未开单/收款/退款、未停服务、未 generate/迁移/升级依赖，也未修改 root 文档及两个旧 catalog review diff。真实 A 配置停用→取单→恢复及源 SQL 验证由 root 在独立审查后执行，本报告不将隔离 fixture 或构建视为真实业务验收，不声称真机或生产验证。
