# 备份恢复 CHECK 语法规范化修复

日期：2026-10-20。任务基线：`6dcba7c981e9dc52a2b4dcc7ff38c86652c9f2e7`。实现提交：`fe7b31e`（Codex / codex@local.invalid）。本报告为其后的独立文档提交。

## 结果与范围

旧 `format: 1` manifest 不改写也能恢复本例嵌套 AND CHECK。实现只改 `scripts/backup.mjs`，增加纯数据辅助模块 `scripts/backup-summary.mjs`；新增两份备份专项测试。没有新依赖，没有改现金退款 API、root 文档、历史 review diff 或其他任务代码。

遵循 systematic-debugging、test-driven-development、verification-before-completion。一人实现，没有再派 agent。没有对 `restaurant_dev` 执行业务写入、迁移、重置、临时对象或 DDL；没有执行 generate、启动 API 或切换数据库。现有备份测试仅对源库已有 public/development Order 做只读计数对照。其他数据库写入均在受保护随机 `test_backup_<32hex>` 或本轮新建恢复目标。原业务备份、manifest 和旧恢复库没有修改或删除。

## 根因与 RED

Root 的实际备份诊断 `output/playwright/restore-summary-diagnostic.json` 显示两边 336 条约束，仅 `development.ProductAttributeGroup.ProductAttributeGroup_bounds_valid` 的定义文本不同，其余摘要相同。

在真实 PostgreSQL 16.14 随机独立测试库创建该表，用原迁移同样的 `sort BETWEEN 0 AND 100000 AND ...` CHECK。`BETWEEN` 变换初次生成嵌套 AND，pg_dump/pg_restore 重新解析约束后 AND 被展平。显式写普通 AND 括号会在创建时直接展平，第一版夹具因此在定义形状断言处失败；将夹具改为原始 BETWEEN 形式后，才取得下述有效 RED，修复代码是在有效 RED 后添加的。

```powershell
node --test tests/runtime/backup-check-constraints.test.mjs
```

原始输出摘录：

```text
Legacy CHECK archive: D:\Codes\013MiniProgram\data\backups\backup_52e67596cfdae1ff36d9dfba070093a3\database.dump
Error: Restore summary comparison failed.
tests 1 / pass 0 / fail 1 / duration_ms 7499.018
```

manifest 中原定义与恢复后定义分别为：

```sql
CHECK ((((sort >= 0) AND (sort <= 100000)) AND ("minSelections" >= 0) AND ("maxSelections" >= "minSelections") AND ("maxSelections" <= 10)))
CHECK (((sort >= 0) AND (sort <= 100000) AND ("minSelections" >= 0) AND ("maxSelections" >= "minSelections") AND ("maxSelections" <= 10)))
```

## 设计与安全边界

先保留原整份 JSON 精确相等路径。只在有差异时，对同数组位置、同 schema/table/name/type/validated 及其他所有元数据完全一致的 CHECK 尝试降级比较。约束数量、顺序、非 CHECK 定义和所有其他摘要字段最终仍做原样整份比较。

降级比较用锚定词法扫描和递归语法解析，限定为 `CHECK (conjunction)`：conjunction 是比较项或其括号分组，以 AND 连接；比较的两边仅允许原样保留的列标识符或带可选正负号的整数，操作符仅 `= <> != < > <= >=`。标识符含双引号转义时保持原词元，列、操作符、数值、顺序和重复项均不改写。唯一规范化是展平 AND 的括号分组，符合 SQL 三值逻辑中的 AND 结合律；不排序、不省略项，不删除比较操作数中的任意括号。

OR、NOT、算术、函数、类型转换、字符串、子查询、注释、分号和额外后缀等不支持的差异一律拒绝。复杂 CHECK 若文本完全一致，仍走旧精确路径。词法或语法不完整、定义超过 65536 字符、超过 4096 个词元或递归深度超过 64 均拒绝降级比较。没有任意全局删括号，也没有忽略 CHECK 或摘要。

manifest.definition 从始至终只是数据：不插入 SQL，不在 source 或恢复目标创建规范化临时对象，不求值函数，也不执行 DDL。恶意文本无法通过该比较器执行附加 SQL。修改仅替换恢复后比较函数，创建碰撞检查及恢复目标 OID/owner/marker 三重清理守卫没有改动。

## GREEN 与证据

修复后用同一份 RED archive 直接调用 `restoreBackup` 成功，保留目标供独立审查：

```text
{"database":"restore_40d94f1ee47c98bcafe5280cdba8266b","revokedSessions":0}
```

该份原 dump 和 manifest 未经负例篡改，保留在上面的 `backup_52e...` 目录。只读复核信息：manifest.format=1，sourceServer=16.14，dump/restore 工具均为 16.15；manifest.sha256 和实际 dump SHA256 均为 `cbf8cfab951ded03d96706ecdaa5e6f3dbc92f249a71f5294737d841018df821`。恢复库 `pg_get_constraintdef` 为上述展平后表达式，manifest 仍为嵌套表达式。可用以下命令再次复核恢复（会再新建随机恢复目标）：

```powershell
pnpm db:restore -- D:/Codes/013MiniProgram/data/backups/backup_52e67596cfdae1ff36d9dfba070093a3/database.dump
```

第一轮组合检查：

```powershell
node --test tests/runtime/backup-check-constraints.test.mjs tests/runtime/backup-summary.test.mjs tests/runtime/backup.test.mjs
```

真实结果：`tests 33 / pass 33 / fail 0 / skipped 0 / duration_ms 67781.7303`。包括现有实际 snapshot 并发备份、现金/库存/CMS/快照/会话、checksum、名字碰撞、失败新库清理、marker 改变后保留目标等回归，现有 backup.test 本身 11 项全部通过。

随后只补强了新测试：增加非 CHECK 约束的实际差异负例，以及带随机 `pg_notify` 通道的 DDL/函数注入文本；admin 连接 LISTEN，在测试完成后确认通知数组为空，证明注入文本没有被执行。对变化后的相关测试重新执行，并加入无数据库写入的所有权 runtime：

```powershell
node --test tests/runtime/backup-check-constraints.test.mjs tests/runtime/backup-summary.test.mjs tests/runtime/ownership.test.mjs
```

最终结果：`tests 29 / pass 29 / fail 0 / skipped 0 / duration_ms 40126.4324`。

新集成测试真实执行旧 manifest 恢复成功及 19 类拒绝：OR、NOT、比较符、值、列、布尔分组、DDL 注入、函数注入、约束 schema/table/name/type/validated、缺失约束、非 CHECK 定义、行数、cash/inventory/fingerprints 摘要。每个拒绝验证本轮随机目标已清理；负例只临时修改其本轮专用测试 manifest，并在 finally 恢复原字节，绝不靠修改 manifest 促成成功。最终成功恢复前后都确认 manifest 字节一致。纯数据单测另检查双向旧/新定义兼容、复杂完全相同 CHECK、额外摘要字段、未知约束字段、解析深度上限和不支持语法拒绝。

新集成夹具仅在 CREATE 成功后登记目标，清理再次核对 OID、owner 和完整 marker。测试库和集成成功恢复库已按此身份核对清理。测试备份为复现证据保留在忽略的 data/backups；最终一轮是 `backup_b11ee17dcd3993b55e8d2b94353ce24e`，其成功恢复目标已清理。只有同份 RED/GREEN 演练的 `restore_40d94f1ee47c98bcafe5280cdba8266b` 特意保留。旧恢复库保留。

`git diff --check` 及脚本/新集成测试 `node --check` 均退出 0。没有反复运行全套项目测试，没有运行会对源库做临时写入的 database/acceptance runner，也没有运行触发 generate 的 build。

## 自查与限制

实现保留全部旧 manifest 格式及原精确比较行为；非完全一致的复杂 SQL 语法会安全失败。这是有意的保守边界，不是通用 PostgreSQL SQL 等价判定器，也不会接受 AND 项重排或整数写法等其他变化。未来如遇其他合法重解析差异，应先补真实 RED 再扩展语法。

现有 pg_restore 对归档 SQL 的信任边界不变，SHA256 不是来源签名；本修复只确保 manifest 定义不会引入额外 SQL 执行。没有为任意不可信 dump 提供沙箱。

本任务未恢复业务原始 `backup_4f30126725837641927885debc7ec5be`，也不声称 009 前后原列/时间字段对照或整项目完成。Root 应独立审查提交，再执行该业务备份恢复及只读对照。

## 独立复审补修：Unicode 空白与列名身份

独立 `backup_constraint_review` 在原提交中发现 Important：词法扫描和跳过空白都使用 JavaScript `\s`，会把 U+00A0 等 Unicode 字符当作空白；PostgreSQL 16 则可能把它们作为未加引号列名的一部分。因此原版可能把 `sort >= 0` 与 `sort\u00a0 >= 0` 误判相同，上文初版“列身份不改写”的结论在此缺陷修复前并不完全成立。

本次按 TDD 先增加回归，再修改代码，修复提交为 `e803338`。仍未恢复业务源备份、迁移源库、写入源业务、generate 或启动服务。

RED 命令与原输出：

```powershell
node --test tests/runtime/backup-summary.test.mjs
# non-PostgreSQL Unicode whitespace cannot disappear from an identifier
# AssertionError [ERR_ASSERTION]: U+a0
# true !== false
# tests 5 / pass 4 / fail 1 / duration_ms 75.239

node --test tests/runtime/backup-check-constraints.test.mjs
# rejects Unicode identifier U+a0 ... Missing expected rejection.
# rejects Unicode identifier U+2003 ... Missing expected rejection.
# rejects Unicode identifier U+feff ... Missing expected rejection.
# tests 23 / pass 19 / fail 4 / duration_ms 56330.886
```

集成 RED 之前，在本轮受保护随机测试库用只读 SELECT 验证 U+00A0、U+2003、U+FEFF：同一结果行中 `sort=1`，带对应 Unicode 后缀的另一列为 `-1`，原表达式 `>=0` 为 true，另一列的表达式为 false。这确认差异属于真实 PG16 标识符语义，而不只是字符串差异。

修复仅将扫描与跳过空白的两个字符类改成明确的 `[ \t\n\r\f\v]`，与 PostgreSQL 扫描器支持的 ASCII 空白一致。Unicode 不在该类中，遇到未加引号的非支持字符即拒绝降级比较；引号内内容仍完整保留为标识符词元，绝不作 Unicode 或空白归一化。其余语法、约束元数据和摘要严格比较不变。

新增纯数据测试覆盖 U+00A0、U+1680、U+2000、U+2003、U+2028、U+2029、U+202F、U+205F、U+3000、U+FEFF 十种负例，ASCII 空格/tab/LF/CR/form-feed/vertical-tab 六种兼容，以及双引号内 NBSP 相同身份可匹配、NBSP 与普通空格/普通列不同身份必须拒绝。真实 dump/restore 负例新增三种已验证 PG 列语义的字符。

GREEN 命令与原输出：

```powershell
node --test tests/runtime/backup-summary.test.mjs tests/runtime/backup-check-constraints.test.mjs
# rejects Unicode identifier U+a0 ... passed
# rejects Unicode identifier U+2003 ... passed
# rejects Unicode identifier U+feff ... passed
# tests 28 / pass 28 / fail 0 / skipped 0 / duration_ms 46336.5638
```

该轮含 22 个真实恢复拒绝负例、嵌套 AND 旧 manifest 成功恢复、注入不执行检查，以及 5 个纯比较器测试。新一轮备份为 `data/backups/backup_289e59cbf36f40740e8e7343cdde8881/database.dump`；其源库和预期成功恢复目标已由夹具核对 OID/owner/完整 marker 后清理，备份仍保留。相关三个文件 `node --check` 和限定本次文件的 `git diff --check` 均退出 0。没有重复无关 suite；旧 backup 全套守卫此前 11 项通过，本次生产变化只在词法空白处理，上述集成已实际覆盖恢复和拒绝清理路径。

RED 第一轮的原夹具只登记预期成功恢复，三次意外接受的负例没有登记清理。已补强夹具：即使未来负例错误成功，也先登记新目标身份，再由同样 OID/owner/marker 守卫清理。协调者明确要求这三份本轮新库暂保留为缺陷证据，没有为清理删除旧库或扩大范围。创建依据是此轮 `backup_20a4bf048a70d2fad96618e946e30a54` 目录内对应成功 `restore-<database>.json`，时间与顺序如下：

| RED 负例 | 本轮保留库 | 成功记录时间（UTC） |
| --- | --- | --- |
| U+00A0 | `restore_ab5d528d104fc979022672145edaba30` | 2026-10-20T14:31:32.288Z |
| U+2003 | `restore_6e07d74fd7f0c1ddd95d36dcb837778c` | 2026-10-20T14:31:33.529Z |
| U+FEFF | `restore_66801c38b3723990cfb2cc0a4a046d82` | 2026-10-20T14:31:34.737Z |

因此上文“只有同份 RED/GREEN 演练的 restore_40... 特意保留”描述的是首轮状态；现在另有这三份本轮 RED 库按要求保留。既有 `restore_40d94f1ee47c98bcafe5280cdba8266b` 和全部旧恢复库均未动。该轮测试只临时变更其本轮 manifest 作为拒绝负例，finally 恢复原字节；业务原备份与 manifest 未修改。修复及补充报告待同一独立 reviewer 复审后，才由 root 接续业务备份恢复。
