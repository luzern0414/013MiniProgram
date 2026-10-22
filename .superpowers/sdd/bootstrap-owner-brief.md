### Task 1: 首位管理员受控初始化

**Files:** apps/api/src/commands/bootstrap-owner.ts；tests/bootstrap-owner.test.ts；auth.service.ts员工凭据登录角色白名单；apps/api/package.json；docs/tasks/bootstrap-report.md；config/README.md。

**Interfaces:**

```text
pnpm --filter @restaurant/api owner:bootstrap --brand-id <existing-id> --name <name> --account <account> --store-ids <comma-separated-ids> --password-file <restricted-local-file>
```

- [ ] 新增隔离test_bootstrap_owner数据库测试：无OWNER品牌初始化后员工登录成功、授权仅所选门店；第二次拒绝；并发最多一个成功；跨品牌/不存在门店失败且无残留；password/hash不出现在stdout与审计；生产DEV_AUTH关闭仍可用真实管理员凭据；停用后不能登录。实际运行观察RED。
- [ ] CLI严格解析白名单参数，拒绝重复/缺失/空门店；复用账号/密码函数。密码从本地文件读取，禁止命令行直接传密码；限制128字符和单个尾换行约定，不trim实际密码。拒绝符号链接/非普通文件，文件大小最多1KiB，文件不保存在临时公用目录。
- [ ] 事务内锁定品牌行后检查品牌不存在任何OWNER，逐一验证门店；创建OWNER、授权、无凭据审计同事务；并发通过品牌行锁与已有检查保证仅一次。已有OWNER时不给“强制”覆盖开关；后续密码恢复应单独设计受控流程。
- [ ] staff-login接受CLERK或OWNER，均用同样真实凭据与会话规则；开发身份不因此可用于生产。无凭据的旧OWNER无法从该入口登录，不能悄悄赋予默认密码。
- [ ] 运行新增真实DB、现有staff/domain/HTTP回归，记录GREEN；独立review后更新文档真实命令。只在隔离测试品牌执行初始化验收，不修改体验店主身份。


