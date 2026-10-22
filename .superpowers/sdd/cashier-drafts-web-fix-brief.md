# Task2 独立审查修复

先读本文件与原 brief `.superpowers/sdd/cashier-drafts-web-brief.md`，遵守其 Global Constraints。基线 b3c6f38。工作目录 D:/Codes/013MiniProgram。

独立审查的两个 Important 已由 root 检查对应源码，需修复并独立复审后才真实业务验收：

1. `cashierDrafts.mjs` createDraftTakeover.accept 异步 load 期间，cancel 只清 candidate，迟到完成仍 apply 并覆盖原购物袋。补真实可控 Promise 行为 RED→GREEN；取消必须真正阻止替换，重复 accept、选择改变等异步边界需妥善处理。避免只改变弹窗但仍使远端选中状态污染当前袋；结合 CashierDrafts.vue 和 controller 读取实际集成判断最小稳妥修复。
2. `Cashier.vue` recoverDraft 使用 RECONCILED 读取别的员工转换的订单时，旧 quote/submittedFen 仍存，实收输入禁用；后续 SUBMIT 继续拿旧金额。示例旧 quote1000/submittedFen1000，真实 order2000，用户明确输入20.00后仍发送1000。需建立明确的已核对草稿绑定订单→重新确认实收的衔接，真实 order 金额为准，原未知转单请求/key保留至可靠核对完成，不自动收现金。保留已有未知现金重放的冻结金额/原key，不能无差别清空原金融恢复。补 Web 集成衔接的可执行行为测试，不能只测一个未被真实调用的新 helper。

阅读 D:/Codes/开发规范.txt，使用 systematic-debugging、test-driven-development 与 verification-before-completion。只一个实现者，不派子代理。仅修改必要 Web/shared/types/tests，以及追加 docs/tasks/cashier-drafts-web-report.md 的修复报告。不得源库业务写、停服务、generate、迁移、依赖升级；不修改 root README/config/ledger/验收。两个旧 catalog review diff 不得暂存。

每项先运行覆盖行为测试观察正确 RED，再最小修复 GREEN。覆盖文件至少 apps/merchant-web/src/cashierDrafts.test.mjs、checkoutTransitions.test.mjs（或实际接线 helper 的行为测试）；涉及 shared 时 mini-core 对应测试。最终一次 Web suite/typecheck/build，shared 有改动则 mini-core suite。报告命令、真实失败/通过输出、范围、残余风险，提交本人文件，身份 Codex/codex@local.invalid。完整报告追加原报告，返回 DONE/concerns、commit、一行测试；勿把构建等同真实验收。
