# 备份恢复CHECK约束语法规范化修复

Root为补充009前备份时间原字段证据，真实执行pnpm db:restore -- D:/Codes/013MiniProgram/data/backups/backup_4f30126725837641927885debc7ec5be/database.dump，失败Restore summary comparison failed。原备份未修改，源库未写；恢复脚本仅清理本轮CREATE成功且OID/owner/marker一致的失败新库。旧恢复库保留。

第二次root以output/playwright/backup-diagnostic.mjs（脚本诊断副本，不改产品代码）捕获expected/actual summary，output/playwright/restore-summary-diagnostic.json差异仅constraints[59]，两边336条，其他summary完全一致：

expected development.ProductAttributeGroup.ProductAttributeGroup_bounds_valid CHECK ((((sort >= 0) AND (sort <= 100000)) AND ("minSelections" >= 0) AND ("maxSelections" >= "minSelections") AND ("maxSelections" <= 10)))

actual同项 CHECK (((sort >= 0) AND (sort <= 100000) AND ("minSelections" >= 0) AND ("maxSelections" >= "minSelections") AND ("maxSelections" <= 10)))

pg_dump/restore重解析把结合AND展平，pg_get_constraintdef文本非稳定语义身份。不能简单去掉所有括号，不能忽略所有CHECK/全部constraint，也不能跳过摘要差异或回写manifest造成假相等。

## 任务及边界

遵循test-driven-development+systematic-debugging。一人实现，不再派agent。只改scripts/backup.mjs、必要独立辅助模块及tests/runtime/*备份专项、报告docs/tasks/backup-constraint-restore-fix-report.md。root文档和现金退款API不改。原BASE在派发时给出。

必须保持现有manifest可恢复（不要仅改变新备份summary格式、使旧备份永久失败）。比较仍严格确认全部schemas/计数/金额/库存/fingerprints、约束数量/门店schema/表/名称/类型/validated及非CHECK定义。CHECK允许此种语法重解析差异但必须拒绝实际逻辑变化（AND/OR、比较值、列名、NOT与括号改变优先级等），不要用危险的全局正则删括号。

可以基于PostgreSQL安全解析后规范比较CHECK表达式，例如只在全新已验证恢复/隔离库中用同表结构的临时对象重新解析两边CHECK再读规范表达式；最终策略需在报告说明为何不会忽略逻辑差异。若可用简单更稳方案采用之，避免引新依赖或执行备份内任意SQL。manifest文本是不可信数据，严格限定处理来自本次实际对应CHECK、约束元数据匹配，防止把definition拼接成任意DDL；如果不能安全解析则拒绝。不能在source创建临时对象或DDL。

所有测试写入只在现有受保护test_backup_*随机独立数据库或明确本轮新建且受OID/owner/marker校验的恢复目标，CREATE碰撞不清理旧对象。source restaurant_dev只能已有只读查询/备份，无业务写/迁移/重置。旧备份/manifest/恢复库全部保留，原脚本对本轮失败新目标的既有安全清理保持。API源3000目前已停，不得自行重启或generate。

TDD：先用真实PG16含该嵌套AND CHECK的原表→真实dump→restore观察失败RED。修复后同份备份恢复成功/summary证据；实际逻辑变化仍失败；已有manifest兼容；危险definition不能执行额外SQL；创建碰撞身份守卫不退化。覆盖备份专项、必要runtime，报告命令/原输出/新证据，避免反复整套测试。不得篡改原dump/manifest来促成成功。

只显式暂存自己文件，旧catalog reviewdiff不碰。报告完整RED/GREEN、设计、自查、限制与提交，返回DONE+commits+一行测试。Root独立审查后再运行真实009前备份恢复/时间字段对照；本任务不声称整项目完成。
