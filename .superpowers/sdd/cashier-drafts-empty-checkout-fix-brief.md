# Task2 实际页面验收：空收银恢复崩溃

root 在 ad094c4 独立复审 Approved 后实际验收，首笔挂单A cmvgw9zrv00033mdsffvhlhee 保存/GET/刷新成功，SQL挂单零业务变化成立。真实 CLERK tab3 首次打开收银，标题出现但组件空白；console明确 setup TypeError Cannot read properties of null (reading 'quote')，Cashier.vue 编译行85。root核查源码 `if (restored?.quote?.cashierDraft?.id === drafts.remote?.id) drafts.quote = restored.quote;`：无恢复时两边undefined相等，误入分支读null.quote。原恢复返回null为正常无记录。

修复首进空白购物袋/正常无恢复的初始化分支，不能靠写入假恢复记录或前端模拟数据绕过。补真正调用实际接线初始化行为的RED→GREEN，包含null/undefined、无draftRemote、无quote、匹配绑定恢复quote、不匹配绑定不借用quote；有原有效checkout恢复保持兼容。少量helper可在既有cashierDrafts.mjs，避免为一行代码创建过度抽象；测试不得源码字符串断言。保留两项已批准修复、未知现金原key/冻结额、Task2原brief约束。

先读D:/Codes/开发规范.txt及调试/TDD/验证技能。不派子代理。仅必要Web实现/测试以及追加docs/tasks/cashier-drafts-web-report.md。源已有A草稿，root保留其业务事实；不得源写、停服务、generate/迁移/依赖升级，不暂存root ledger/brief/验收和两个catalog diff。最终Web suite/typecheck/build一次；focused实际RED/GREEN命令及输出追加原报告。Codex/codex@local.invalid 提交，最终简短DONE+commit+测试。root复审通过后再实际CLERK验收，Task3仍未派发。
