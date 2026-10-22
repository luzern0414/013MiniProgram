# Task1：首位OWNER受控初始化实现报告

日期：2026-10-20。实现基线为`2030e2d`（已有员工凭据与UI）；在`codex/restaurant`共享工作区完成，期间控制者提交的调研文件未修改。未创建提交，由控制者独立审查后统一提交。

## 实现

- 新增离线`pnpm --filter @restaurant/api owner:bootstrap --brand-id <existing-id> --name <name> --account <account> --store-ids <comma-separated-ids> --password-file <restricted-local-file>`，仅支持五个必填参数；拒绝未知、重复、缺失参数以及空、重复或超过100个门店。复用既有账号规范、密码长度校验及带随机盐的scrypt实现。
- 密码不接受命令行参数、环境变量或默认值；从1KiB以内的独立普通文件读取。绝对本地路径，拒绝共享/设备路径、NTFS备用流、临时公用目录、符号链接、目录联接、硬链接。检查每个路径组件，打开文件描述符（POSIX使用O_NOFOLLOW），fstat与路径identity/size/mtime/ctime对比，读取固定1025字节上限并再次检查路径和描述符一致性。
- Windows不依赖0600：使用系统PowerShell读取真实DACL，文件及父目录须关闭继承且归当前用户/SYSTEM/Administrators所有；文件仅这些主体可访问，其他主体不可写父目录/删除/改ACL。失败封闭，OS错误不输出。POSIX要求当前UID所有、文件无组/其他权限且父目录不可被组/其他写入。导出窄接口`readRestrictedPasswordFile(path: string): Promise<string>`供后续任务复用。
- UTF-8严格解码，拒绝BOM/NUL/内部换行，最多删除一个LF或CRLF尾换行，保留所有实际密码空格，复用12至128字符限制。读取缓冲区用后清零；JS字符串无法可靠原地清零，命令为短生命周期进程。
- 事务使用PostgreSQL ReadCommitted，首先`SELECT ... FROM "Brand" ... FOR UPDATE`锁定品牌，再检查不存在任何OWNER（包括停用、无凭据旧OWNER）、全部门店存在且属于品牌、账号未占用，最后创建OWNER、显式门店授权和`OWNER_BOOTSTRAP`审计。同品牌并发初始化经品牌行锁串行化，后者看到已有OWNER而失败。无需schema变更或Prisma生成。
- 审计只含公开身份及门店授权信息。CLI仅打印统一成功或失败信息，不输出密码、摘要、token、原始参数、数据库/OS异常；动态加载Prisma前删除DEBUG，测试以`DEBUG=prisma:*`验证无诊断泄漏。
- 员工凭据入口同时允许OWNER和CLERK，入口及会话创建前均重检角色、启用状态、摘要一致。复用既有限流、会话及逐门店授权；没有更改开发身份限制。没有密码的旧OWNER无法凭默认密码登录。
- 配置文档给出Windows私人ACL设置、POSIX要求、真实命令、既有品牌/门店前置条件及OWNER恢复尚未实现的边界；修正生产环境模板的身份说明。

## TDD证据

测试先于实现写入`apps/api/tests/bootstrap-owner.test.ts`。先仅对`test_bootstrap_owner`执行现有五项迁移，无生产/开发schema改动。

RED命令（工作目录`apps/api`，DATABASE_URL指向本机专用PG16的`test_bootstrap_owner`）：

```text
node --import tsx --test tests/bootstrap-owner.test.ts
✖ OWNER credentials work with production development authentication disabled
  Real OWNER credentials must use the staff session flow: 401 !== 201
✖ strict CLI arguments and restricted password files reject unsafe input
  The controlled OWNER bootstrap command must exist
✖ offline CLI creates one OWNER atomically with explicit same-brand grants and secret-free output
  The controlled OWNER bootstrap command must exist
tests3 / pass0 / fail3
```

这是预期功能缺失：已有入口只接受CLERK，初始化模块不存在。最初从仓库根运行tsx因未采用API tsconfig导致装饰器转换错误，调整工作目录后才得到上述有效RED；转换错误不作为TDD证据。

实现后首次文件测试发现两项本机工具差异：从PowerShell7父进程继承的模块目录使Windows PowerShell5自动加载错误模块；显式从其`$PSHOME`导入系统模块。测试ACL重置读取了不必要的SACL状态引发SeSecurityPrivilege错误，夹具改用.NET只读取/写入DACL Access段。业务文件读取始终失败封闭，没有降低实际ACL要求。

GREEN命令同上，最后一次：`tests3 / pass3 / fail0 / skipped0`，约7.2秒。覆盖真实生产模式HTTP登录、实际CLI子进程、仅选门店授权、二次拒绝、并发仅一次、跨品牌/缺失门店无残留、旧停用OWNER禁止初始化、审计及stdout/stderr无凭据、密码空格保留、停用后登录/原会话拒绝、无凭据旧OWNER不能登录、严格参数与文件类型/大小/内容/ACL/目录联接检查。

## 回归与验证

所有以下命令实际运行，退出码0；没有跳过测试：

| 命令 | 结果 | 范围 |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit` | 通过 | 源码类型检查，无生成/覆写运行中构建 |
| `pnpm test` | 44/44 | API domain9、Web17、mini-core18 |
| `pnpm test:runtime` | 11/11 | PG实例所有权/回滚/生产拒绝/独立验收取消清理 |
| `pnpm --filter @restaurant/api test:staff` | 3/3 | `test_staff_access`，真实源码HTTP与PG员工凭据/权限 |
| `pnpm --filter @restaurant/api test:integration` | 1/1 | 新建`test_bootstrap_regression`，真实源码HTTP与PG业务回归 |
| `pnpm test:integration` | 11/11 | 随机`test_acceptance_80f0062151c6`，已有构建独立API验收，schema已自动删除 |
| `node --import tsx --test tests/bootstrap-owner.test.ts`（API目录） | 3/3 | `test_bootstrap_owner`，新源码真实CLI/HTTP/PG |

合计73个通过（含node:test父suite计数的现有HTTP验收11），失败0。完整回归仅一次；迭代期间仅运行聚焦新增测试及类型检查。用于测试的固定隔离schema没有指向development或public。现有3000端口API持续运行，未停止、重启或触发Prisma generate；已有构建HTTP回归验证兼容性，新OWNER行为由源码HTTP与CLI验证。控制者后续负责独立CLI及浏览器验收。

## 文件

- `apps/api/src/commands/bootstrap-owner.ts`（新增）
- `apps/api/tests/bootstrap-owner.test.ts`（新增）
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/package.json`
- `config/README.md`
- `config/environments/production.env.example`
- `docs/tasks/bootstrap-report.md`（本报告）

## 自审与边界

自审对照任务清单：受限离线入口、角色白名单、品牌锁、门店全量校验、同事务授权/审计、现有OWNER拒绝、生产关闭开发身份后的真实登录均已实现。没有引入公开注册、默认密码、覆盖/恢复、品牌/门店创建、备份或新数据库结构。实现文件约170行，职责保持CLI初始化；没有跨模块安全重构。代码注释说明选择真实ACL以及抑制原始异常的原因。

Windows真实ACL/目录联接已在当前主机运行。POSIX分支已编写测试，但当前Windows运行未覆盖POSIX系统行为。权限策略信任当前OS账户、本机管理员及SYSTEM；无法防止这些受信任主体主动读取/替换文件。操作主机、PowerShell和数据库连接配置必须可信，文档要求受管设备与私人目录。JS密码字符串与系统编辑器缓存不能通过本命令保证安全擦除。

OWNER密码恢复、自助改密及外部身份接入不属于Task1且尚未实现，文档明确记录；旧OWNER也不会被此命令覆盖。现有API进程仍为旧构建，控制者应在后续明确维护安排中采用新源码。测试隔离schema保留了可复测测试数据；development/public及体验店主未改动。没有已知阻塞问题，待独立审查及控制者实际CLI/浏览器验收。

## 独立审查修订

独立审查通过代码质量，提出一项P2文档规范问题：密码文件示例使用Git目录外的HOME私人目录，而任务全局约束要求凭据放在`config/secrets`或`data/backups`。已将配置文档的说明、PowerShell示例及POSIX说明统一为工作区内`config/secrets/.owner-private`。示例明确从工作区根运行，`Join-Path (Get-Location).Path`构造本地绝对路径；文件及父目录的受保护ACL要求、仅可信编辑器输入密码、初始化后删除文件均保留。

这是纯文档修订，未修改运行代码或测试，未重复完整测试。实际执行`git check-ignore -v config/secrets/.owner-private/owner.pass`确认命中既有`config/secrets/`忽略规则；`git diff --check`通过。

### 测试入口数据库保护提升

控制者要求将数据库限制提升到测试模块加载阶段，确保任何测试筛选都不能绕过整个套件的schema检查。原先两个数据库测试各自已检查`test_bootstrap_owner`；现改为模块顶层统一校验，缺失/非法DATABASE_URL或其他schema在注册任何测试前直接退出，移除两个局部重复检查。

先新增隔离子进程回归：使用不存在的本地端口1和非业务数据库名，分别选择development、public或缺失DATABASE_URL；仅筛选文件校验测试，避免对业务数据库进行破坏性验证。必须退出1、输出专属schema保护错误且没有连接失败/Prisma初始化异常。RED：`node --import tsx --test --test-name-pattern 'entire bootstrap suite' tests/bootstrap-owner.test.ts`退出1，新增断言观察到子进程退出0而预期1，证明旧模块未在入口统一拒绝配置；没有数据库连接操作。

添加顶层保护后GREEN：相同隔离`test_bootstrap_owner`环境下运行`node --import tsx --test tests/bootstrap-owner.test.ts`，新增保护用例及原三个用例全部通过，`tests4 / pass4 / fail0 / skipped0`，约8.6秒。`git diff --check`通过。本次仅修改测试及本报告，不涉及运行代码，因此按控制者要求未重复完整回归；此前73个通过仍是当时的完整回归证据，本次新增1个保护用例。
