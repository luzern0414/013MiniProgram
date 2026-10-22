# 员工凭据与授权 API 实施报告

日期：2026-10-20。范围：staff-access 计划 Task1；本地 API、Prisma 和真实 PostgreSQL。没有创建生产管理员，没有接入微信或更改细分角色体系，没有生产部署验收。

## 实现

- User 新增 staffAccount/passwordHash（可空）、enabled（默认true）、revision（默认0），品牌+账号唯一；devAccount 原唯一索引不变。迁移 `202610200005_staff_access` 只增加列及索引，不删除或改写已有业务数据。
- 新 StaffController/StaffService 接管员工列表、新建、编辑、停用/启用、密码重设。移除 MerchantController 原 GET staff，避免重复路由；保持 OWNER/CLERK 权限模型。
- 账号白名单规范化、密码不 trim、姓名长度、授权数组长度/去重/同品牌/操作者授权集合均由后端验证。新建固定 CLERK；OWNER 与越权目标禁止编辑。列表裁剪不可管理门店ID。
- 密码通过 Node crypto.scrypt 保存随机盐的版本化格式；参数固定，严格解析，timingSafeEqual；不存在账号执行同成本KDF。无额外依赖。
- 登录按 IP+品牌+账号哈希限制15分钟10次，缓存5000项上限；进程内限流不跨实例共享，此为当前本地单进程边界，多实例部署需共享限流设施。
- 身份在每次请求实时核查 enabled；开发登录也检查停用。事务内重查 OWNER 会话与当前授权；revision条件更新、关系替换、会话撤销和审计原子完成。密码重设、停用与实际门店变化撤销全部目标会话。
- logout 幂等撤销当前会话，保留其他设备会话；响应成功意味着本次 token 已不存在或已删除。
- 500错误过滤器原先输出 Prisma message，可能包含查询参数。测试先复现该泄露，再改为只记 requestId/类型/受控 Prisma代码，保持问题可追踪并防止凭据泄露。
- API 合约已补全字段、状态码、权限、版本冲突、输入范围与部署限制。

## TDD 与实际结果

先在独立 schema `test_staff_access` 应用原四个迁移，新增真实HTTP/DB测试，首次失败：OWNER创建员工预期201，实际404。随后实现API与迁移。日志泄露回归测试首次失败（记录中出现敏感查询参数），修复后通过。审计断言曾误将合法事件名 STAFF_PASSWORD_RESET 当作秘密；修正断言为敏感字段/实际凭据值后通过，并未放松实现要求。

最终实际执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @restaurant/api build` | Prisma generate + tsc 成功 |
| `pnpm --filter @restaurant/api test:staff`（DATABASE_URL schema=test_staff_access） | 3/3通过：严格凭据/随机盐、日志保密、完整真实HTTP/DB链路 |
| `pnpm --filter @restaurant/api test` | 9/9通过 |
| `pnpm --filter @restaurant/api test:integration`（schema=test_staff_access） | 1/1真实数据库回归通过 |
| `node scripts/integration.mjs` | 11/11真实HTTP通过；自建 test_acceptance_* schema 已清理 |
| `pnpm --filter @restaurant/api exec tsc -p tsconfig.json` | 最终源码编译成功 |

员工链路实测覆盖：OWNER创建、大小写规范化、重复/并发创建唯一冲突、非法输入、role注入拒绝、错误密码与不存在账号同401、密码首尾空白保留、员工403、跨品牌/越权门店403、受限OWNER不能管理他店员工、列表不泄露他店ID、OWNER不可编辑或重设密码、姓名即时读取、旧版本409、并发版本更新一成功一冲突、授权删除撤旧会话、新登录读新授权、密码重设撤旧会话且旧密码失败、停用阻止旧会话及再次登录、启用恢复真实登录、幂等退出只撤本设备、开发身份停用不能绕过、真实审计不含凭据、限流429。

测试只重建自己的 `test_staff_access` 数据；未重置 public/development。协调器已反馈通过 `pnpm local:migrate` 成功应用开发库迁移，保留既有数据，并负责重启3000；本报告的测试证据仍仅指隔离测试环境。Prisma generate前协调器已确认停下自己拥有的3000进程；本任务没有停止任何进程。test_staff_access 保留为可重复运行的隔离测试 schema，其中只有明确测试业务数据；不可当正式数据使用。测试凭据只在测试文件内用于该隔离环境；文档无真实密码/token/hash。

## 交接

修改/新增：apps/api/package.json、prisma/schema.prisma及迁移、src/app.module.ts、src/common/http.ts、auth.controller.ts/auth.service.ts/credentials.ts、staff.controller.ts/staff.service.ts、merchant.controller.ts原staff入口、tests/staff-access.test.ts、本报告、API合约员工专节。

保留协调器已有 orders.service.ts 的 cashReceipt 和 main.ts 的 CORS 修改，未修改前端或其他端文件，未提交任何文件。开发库应用命令由根任务使用受控 DATABASE_URL 执行 `node apps/api/node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma`。不需再次 generate；当前dist已编译。

已编写、已运行、上述本地API/DB测试通过；Web/商户小程序真实页面验收由协调器及Task2继续，首位OWNER离线初始化由Task3另行实现。生产/微信真机未验证。
