# 手机正式订单长编号换行修复

本任务仅修复 Task3 真实视觉验收发现的长编号溢出。遵循 D:/Codes/开发规范.txt。工作目录D:/Codes/013MiniProgram，分支codex/restaurant。仅一个实现者；根代理拥有正在运行的 Playwright 浏览器、服务及源业务，不能操作这些资源。

## 已证实根因

真实订单cmvgyvec200243mdstj4t5f99编号R1792517893201757668AB03，merchant H5 390px；CashierOrderDetails.vue第一行.sheet-title width312/scrollWidth392，font26px、whiteSpace pre-line、wordBreak normal、overflowWrap normal，document.scrollWidth431。完整无空格编号作为长单词没有断行，撑出窄屏。截图output/playwright/cashier-drafts-mini-a-formal.png已实际查看。实际源订单COMPLETED/PAID，不要重放收款。

## 要求

- 修改商户正式订单明细呈现，用项目兼容 H5/mp-weixin 的最小样式/模板方式让订单编号及长动态文本在容器内完整换行，无截断、隐藏、字号缩到14px以下或全局overflow-x:hidden掩盖。
- 保留真实订单快照明细、状态、金额、备注、取餐历史及原挂单/现金未知结果锁，不改业务逻辑和合同。
- 仅编辑CashierOrderDetails.vue必要内容；若命名class需要局部组件范围可自行判断，不全局重构。
- 不新增测试仅断言CSS文本。根代理会在真实390px源页面复验；已存在cashier-drafts-mini-render.test.mjs的5项运行一次，merchant build:h5及build:mp-weixin运行确认编译，无新风险不重跑全部suite。
- 不改源API/DB/数据/配置/库存/令牌，不generate、不迁移、不seed、不启停服务、不新增依赖、不操作root浏览器。不暂存两份catalog-api旧untracked diff。

## 报告与提交

追加修复报告到docs/tasks/cashier-drafts-mini-report.md，记录根因、改动、实际命令/退出码、限制及自查。用git -c user.name=Codex -c user.email=codex@local.invalid commit提交仅自己内容；返回状态、SHA、测试一行及报告路径。独立审查后根代理真实视觉复验，不能提前声称390px通过。
