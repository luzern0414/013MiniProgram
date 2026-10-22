# Task3独立审查Important修复：真实订单快照

只有root明确派发后实施，当前另一Web修复实现者结束前不得开工。D:/Codes/013MiniProgram，遵循D:/Codes/开发规范.txt、TDD、systematic-debugging、verification-before-completion，不派子代理。

原需求为.superpowers/sdd/cashier-drafts-mini-brief.md，原报告docs/tasks/cashier-drafts-mini-report.md。Task3实现8796b0d独立review Needs fixes，一个Important：恢复其他员工转换订单后仍展示旧购物袋和旧报价。review只用隔离probe，无源写：server order total2400/quantity2，local cart qty1/quote1200、blocked=false。recover('read')发布drafts.order，但仅action reload时替换selection；CashierPanel无条件CashierSelection并显示drafts.quote。真实订单在下面点详情可正确读取，不能用那一页正确抵消当前页矛盾。

## 要求

有正式drafts.order时收银面板直接显示服务端真实只读订单快照：商品、规格、历史属性/加料、数量、每行金额、总额、模式、桌台或取餐窗口、备注以及状态。隐藏旧本地购物袋的明细/数量/估价、旧quote核价金额及转单操作，不能将旧本地袋伪装正式订单；原输入可保留审计/恢复用途，不要求清除。真实订单后的“查看订单与收款”保持明确进入原现金入口，不自动确认现金，不解除已存在未知现金的原金额/key保护。保留已付/关闭真实事实和开始下一单确认，14px/reduced-motion。

按业务边界拆小型只读组件或现有CashierPanel模板，不将完整金融逻辑堆index或复制共享controller。报价不必为了显示而篡改shared数据；在正式订单上下文不可呈现旧quote即可。不能改Web/API或源业务，不迁移/seed/generate/停服务/升级依赖。

## 测试与交付

先补实际Vue组件渲染行为RED（可沿Web实际SFC+SSR思路，使用本项目已有Vue3.4 compiler/runtime，不新增依赖）：真实order2份2400与本地cart1份/quote1200同时存在，模板必须仅显示真实订单行及2400、历史属性/加料/桌台/note，原cart保留、无旧核价1200/旧编辑操作；没有order时原选菜/核价仍可用，真实0元金额不误判未知。adapter恢复probe到真实组件组合覆盖，不能只用源码正则或复制模板作为业务证明。

保留cashier-drafts-mini.test.mjs原23项及共享143边界；新增必要组件测试，报告准确RED/GREEN命令/输出。最终执行受影响mobile/shared suite及merchant H5/mp-weixin构建、diff检查；Web/customer无改不必重复五构建，引用原Task3报告明确范围。追加docs/tasks/cashier-drafts-mini-report.md修复段，独立显式提交本人mini组件/adapter必要改动及测试/报告，Codex/codex@local.invalid。不要暂存root文档/ledger或两个旧catalogdiff。

返回DONE/commits/一行验证及具体concerns，root原reviewer独立复审，再继续真实跨端UI/SQL。
