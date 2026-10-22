### Task 2: 官方备份工具及本地恢复

**Files:** scripts/backup.mjs、tests/runtime/backup.test.mjs、config/README.md、docs/tasks/backup-report.md、package.json；若需下载仅放被忽略的data/runtime/tools。

**Interfaces:** `pnpm db:backup` 导出实际本地DB，输出备份文件及sha256和不含敏感字段的清单；`pnpm db:restore -- <file>` 自动生成restore_<random>新数据库，验证成功后输出目标名，不自动替换DATABASE_URL。

- [ ] 先检查本机是否已有PG16 pg_dump/pg_restore。当前embedded-postgres包仅有initdb/pg_ctl/postgres，不能假装附带备份工具；从官方PostgreSQL/EDB获取工具时记录URL、版本、内容校验与许可证，不引入来源不明二进制。
- [ ] 失败测试覆盖生产误用本地命令、所有权不符、非16工具、校验和错误、目标已存在、恢复失败不影响development/public。成功测试准备隔离品牌/商品/现金订单，导出恢复后对比快照/流水/库存/CMS。
- [ ] pg_dump custom格式、repeatable consistent snapshot、固定数据库连接且凭据通过受限passfile传递；如源库仍在运行，导出快照供pg_dump --snapshot与清单查询共用，避免把不同时间的计数当成恢复差异。子进程不使用shell拼接，不在stdout/args里暴露密码。生成不可覆盖的新文件，完成后原子发布清单及hash，失败移除本次不完整产物。
- [ ] 恢复只创建自己随机新库，先验证sha256与工具major16，pg_restore --exit-on-error --no-owner --no-acl；记录恢复行数/现金合计/约束/关键快照。失败清理只限已创建且确认归本次运行所有的目标；如果不能确认则保留错误记录，不扩大删除范围。
- [ ] 备份恢复数据中的会话在新库验证后全部撤销，防止旧token继续使用；不修改源数据库会话。恢复不启动公开API、不自动切换配置。
- [ ] 执行真实备份/恢复演练，独立审查和文档交付；大库、生产灾备、异地加密/对象存储及告警另设上线验收，不能用本地演练代替。


