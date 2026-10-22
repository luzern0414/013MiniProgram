# 员工登录与管理界面实施报告

日期：2026-10-20。范围：`staff-access` 计划 Task2；Web、商户小程序及必要的 mini-core 共用行为。本任务没有修改 API、数据库、根依赖或锁文件，没有接入生产资源。实际浏览器操作和数据库/审计核对由协调器另行执行。

## 实现

- Web 的 `LoginForm.vue` 和商户小程序的 `MerchantLogin.vue` 提供员工账号、隐藏密码输入；品牌标识来自实际 `/public-config.brandId`，缺失时明确提示并禁用提交。体验入口仅在服务端明确 development 时显示，Web 同时要求开发构建。
- 账号去除输入首尾空格并转小写，密码按原字符提交。登录和新建/重设密码输入仅在组件内存中存在，提交后（含失败）清空；账号凭据不写入本地存储。小程序仅保存返回的 token/user/environment。
- Web 的 People 仅整合 `StaffManager.vue` 与 `StaffEditor.vue`；商户小程序门店页通过 OWNER 专属 `StaffPanel.vue` 和独立 `StaffEditor.vue` 提供员工管理，没有继续把业务堆进 App/index。CLERK 无管理入口，真实写入仍由 API 强制鉴权。
- 新建包含姓名、账号、初始密码与真实授权门店选择；编辑支持姓名/门店授权，启用/停用和重设密码有单独确认内容。店主账号仅展示，不能通过员工入口编辑。账号创建后只读。列表展示真实账号、状态与授权门店名称。
- 共用 `packages/mini-core/src/staff.mjs` 管理输入规则、API 调用及版本冲突：所有员工写操作携带 expectedRevision；VERSION_CONFLICT 锁定再次提交，必须显式重新读取最新记录后核对。ACCOUNT_CONFLICT、RATE_LIMITED、权限和失效会话显示自然中文并保留 requestId。提交禁重，写入超时/网络失败提示先刷新核对结果，不自动重发。
- 用户退出先向 `/auth/logout` 提交当前 token 的撤销，再立即清理本机登录和私有界面状态；网络结果未知时只声称本机退出，提示尚未确认服务器撤销。401 仅执行本地失效处理，不递归调用 logout。无 token 的错误密码及旧 token 延迟返回的401，不会清除当前新会话。
- 保留既有收银状态机、guard、各员工/门店隔离的恢复数据；退出和会话失效不删除现金恢复记录。Web 仍保留按原 userId+授权门店核查的恢复导航提示。新账号不会读取或清除原账号的现金记录。
- 表单正文/辅助文案至少14px；Web 使用已有 Modal 键盘焦点和 Escape/Tab 支持、原有 reduced-motion 规则；新增组件无额外动画。小程序使用有标签的输入和 checkbox-group，写入期间禁用相关编辑与父页面导航。
- 协调器实测发现本地 Vite 预编译缓存仍引用 mini-core 旧导出，经协调器明确要求，在两小程序 Vite 配置增加 `optimizeDeps.exclude: ['@restaurant/mini-core']`，使工作区源代码变更不被旧依赖缓存截断。只修改这项必要配置，运行进程由协调器管理。

## RED → GREEN

先添加测试并运行，实际观察到以下预期失败，再写实现：

1. 员工登录参数、创建授权校验和编辑版本行为未实现（函数缺失断言），本地 session 清理和服务端 logout 未实现，共5项失败。
2. 员工共用 controller 缺失；实现后验证旧 revision 冲突只发出一次写入，重复保存受阻，显式重新加载后采用最新 revision/姓名。
3. 商户小程序 staffLogin 缺失、logout 没有发服务端请求，共2项失败；实现后验证请求品牌/规范化账号/原密码、本地存储无密码、失效清私有状态且保留现金记录、撤销请求带原 token、未知撤销提示。
4. 退出清理曾移除恢复导航提示。补充断言后先失败，再修正为保留原用户恢复提示，兼容原收银恢复流程。
5. 匿名错误密码401触发失效回调（实际计数1而非0）；Web缺失会话标识保护断言失败。实现请求 token 与当前 token 的匹配检查后，匿名401和旧会话延迟401不会清除新账号。

测试使用隔离的进程内请求运行时模拟网络边界，未以模拟结果替代真实业务验收；真实 API、浏览器及数据库链路由协调器进行。原有 Web14项及 mini-core11项全部保留。

## 最终执行结果

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @restaurant/merchant-web test` | 17/17通过（既有14 + 新增3） |
| `pnpm --filter @restaurant/mini-core test` | 18/18通过（既有11 + 新增7） |
| `pnpm --filter @restaurant/merchant-web build` | vue-tsc + Vite成功 |
| `pnpm --filter @restaurant/merchant-mini build:h5` | 成功 |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | 成功 |
| `pnpm --filter @restaurant/customer-mini build:h5` | 成功 |
| `pnpm --filter @restaurant/customer-mini build:mp-weixin` | 成功 |
| `git diff --check` | 通过，仅已有换行规范提示 |

构建工具输出 uni-app 可更新/托管平台提示，不影响本次构建。没有运行 Prisma generate、没有停止 API 或浏览器进程，没有提交文件。

## 状态与边界

已编写：Task2 两端员工界面、共用行为及回归测试。已运行：上述单元测试和构建。已在本地上述自动化范围验证：输入规范、版本冲突、会话隔离和收银兼容行为。真实页面新增员工、另端登录、改授权、停用旧会话、重设密码、刷新持久化及审计，由协调器追加实际验收记录；本报告不代替这些证据。

未上线：未使用微信 AppID、真机或生产资源；当前凭据登录限 CLERK，首位 OWNER 的离线初始化属于 Task3，不在此处宣称完成。

## 协调器真实页面验收后的修正

协调器已实际完成：Web新建双门店员工、商户H5凭据登录读取双门店；移除门店授权后商户H5旧会话401并清空；重设密码后两端新凭据登录只读取剩余门店；停用后商户H5和Web旧会话均被拒绝；Web刷新失效后可重试回到登录表单；商户H5店主新建另一员工，Web刷新可见。协调器SQL核对停用员工 enabled=false、revision=4、session数量0，审计不含凭据。上述为协调器反馈，具体浏览器/SQL证据由其验收记录承载。

浏览器同时复现无障碍缺陷：uni-h5把输入标签的for和id分别留在自定义wrapper上，实际原生input没有可访问名称，getByLabel无法定位。这是本轮修正的RED证据。新增小型跨平台 `AccessibleInput.vue`，登录与员工编辑共用：H5通过局部组件ref给真正的原生input绑定aria-label和唯一id，标签点击聚焦原生输入，post-render及子节点替换观察保证禁用状态切换或组件重建后仍有效；mp-weixin保留uni原生标签/id/aria-label参数，DOM代码仅编译进H5。桥接仅处理可访问性，不通过DOM读写业务数据。

两端account=null的既有身份现在显示“体验身份”，其重设密码操作替换为静态文字，避免暗示没有账号的体验员工可以通过密码登录。仍保留姓名/授权及启用/停用操作。

修正后重新执行Web17/17、mini-core18/18、Web构建、商户H5与mp-weixin构建；无障碍getByLabel和点击聚焦的GREEN由协调器在真实浏览器确认，本报告不把构建成功当作无障碍验收成功。

协调器继续实测发现重复标签RED：getByLabel精确匹配同时命中uni-input包装层和原生input，触发严格匹配失败。本轮只修正共用输入组件，在H5完成原生标签绑定时移除包装层重复aria-label；mp-weixin继续保留uni原生aria-label参数。再次执行商户H5及mp-weixin构建通过；唯一匹配与标签点击聚焦仍由协调器用真实DOM复核。
