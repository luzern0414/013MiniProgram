# 手机刷新恢复创建后的商品名称

工作目录D:/Codes/013MiniProgram，分支codex/restaurant，遵循D:/Codes/开发规范.txt。仅一个实现者，不操作root真实浏览器/服务/API/DB。

## 真实复现与根因

Task3手机E（cmvgz2i15002n3mdskh97v9xa）真实POST201后丢回执→刷新→按原key/body明确恢复创建201，只有一个草稿/一条创建审计。随后购物袋可编辑且金额30.80正确，但名称仍“原商品 · 原规格 ×1”，而服务端display为“验收菜品·桂花鸡腿饭 · 标准”，菜单也有真实名称。

createMiniCashier初始化时pending.edit.selection先以空catalog和默认空display applySelection；loadMenu仅赋catalog；recover('replay')不更新state.cart显示字段，所以此前空fallback一直保留。真实explicit reload远端后名称正常，说明后端事实无缺失。所有源E异常/401验收已结束，源E当前DRAFTrev1无pending，root会保留该记录。

## 要求

- 最小修复apps/merchant-mini/src/cashier.js恢复呈现：刷新恢复原create成功后，在已有真实菜单或远端display可用时显示可核对的商品/规格/属性/加料名称。需要时也覆盖刷新后读取未知update结果的同一恢复显示路径。
- 原pending中selection的SKU/口味/加料ID/数量、mode、桌码/slot、note、name必须原样保留；“读取”不自动接受远端编辑，明确reload才替换。保留unknown锁、scope/generation、幂等key/body，不触发自动写、收款或转换。失效选择不能消失或当免费，继续提示待核价。
- 不扩展到全局UI或改变shared金融规则。不用自动再次取单覆盖本地输入来刷新名称。
- 在既有packages/mini-core/tests/cashier-drafts-mini.test.mjs加真实adapter行为RED/GREEN：pending create恢复→先空菜单再loadMenu→原key/body replay返回远端display→可见字段正确、原输入/所有选择不变、无额外写；按需要覆盖update read保留原输入。测试真实生产adapter，不复制实现；运行受影响mini测试及render、merchant双构建，不重复Web/顾客suite。
- 不新增依赖、不迁移/seed/generate、不启停服务、不访问源数据库或root浏览器，不暂存旧catalog-api两份untracked diff。

报告追加docs/tasks/cashier-drafts-mini-report.md，记录RED/GREEN实际命令与失败/通过输出、提交范围及自查；仅提交自己内容，git身份Codex/codex@local.invalid。返回状态/SHA/测试一行/报告路径。独立review后root再做真实页面复验，不提前宣称真实E重放通过。
