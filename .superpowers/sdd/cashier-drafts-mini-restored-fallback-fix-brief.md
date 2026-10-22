# 恢复显示字段后续修复：已知名称不得被旧fallback覆盖

工作目录D:/Codes/013MiniProgram，分支codex/restaurant；D:/Codes/开发规范.txt及原brief .superpowers/sdd/cashier-drafts-mini-restored-display-brief.md全部约束继续生效。仅本任务实现者活动，不派子代理。

独立审查4ce91b8 Needs fixes，Important：cashier.js:52构造display时 ...line.display 在顶层productName/skuName/modifierNames之后，恢复初始化空catalog产生fallback；有效菜单后顶层真实名称已知，但display仍旧fallback；再空菜单/失效菜单刷新时旧fallback覆盖已知名称。reviewer真实adapter隔离探针输出Known product/Known sku→原商品/原规格。tests:282手动display:{}避开了该实际恢复状态。

请最小修复呈现优先级，使已知名称不被旧fallback覆盖，匹配远端display仍可提供可核对名称；避免把顶层未知占位反过来覆盖实际已有display。可以明确建立一致的呈现fallback，保持选择匹配。不得改变selection、数量、价格、configurationRevision、mode/table/slot/note/name、pending/key/body、写锁或正式订单原袋保护。失效项保留真实已知名称并阻止核价，不用取单/写操作覆盖原输入。

必须实际生产adapter行为RED→GREEN：uni pending空catalog初始化→有效菜单→空菜单/失效菜单连续执行，无手工清空/修正display绕过生产状态；保留原输入、选择、pending及请求次数断言。覆盖packages/mini-core/tests/cashier-drafts-mini.test.mjs和cashier-drafts-mini-render.test.mjs，最终商户H5/mp-weixin双构建。没有新风险不要重跑Web/顾客或无关suite。

只改cashier.js及对应mini测试，报告追加docs/tasks/cashier-drafts-mini-report.md，列有效RED失败/GREEN输出/命令/退出码、自查、限制及提交。不能访问源API/DB/root浏览器，不能generate/迁移/seed/服务启停。显式暂存本人内容，不碰两份旧catalog-api untracked diff；标准git身份Codex/codex@local.invalid。返回状态/SHA/一行验证/报告路径；根代理会独立复审后源页面复验。
