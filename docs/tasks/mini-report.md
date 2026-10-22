# 双小程序本地实现记录

日期：2026-10-20。范围仅为 `apps/customer-mini`、`apps/merchant-mini`、`packages/mini-core`。

## 四种状态

| 范围 | 已编写 | 已运行 | 已测试 | 已上线验证 |
| --- | --- | --- | --- | --- |
| 顾客端：选店、菜单分类、SKU/加料、购物袋、堂食桌号/外送地址、报价、提交、详情、取消、我的 | 是 | H5 5174 | 共享行为测试通过；协调任务正在进行真实 H5 点击验收 | 否 |
| 商户端：授权门店、经营聚合、订单、现金凭证、履约、店主商品售罄、营业状态 | 是 | H5 5175 | 共享行为测试通过；协调任务正在进行真实 H5 点击验收 | 否 |
| 微信小程序 | 是，两个独立 manifest/pages | 编译器实际运行并输出微信产物 | 编译通过；未运行微信开发者工具、模拟器或真机 | 否 |
| 微信登录、微信支付、配送第三方、外部设备 | 入口遵循真实 API，不伪造成功 | 本地服务未配置外部集成 | 未验证真实第三方服务 | 否 |

## 实现与约束

- 两端所有 `@dcloudio/uni-*` 与 `@dcloudio/vite-plugin-uni` 均锁定 `3.0.0-4060620250520001`；Vue `3.4.21`、Vite `5.2.8`。根任务安装依赖和 lockfile，并覆盖 vue-router 为兼容版本 `4.5.1`。
- 顾客品牌、首页内容、门店、图片地址、菜单、库存、报价、订单、会员积分与余额均读真实 API。仅 API 明确返回 `environment:development` 时展示体验登录。
- 暖白背景、墨色正文，主题色读取 API 已发布内容，正文与辅助文字最低 14px。未提供图片的商品使用真实名称首字标识，不伪造食品照片。
- 跨平台模板使用 view/text/button/image/picker/input/textarea；没有直接 DOM 业务依赖。
- 购物袋按门店与用餐方式持久化，SKU 与排序/去重后的加料构成组合指纹；切店/切用餐方式确认后保留原购物袋。报价是金额和库存的权威来源。
- 提交订单前保存 quoteId 和 Idempotency-Key，超时/网络/服务端未知失败不生成新订单标识；刷新后可以恢复。401 清除会话但保留恢复记录，重新登录后再恢复。
- 现金确认保存用户、门店、订单、实收整数分与固定请求标识，未知结果期间冻结原金额；刷新/重新登录可重试原订单。仅显示 API 返回的 cashReceipt 实收、入账与找零。已关闭订单从权威详情确认后解除恢复状态。
- 员工只看到服务端身份授权门店；商品销售状态仅店主显示操作入口，服务端仍再次鉴权。营业状态允许授权店员操作。
- 网络失败、超时、401、无数据、缺库存、门店休息、状态冲突、未配置集成均给出明确反馈。错误携带 requestId 便于核查，没有静态商品兜底。

## 已实际执行

工作目录均为项目根目录 `D:/Codes/013MiniProgram`。

```powershell
node --test packages/mini-core/tests/*.test.mjs
pnpm --filter @restaurant/customer-mini build:h5
pnpm --filter @restaurant/merchant-mini build:h5
pnpm --filter @restaurant/customer-mini build:mp-weixin
pnpm --filter @restaurant/merchant-mini build:mp-weixin
pnpm --filter @restaurant/customer-mini exec uni -p mp-weixin
pnpm --filter @restaurant/merchant-mini exec uni -p mp-weixin
pnpm --filter @restaurant/customer-mini dev:h5
pnpm --filter @restaurant/merchant-mini dev:h5
pnpm --filter @restaurant/customer-mini build
pnpm --filter @restaurant/merchant-mini build
```

共享测试：先实际观察 5 项缺失行为断言失败，再实现至 5/5；追加现金恢复断言实际失败，再至 6/6；追加 503 状态保留断言实际失败，再至 7/7。独立审查后追加 4 项真实控制器回归测试，实际观察 4/4 失败后修复至最终 11/11。覆盖门店/方式隔离、加料指纹合并、订单提交恢复、401/请求追踪、网络/超时不重放写操作、现金原金额恢复、服务端未知写失败、身份隔离、切换账号时加载失败不泄漏旧门店数据、过期报价响应丢弃、初始门店服务方式匹配。

两端 H5 production build 与 mp-weixin production build 均实际返回 DONE；独立审查修复后再次完整执行两端 build，四项构建均成功。两端开发微信编译实际返回 `DONE Build complete. Watching for changes`，文件变更后开发构建持续更新。

独立只读审查发现并修复两项 P1（登录失效后保留私人详情、报价响应覆盖购物袋新状态）及一项 P2（初始门店不支持默认自取）。修复先有失败测试，再清理身份/门店数据、对报价输入与用户进行快照校验、标准化用餐方式。独立复审重新运行 11 项测试全部通过，并重复 owner A → 登录失效 → clerk B 的复现确认详情为空；未发现其余确定的阻断问题。复审未代替真机或浏览器验收。

产物：

- `apps/customer-mini/dist/build/h5`、`apps/merchant-mini/dist/build/h5`
- `apps/customer-mini/dist/build/mp-weixin`、`apps/merchant-mini/dist/build/mp-weixin`
- `apps/customer-mini/dist/dev/mp-weixin`、`apps/merchant-mini/dist/dev/mp-weixin`，包含 app.js/app.json/app.wxss、pages、project.config.json。

H5：顾客 http://127.0.0.1:5174，商户 http://127.0.0.1:5175。API：http://127.0.0.1:3000/api/v1。以上均为本地运行地址。

## 外部资源与边界

- 尚无两个正式微信 AppID、微信登录密钥、支付商户资源、request 合法域名与生产 HTTPS 地址，因此不能宣称已上线、已真机或已真实微信支付。
- 两端独立 `src/manifest.json` 的 `mp-weixin.appid` 为空，待拿到各自 AppID 后配置；部署时通过 `.env` 的 `VITE_API_BASE_URL` 配置真实 HTTPS API，模板见各端 `.env.example`。
- 体验身份仅来自开发 API，生产不得启用 DEV_AUTH；外部支付 API 当前明确报未接入，订单不会被前端标记已付款。
- 后台数据维护等 R1 以外页面不放置空按钮。第三方配送及设备联调未涵盖。
- 独立 review 与修复后的最终重新构建已完成，协调任务浏览器验收结果待补；此前不提交代码。
