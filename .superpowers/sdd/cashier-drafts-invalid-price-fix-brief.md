# Web失效草稿金额呈现修复

此brief仅root明确派发后实施，当前Task3 mini实现者仍在运行，同时一个实现者。按D:/Codes/开发规范.txt、systematic-debugging、TDD及verification-before-completion执行，不派子代理。源库/服务均不动。

## 已确认问题与根因

root真实Task2失效选择验收：通过配置UI停用A少辣后重新取A，原ID/display少辣保持、核价按钮disabled，但行价及“商品合计（预估）”显示¥0.00。证据记录在docs/acceptance/2026-10-20-cashier-drafts.md，脚本output/playwright/cashier-drafts-invalid-inspect.cjs；配置已从9→10→11恢复enabled，请勿为开发测试再源写。

追踪：mini-core hydrateDraft在selectionLine失败时保留原display/选择，unitPriceFen/available安全fallback为0并带issue；Web Cashier.vue行价无条件money(line.unitPriceFen*quantity)，estimated同样无条件求和。0是无法解析的内部fallback，不能表现为当前可售0元。商户mini新CashierSelection.amount已有失败分支“待重新核价”；不需要修改sharedhydrate或业务选择ID，不要把未知价格写回源库。

## 修复要求

只改必要Web呈现及实际SFC行为测试。无正式order时，失效行以“待重新核价”或同义明确文字代替fallback金额；无服务端quote且存在失效行时，预估合计同样明确未能核价，不把有效行部分合计冒充整单合计。存在真实order或quote的金额沿服务端字段，不受旧本地袋失效影响；历史快照/已付金额不得改变。真正有效且价格0的商品仍可以显示¥0.00，不能把所有0都误判未知。原失效提示、ID/display、数量及报价禁用保留，不自动替换选择。

## 验证与交付

先用apps/merchant-web/src/cashierSetup.test.mjs实际SFC/SSR模式写RED：一个无法解析/停用原口味草稿显示原名称/选择和未核价文案，不能将fallback0作为行价或总预估；有其他有效行仍不冒充整单合计。GREEN后覆盖真实正式订单6160及valid0不被误隐藏。使用测试环境隔离菜单/恢复记录，禁止SQL或源API写来造fixture。

最终focused实际SFC suite、Web完整suite、typecheck/build、git diff --check；报告真实命令/输出、为何RED、呈现边界及限制至docs/tasks/cashier-drafts-invalid-price-fix-report.md。只显式暂存本人Cashier.vue/对应测试/报告，Codex/codex@local.invalid提交；不要改merchant-mini/shared、root文档、旧catalog diff。返回简短DONE/commits/验证或具体concerns。root随后独立审查及实际A配置停用→恢复验证，不把测试fixture当源业务验收。
