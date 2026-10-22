# 顾客地址簿 UI — Task 2 实施记录

日期：2026-10-21；分支：`codex/restaurant`；实现基线：`9b00b04`。Task 1 地址 API 提交 `2d02b4d` 已在历史中。本记录只涵盖顾客端地址簿、共享恢复控制器、共享输入组件机械兼容和构建验证；未进行源地址簿写入、SQL/API 验收或真机验证。

## 已编写

- `packages/mini-core/src/customer-addresses.mjs` 实现顾客地址簿控制器：列表、单条读取、新增、编辑、设默认和软删除均使用真实 API；严格校验地址结构、版本、UTC 时间和 WGS84 整数微度配送点。
- 写请求前按原顾客身份持久化完整 method/path/body/key 并回读；设置或清理恢复记录失败时不发送或不解锁写入。网络、超时、异常响应及不符合作用域/结构的成功响应保持原 pending，恢复重放沿用原 key 与 body，不自动换 key 或 revision。
- 会话代数、顾客身份和控制器 generation 共同隔离异步结果；同账号新会话、另一账号、切店或 dispose 后的迟到响应不能发布地址内容。持久恢复记录按用户隔离，登录过期清空当前地址/PII 视图但保留原身份恢复事实。
- 地址变更先发布实际服务器读取结果，再清理恢复记录；初次明确 CAS 冲突保留表单和输入，必须显式读取最新内容后确认 revision 才能继续。重放成功但服务端地址随后又有 revision/删除变化时，展示当前事实并明确原操作已完成，不声称刚刚再次保存成功。
- `apps/customer-mini/src/addresses.js` 提供 uni storage 枚举、同步 readback 和 `getStorageInfoSync` 适配；`CustomerAddresses.vue` 提供空态、读取、新增/编辑、设默认、独立删除确认、20 条上限、版本冲突与 pending/corrupt/replay/review 恢复入口。
- `AddressForm.vue` 清楚分组收货人、手机号码、地区和详细地址，保留确认后的配送点；修改地区或详细地址会清除配送点。`AddressPoint.vue` 仅在 `uni.getLocation({ type: 'wgs84' })` 可用时调用定位，结果先作为 proposal，用户明确点击采用后才写入当前表单；取消、拒绝和迟到结果不覆盖地址。
- `customer.js` 将地址簿控制在同品牌所有门店间复用，不按门店创建第二份地址簿；地址 busy/unknown/corrupt 与原订单 pending 组合为集成锁，切换门店、用餐方式和提交前仍按既有锁阻止新业务。启动恢复在地址组件挂载前独立发现地址 pending/corrupt。
- 顾客「我的」页面接入地址管理；主页面提供与订单恢复独立的地址恢复通知。配送模式从本人未删除地址列表选择并保存 `selectedAddressId`/`selectedAddressRevision`，地址 revision 或选择变化会使 quote 失效。
- 配送仍明确显示“配送服务尚未开通”，选择地址只保留下一模块所需状态，不生成假报价；原任意地址 JSON 已从 quote 输入移除，配送报价和提交被明确拒绝。
- 将商户端 `AccessibleInput.vue` 的原实现机械迁移为 `packages/mini-core/src/components/AccessibleInput.vue` 并通过 package export 显式共享；商户原路径保留透明包装，顾客地址表单直接使用共享实现。
- 顾客微信 manifest 声明 `scope.userLocation` 的用户可读用途和 `getLocation`，未填写 AppID。地址页面使用既有视觉变量，正文/标签不小于 14px，操作至少 44px，并包含 390px 和 reduced-motion 规则。
- 修正 `customer-selection.test.mjs` 的 uni fixture，补 `getStorageInfoSync`，使接入地址控制器后的既有启动/选店测试保持真实运行环境。未修改 API、Prisma schema、迁移或业务数据。

## RED 证据

- 首轮 RED 执行三个新增测试文件时 exit 1：共享模块 `customer-addresses.mjs` 尚不存在，且 mini-core 尚未声明测试所需 Vue 依赖；3 个测试文件均未进入 GREEN。
- 实现后先通过 21 项聚焦行为/SFC 测试，再进行全包回归。接入中一度出现既有 `customer-selection` 4 项失败；原因是其 uni fixture 缺少地址适配器构造所需的 `getStorageInfoSync`。只补该环境 API 后，4 项恢复通过，未放宽业务断言。
- 预审查项均以测试锁定：重放拒绝伪造或不匹配的 operation 版本；地址点拒绝字符串坐标；manifest 声明定位用途/API；地址 pending/corrupt 通知在 profile 组件挂载前可见。

## 已运行

以下命令在最终实现上实际运行并退出 0：

| 命令 | 结果 |
| --- | --- |
| `node --test packages/mini-core/tests/customer-addresses.test.mjs packages/mini-core/tests/customer-addresses-customer.test.mjs packages/mini-core/tests/customer-addresses-sfc.test.mjs` | 21/21 通过 |
| `pnpm --filter @restaurant/mini-core test` | 252/252 通过 |
| `pnpm --filter @restaurant/customer-mini build:h5` | H5 构建完成 |
| `pnpm --filter @restaurant/customer-mini build:mp-weixin` | 微信构建完成 |
| `pnpm --filter @restaurant/merchant-mini build:h5` | H5 共享输入回归构建完成 |
| `pnpm --filter @restaurant/merchant-mini build:mp-weixin` | 微信共享输入回归构建完成 |
| `git diff --check` | 无 whitespace error |

## 自动化测试通过

聚焦测试覆盖缺失/空/损坏恢复记录、存前失败不 POST、存后清理失败继续锁、原 key/body 重放、GET/401/403 保留记录、同账号新会话/其他账号/dispose 迟到隔离、真实列表/表单/删除确认、显式 CAS 重读、地址结构/坐标/时间校验、通知入口、配送点提议确认/取消/迟到、390px 与文字大小规则。全包 252 项通过同时覆盖既有购物袋、预约、订单、会话和门店切换恢复回归。

## H5 构建

顾客 H5 和受共享 `AccessibleInput` 导出影响的商户 H5 均通过 uni-app 生产构建，输出 `DONE Build complete.`。构建只证明编译与共享模块解析通过，不替代浏览器真实地址簿操作。

## mp-weixin 构建

顾客与商户 mp-weixin 均通过 uni-app 生产构建，输出 `DONE Build complete.`。只证明编译产物生成；未导入微信开发者工具或真机。

## 未进行真机验证

当前没有 AppID、已配置业务域名、微信开发者工具会话或设备定位环境，也没有地图检索/逆地理编码服务。因此未声称定位、权限弹窗、真实楼栋选择、H5/微信视觉交互或生产链路已验证。真实页面读写、SQL/审计、低权限会话、真实网络丢回执、浏览器历史/在途导航及源 API 健康仍由协调器独立验收。构建与 fixture 测试不能替代这些验收。
