# Task 2 — 本地 PostgreSQL 备份与隔离恢复

日期：2026-10-20。实现文件：`scripts/backup.mjs`、`tests/runtime/backup.test.mjs`，入口注册于根`package.json`；操作说明同步`config/README.md`和根README。

## 状态与范围

已编写、已在Windows真实owned PostgreSQL16.14上运行、隔离备份恢复测试通过；尚未生产部署。此报告的实现者测试源为随机独立`test_backup_<32hex>`数据库，其中public和development各自执行现有全部迁移并准备可辨识品牌/商品/现金订单/CMS/会话。没有对实际restaurant_dev的public/development插入、更新或删除；运行中的API/Web/H5未停止，未执行Prisma generate。实际restaurant_dev整库CLI演练由协调器在独立审查后执行并补充验收记录，本报告不冒充已执行该步骤。

## 工具来源与连接

使用已取得的官方EDB16.15 pg_dump/pg_restore及相邻DLL，路径`data/runtime/tools/postgresql-16.15/pgsql/bin`。未引入新依赖、下载其他二进制或修改PATH。来源URL、压缩包SHA256、官方文档和许可见`docs/research/2026-10-20-operations-research.md`、`data/research/operations-sources.json`、`THIRD_PARTY_NOTICES`及`docs/research/licenses/`。源服务仍16.14；客户端16.15同主版本16。

只接受固定127.0.0.1:55432/restaurant_dev用户/restaurant_dev数据库。配置读取`.env.local`，不存在时读取development.env.example，进程变量优先；schema查询参数不限制整库备份。拒绝production和其他连接，逐次调用现有assertProjectDatabase核对工作区marker、真实data_directory及服务major，再核对数据库归属当前数据库用户。程序化测试源必须为完整随机test_backup_<32hex>且数据库comment精确匹配当前root和该库；CLI没有源库覆盖参数。

## 实现行为

- 备份开启repeatable-read/read-only事务，pg_export_snapshot导出标识；pg_dump custom archive使用该snapshot，清单的所有查询在原事务中执行。API并发变更不会混入不同时间的计数。整个数据库所有用户schema均归档。
- data/backups及随机子目录设置并核对真实Windows私有DACL，删除继承和其他主体授权，仅给当前账户FullControl；文件继承受保护父目录的私人权限。检查真实路径和链接。POSIX用0700/0600但本机未实际验证POSIX。密码不进入argv/stdout，libpq使用临时PGPASSFILE，清除继承的PG*连接配置。passfile创建后检查失败也清理；执行结束清理。新子目录由非recursive mkdir独占创建，不接管碰撞目录；文件使用wx。
- 归档先写partial，清单与SHA256先写partial；逐个原子rename，manifest.json最后作为发布完成标记。失败删除本次独占创建的目录。清单不包含用户资料、凭据字段、会话令牌或订单地址：包括源/工具版本、快照、逐表行数、现金三项金额合计、SKU/Modifier库存/预留、Page/Quote/Order/OrderEvent非凭据字段指纹、约束及验证状态。动态schema/table名称安全引用，schema/count容器无原型。
- 恢复在创建数据库前检查私人文件权限、清单结构/主版本、归档SHA256以及pg_restore --list。目标名仅自动随机restore_<32hex>，碰撞直接拒绝，无覆盖参数。CREATE DATABASE TEMPLATE template0后记录OID、当前所有者和本次随机comment；执行pg_restore --exit-on-error --no-owner --no-acl --single-transaction。
- 恢复后repeatable-read事务内比较整份清单；通过后才删除新库所有schema的Session并提交，源会话不动。成功结果写到同备份目录restore-<database>.json；不切换DATABASE_URL、不启动API。归档对象所有权归当前用户，不恢复原ACL。
- 恢复失败仅在OID/当前owner/comment三项都匹配时删除本次目标；无法确认则保留并提示人工检查。在私人备份目录写restore-<database>.failed.json，只有目标名、时间、保留状态和固定reason，不包含SQL或原始数据库异常。CLI不输出原始子进程stderr/数据库异常，避免业务或凭据泄漏。

## TDD 与实际验证

执行命令均从`D:/Codes/013MiniProgram`运行：

```powershell
node --test tests/runtime/backup.test.mjs
pnpm test:runtime
```

RED：先写测试和未实现入口stub，第一条命令4/4失败，分别为生产backup/restore尚未拒绝、PG16工具检查未实现、本地备份连接未实现。接入真实数据库后，隔离库所有迁移/业务准备实际成功；首次备份在Windows权限调用失败（4通过/6失败），未生成可接受归档。定位为Windows PowerShell模块无法自动加载，改为显式导入。下一轮真实dump/restore已成功，但snapshot测试把PostgreSQL十六进制snapshot标识误写为纯十进制，8通过/2失败（含父测试）；修正测试的实际格式。重复运行又发现已保护DACL上的Set-Acl要求SeSecurityPrivilege；用独立无秘密ACL诊断复现，改为DirectoryInfo.SetAccessControl，仅持久化已修改DACL，无需提升权限。该修复由随后的完整真实测试覆盖。

GREEN：最终独立`node --test tests/runtime/backup.test.mjs`结果11/11通过，耗时24.9秒。最终`pnpm test:runtime`结果22/22通过、0失败、0跳过，耗时28.1秒（备份父测试27.8秒）。没有运行会触发Prisma generate的build。

实际覆盖：

1. backup/restore的production误用均退出1且stdout为空。
2. 工具版本解析接受实际16.15，拒绝17.1和伪造版本行；现有runtime测试另验证非16服务及marker/data_directory不符拒绝。
3. 实际隔离源库comment改为foreign，备份在写文件前拒绝；恢复后精确复原测试marker。
4. 同一快照下，源SKU在导出snapshot之后由另一个连接从17更新为18；manifest与恢复库均保持17，源库保留18。归档SHA256与实际文件匹配，无残留passfile/partial，真实Windows ACL检查通过。
5. public和development各1笔现金订单，金额1234、实收2000、找零766；归档/恢复逐schema现金合计一致。CMS发布内容、订单行/报价/事件指纹、库存/预留及约束与清单一致，恢复库真实负库存写入被约束拒绝。
6. 新库2条恢复会话全部撤销，源库会话仍各1条；源订单计数无变化。实际restaurant_dev的public/development订单计数演练前后相同。
7. 归档追加tampered后SHA256检查拒绝，创建前后restore_*库清单相同；恢复原文件后继续。
8. 模拟随机名字碰撞，已有恢复库保留，没有覆盖/删除。
9. 在本次全新目标人为制造Brand表冲突，pg_restore真实失败；只删除已确认归本次运行的目标，隔离源仍可查询且stock=18。
10. 人为改变本次目标ownership comment并制造冲突，失败后保留目标，生成retained=true、ownership_not_confirmed错误记录；测试夹具随后仅清理自身明确记录的随机目标。
11. 完整runtime同时回归真实数据库事务、所有权路径/marker/version保护与验收子进程取消/清理。

测试自行清理独立源库、成功恢复库、失败保留库及本次备份目录；不保留含测试会话/业务的临时归档进Git。初始RED、真实环境中间失败和最终GREEN均真实运行，未用mock替代备份/恢复成功路径。

## CLI、导出接口和产物形状

```powershell
pnpm db:backup
# Backup: D:\Codes\013MiniProgram\data\backups\backup_<32hex>\database.dump
# SHA256: <64hex>
# Manifest: D:\Codes\013MiniProgram\data\backups\backup_<32hex>\manifest.json
pnpm db:restore -- <database.dump绝对路径>
# Validated restore: restore_<32hex>
# Restored sessions revoked: <integer>
```

脚本支持pnpm传递的可选首个`--`分隔符；拒绝额外参数。终端行前缀固定，pnpm自身可能先打印命令头。实现导出：`localConnection()`返回固定连接（含内存凭据，禁止打印），`assertToolVersion(output)`、`assertPrivatePath(path)`、`backupDatabase({sourceDatabase?, afterSnapshot?})`、`restoreBackup(file,{nameGenerator?,beforeRestore?})`。测试钩子仅在程序化测试中使用，CLI不暴露。backup返回`{archive,manifest,sha256}`；restore返回`{database,revokedSessions}`。

manifest顶层`format=1,archive,createdAt,source:{database,serverVersion},tools:{dump,restore},snapshot,summary:{schemas,constraints},sha256`。schemas按schema分组：`counts`为各表字符串行数，`cash`为三项金额字符串合计，`inventory.sku/modifier`为id/stock/reserved数组，`fingerprints`为非凭据业务快照MD5；constraints为schema/table/name/type/validated/definition。restore成功JSON含database/restoredAt/validated/revokedSessions。

## 限制与待验收

这是可信本机PG16小库的逻辑备份。SHA256用于损坏检测，清单MD5用于等价比较，均非签名或来源认证；只能恢复自己生成且可信保管的归档，未知归档SQL可能恶意。归档未加密，内含凭据及业务，只存Git忽略且受限的data/backups；删除passfile不等于磁盘安全擦除，设备加密和长期保管策略另行配置。

尚未执行生产灾备、大库性能/RPO/RTO、异地加密、对象存储、调度告警或POSIX部署验证。每条工具执行有120秒超时，manifest限制32MiB，全表计数/快照长事务可能影响大库vacuum，不把本地演练当作生产SLA。脚本正常失败清理；进程被强制结束/机器断电可能留下partial或临时passfile，仍在私人目录且不会作为完成备份接受，需受控人工检查。文件发布使用原子rename而非断电级fsync保证。

实际restaurant_dev整库CLI演练及协调器独立SQL核验、独立代码审查和最终集成提交由协调器接续。本任务实现者未提交Git。

## 协调器接续结果

backup_review独立审查规范及代码质量通过。协调器实际执行整库db:backup/db:restore，恢复到restore_f51729f327fe53751420304915dec2ea；development现金3笔8380分、订单5笔、库存14/reserved0、已发布CMS及public订单4笔均SQL对比一致。源27会话保持，恢复库会话0，API仍连接原库并健康。备份SHA256/文件路径/约束清单及完整操作记录见docs/acceptance/2026-10-20-local-r1.md。实现已在b784a2e提交；未部署生产。
