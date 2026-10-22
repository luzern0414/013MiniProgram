# Task2交班恢复组合与布局修复

原需求 .superpowers/sdd/cash-shifts-web-brief.md 仍全部适用，报告追加到docs/tasks/cash-shifts-web-report.md。root已于c465c75派发唯一cash_shifts_web_fix。原实现f4bbb69，独立审查cash_shifts_web_review最终Needs fixes：一项Important（以下持久OR锁）和一项Minor（以下卡片留白），无其他Critical/Important。

## Important：持久班次pending不能因恢复路由而失去锁

App.vue load仅在page为dashboard时才采用readShiftAttempt；navigationLocked只采用CashShifts挂载后发出的shiftBusy。因此已有merchant-active-checkout时，开班unknown刷新可进入Cashier，班次组件未挂载，shiftBusy为false；原现金入口/导航/切店/退出不再考虑该班次pending。需要将持久班次pending或损坏记录独立于当前页面纳入锁，并保证原收银/退款/草稿未知操作仍可按原身份恢复；这些恢复完成后有明确入口转交班，不得只提高路由优先级而覆盖其他金融unknown。

先实际App组合恢复RED：保留未付checkout提示、持久班次unknown或损坏、刷新实际load，验证现金/新退款/导航/切店/退出锁；不以手动shiftBusy=true夹具代替。补同身份跨店、原现金unknown+shiftunknown及原退款unknown+shiftunknown、清除一个仍保留另一锁、恢复完成后的明确交班路径，禁止自动金融POST。未挂载班次组件也必须发现并约束新金融写；不能以禁止导航形成永久死锁。

## 视觉留白

root稳定真实截图output/playwright/cash-shifts-web-empty-desktop.png和cash-shifts-web-empty-mobile-stable.png已查看：正文、表单贴panel边框，按钮贴底，标题与内容不对齐。适配现有panel/header内边距，统一正文/表单/历史条目/详情/空态与底部留白。保持390px无横向溢出、14px及触点可达、reduced-motion；纯样式不写镜像CSS测试，root用真实截图验收。

## 实施边界

只改shared/Web必要文件及真实行为测试、原Task2报告；不得改API/schema/DB/merchant-mini，不派子代理，不源请求/写/seed/reset/generate/迁移或停服务。遵循开发规范、systematic-debugging/TDD/verification-before-completion。相关覆盖为apps/merchant-web/src/cashShifts.test.mjs、cashierSetup.test.mjs及受影响shared班次/退款专项；先RED后GREEN，最后Web类型/构建，不无故重跑全部无关suite。显式提交本人文件，Codex/codex@local.invalid；两旧catalog diff及root文档不得暂存。返回状态/SHA/一行验证，报告追加真实命令输出及限制，root再独立复审。
