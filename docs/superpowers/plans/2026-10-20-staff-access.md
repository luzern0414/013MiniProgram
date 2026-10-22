# 员工凭据与授权实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task.

**Goal:** 让店主能够建立可登录的真实员工账号、分配授权门店、停用账号及撤销会话，在本地三端完成验证。

**Architecture:** 在现有 NestJS/Prisma 身份模块增加员工凭据和独立 StaffService，不把新的业务继续堆进 MerchantController。保持 OWNER/CLERK 的现有权限边界，细分经营角色另设模块，不由本任务虚构完成。Web 和商户小程序共用员工登录接口。

**Tech Stack:** Node24 内置 crypto.scrypt、NestJS11、Prisma6.19、PostgreSQL16、Vue3、uni-app。

## Global Constraints

- 用户已批准整体设计且要求先完成本地功能；不依赖微信或生产资源。
- 不提交真实密码、token 或密码 hash；日志及响应不能包含凭据。
- 每个业务操作通过真实 API/数据库；金额、订单及现有恢复行为保持兼容。
- 普通员工不能创建账号、授权自己、修改 OWNER 或跨品牌操作。
- 新会话与既有会话都必须受停用/撤权约束。生产禁用开发身份；无公开默认管理员。
- 先观察失败测试再实现；实际 UI 操作与数据库核查由协调器完成。
- 字号至少14px，提交禁重，失败提示清晰，保留 requestId。

### Task 1: API 员工凭据与授权

**Files:** 修改 apps/api/prisma/schema.prisma、新增迁移；新增 src/modules/staff/{staff.controller,staff.service}.ts；修改 auth.service.ts/auth.controller.ts/app.module.ts；新增 src/modules/auth/credentials.ts 与 tests/staff-access.test.ts；修改 apps/api/package.json 测试入口；新增 docs/tasks/staff-api-report.md。

**Interfaces:**

```ts
// existing /auth/dev-login stays development-only.
POST /auth/staff-login { brandId: string, account: string, password: string }
// same successful envelope/user shape as dev-login, environment reflects runtime.
POST /auth/logout {} // revoke only current session; repeats stay safe
GET /merchant/staff?storeId=... // include enabled, revision, account, authorized stores; never credentials
POST /merchant/staff { storeId, name, account, password, storeIds: string[] }
PATCH /merchant/staff/:id { storeId, expectedRevision, name?, enabled?, storeIds? }
POST /merchant/staff/:id/reset-password { storeId, expectedRevision, password }
```

- [x] 写真实 PostgreSQL 测试：OWNER 创建 CLERK 并登录；同品牌重复账号冲突；大小写规范化账号；错误密码和不存在账号同样401；员工403；跨品牌/超出操作者门店集合403；OWNER不可通过本入口编辑；revision旧值409；停用后旧会话401且不能再次登录；授权删除后旧会话被撤销；密码重设后旧会话和旧密码都不可用；审计不含hash/password；重复退出无副作用。运行新增测试，记录 RED。
- [x] 添加 User enabled 默认true、staffAccount可空、passwordHash可空、revision默认0，品牌+staffAccount唯一（devAccount独立保持）；迁移对旧数据无破坏。严格白名单校验：账号转小写后仅a-z0-9._-，3至64字符；姓名1至80；密码12至128字符且不自动trim；storeIds非空去重、最多100、每个在当前OWNER授权集合且同品牌。
- [x] 使用随机salt与固定受控参数的scrypt（例如N=16384/r=8/p=1、32字节、64MiB maxmem），timingSafeEqual比较；hash格式版本化、严格解析；不存在账号也运行一次等成本校验。登录返回统一401；按IP+品牌+账号有限窗口节流，大小有上限，不把原始凭据作为日志内容。
- [x] 在事务中重新校验操作者当前有效身份、OWNER及授权集合；通过 expectedRevision 条件更新和会话撤销、StaffStore替换、审计原子提交。禁止创建或编辑OWNER；用户列表仅展示与查询门店有关的人员，不泄露不可管理门店信息。账号创建时服务端固定role=CLERK，不允许请求自选role。
- [x] AuthService.user每次查询实时enabled；停用/重置/变更门店时删除目标所有session。开发登录也检查enabled，避免固定体验入口绕过停用。
- [x] 运行领域/新增真实DB/原HTTP回归与tsc，记录GREEN。迁移/Prisma generate需要停止3000的项目API，先消息告知协调器，不擅自结束未知进程。测试必须使用test_*独立schema，禁止重置development/public。
- [x] 更新API合约和专属实施报告。不要声称首位生产管理员初始化或完整角色体系已完成；该部分另任务实现。只提交本任务文件，保留工作区既有修改。

### Task 2: Web 与商户小程序接入

**Files:** 新增 apps/merchant-web/src/StaffEditor.vue；修改 People.vue/App.vue；新增并修改 merchant-mini 认证/员工页面与控制器；专属报告 docs/tasks/staff-ui-report.md。

- [x] 根据Task1实际合约编写账号规范化、失效会话清理和编辑版本冲突行为测试，观察失败再实现。
- [x] Web登录增加员工账号密码，品牌从公开配置取得；体验入口仅API明确development时显示。商户小程序采用同样逻辑。退出调用logout并清理本地敏感状态；响应未知时保留明确提示，不伪称已撤销服务端会话。
- [x] People员工页新增账号、姓名、授权门店选择；编辑姓名/授权、停用/启用、重置密码使用明确操作反馈及revision。新建密码输入不持久化到本地存储，提交后清空。
- [x] 商户小程序门店页增加OWNER员工管理入口，复用同样API规则；普通员工不可见，直接调用仍由API拒绝。
- [x] 运行测试/H5与mp-weixin构建。协调器实际页面新建员工、另端登录、变更门店、停用后旧会话拒绝、刷新持久化并核对审计，再独立审查。

### Task 3: 受控管理员初始化与验收收口

- [x] 使用单独计划实现离线受控首位管理员初始化命令，禁止HTTP公开注册OWNER和默认密码；不把未实现脚本写入已用命令。
- [x] 更新config/README、需求台账四种状态；本任务不替代微信真机/生产验证。

设计来源：已批准 restaurant-design.md 的多门店授权、员工凭据、会话撤销和本地经营要求。当前计划是该设计的实现细化，不改变业务模型。

