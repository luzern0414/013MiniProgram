# 本地账号初始化与备份恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task.

**Goal:** 补齐可审计的首位管理员初始化及能够真实恢复的本地备份，不以文档中的空命令代替运维能力。

**Architecture:** 身份凭据复用已审查的scrypt模块，初始化只提供离线命令。备份采用PostgreSQL官方pg_dump/pg_restore，恢复只写入全新的独立数据库；先验证再人工切换配置，自动化不覆盖交互开发库。

**Tech Stack:** NestJS/Prisma6.19、PostgreSQL16官方客户端、Node24、PowerShell。

## Global Constraints

- 现有development与public业务数据必须保留，不通过删库重置解决问题。
- 初始化/备份包含敏感凭据时放config/secrets或data/backups并限制文件访问，不入Git、不回显密码、token或hash。
- 不启用公开OWNER注册接口、固定初始密码或万能开发身份。
- 首次管理员只能管理显式提供的同品牌门店；管理员账号仍受enabled/session约束。
- 恢复前校验官方工具版本与本项目数据库所有权；恢复目标名称随机且不存在，拒绝用户传入development/public等覆盖目标。
- 无AppID/商户号不影响本地功能，不声称微信或生产验收通过。

### Task 1: 首位管理员受控初始化

**Files:** apps/api/src/commands/bootstrap-owner.ts；tests/bootstrap-owner.test.ts；auth.service.ts员工凭据登录角色白名单；apps/api/package.json；docs/tasks/bootstrap-report.md；config/README.md。

**Interfaces:**

```text
pnpm --filter @restaurant/api owner:bootstrap --brand-id <existing-id> --name <name> --account <account> --store-ids <comma-separated-ids> --password-file <restricted-local-file>
```

- [x] 新增隔离test_bootstrap_owner数据库测试：无OWNER品牌初始化后员工登录成功、授权仅所选门店；第二次拒绝；并发最多一个成功；跨品牌/不存在门店失败且无残留；password/hash不出现在stdout与审计；生产DEV_AUTH关闭仍可用真实管理员凭据；停用后不能登录。实际运行观察RED。
- [x] CLI严格解析白名单参数，拒绝重复/缺失/空门店；复用账号/密码函数。密码从本地文件读取，禁止命令行直接传密码；限制128字符和单个尾换行约定，不trim实际密码。拒绝符号链接/非普通文件，文件大小最多1KiB，文件不保存在临时公用目录。
- [x] 事务内锁定品牌行后检查品牌不存在任何OWNER，逐一验证门店；创建OWNER、授权、无凭据审计同事务；并发通过品牌行锁与已有检查保证仅一次。已有OWNER时不给“强制”覆盖开关；后续密码恢复应单独设计受控流程。
- [x] staff-login接受CLERK或OWNER，均用同样真实凭据与会话规则；开发身份不因此可用于生产。无凭据的旧OWNER无法从该入口登录，不能悄悄赋予默认密码。
- [x] 运行新增真实DB、现有staff/domain/HTTP回归，记录GREEN；独立review后更新文档真实命令。只在隔离测试品牌执行初始化验收，不修改体验店主身份。

### Task 2: 官方备份工具及本地恢复

**Files:** scripts/backup.mjs、tests/runtime/backup.test.mjs、config/README.md、docs/tasks/backup-report.md、package.json；若需下载仅放被忽略的data/runtime/tools。

**Interfaces:** `pnpm db:backup` 导出实际本地DB，输出备份文件及sha256和不含敏感字段的清单；`pnpm db:restore -- <file>` 自动生成restore_<random>新数据库，验证成功后输出目标名，不自动替换DATABASE_URL。

- [x] 先检查本机是否已有PG16 pg_dump/pg_restore。当前embedded-postgres包仅有initdb/pg_ctl/postgres，不能假装附带备份工具；从官方PostgreSQL/EDB获取工具时记录URL、版本、内容校验与许可证，不引入来源不明二进制。
- [x] 失败测试覆盖生产误用本地命令、所有权不符、非16工具、校验和错误、目标已存在、恢复失败不影响development/public。成功测试准备隔离品牌/商品/现金订单，导出恢复后对比快照/流水/库存/CMS。
- [x] pg_dump custom格式、repeatable consistent snapshot、固定数据库连接且凭据通过受限passfile传递；如源库仍在运行，导出快照供pg_dump --snapshot与清单查询共用，避免把不同时间的计数当成恢复差异。子进程不使用shell拼接，不在stdout/args里暴露密码。生成不可覆盖的新文件，完成后原子发布清单及hash，失败移除本次不完整产物。
- [x] 恢复只创建自己随机新库，先验证sha256与工具major16，pg_restore --exit-on-error --no-owner --no-acl；记录恢复行数/现金合计/约束/关键快照。失败清理只限已创建且确认归本次运行所有的目标；如果不能确认则保留错误记录，不扩大删除范围。
- [x] 备份恢复数据中的会话在新库验证后全部撤销，防止旧token继续使用；不修改源数据库会话。恢复不启动公开API、不自动切换配置。
- [x] 执行真实备份/恢复演练，独立审查和文档交付；大库、生产灾备、异地加密/对象存储及告警另设上线验收，不能用本地演练代替。

任务1与任务2均来自已批准设计及开发规范的管理员初始化/备份恢复要求；Task2工具获取若失败，保留问题继续其他本地业务模块，不能凭空记录备份成功。
