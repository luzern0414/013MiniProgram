# Merchant web implementation task

## Global Constraints

- 金额全部使用整数分，人民币 CNY；时间存 UTC，营业日按 Asia/Shanghai。
- 所有正式业务数据通过 API 读写真实数据库，生产不注入体验数据。
- 所有员工接口服务端校验品牌与门店授权，顾客只看本人订单。
- 三端遵循 `docs/architecture/api-contract.md`；UI正文与辅助文案均至少14px。
- 应用数据加载失败时明确展示错误，不能回退成写死商品或伪造成功。
- 外部微信登录、支付、配送、设备未真实联调则不可标记已验证。
- 关键业务先写有意义的失败测试，再实现，再运行验证。
- 每个任务记录实现、运行、测试、上线四种不同状态。
- 原截图90项保留在 `data/requirements/features.json`，R2/R3不在R1假装完成。


### Task 3: Merchant desktop application

**Files:** apps/merchant-web/{package.json,index.html,vite.config.ts,src/*}。
**Consumes:** API合约；**Produces:** 5173的真实API经营后台，不使用静态业务数组。

- [ ] 先写一个金额与错误展示/登录环境保护的行为测试并运行失败；纯样式无需镜像测试。
- [ ] 以深墨侧栏、暖白工作区和克制橙色构建导航、登录、真实门店选择和加载/失败/空态。
- [ ] 工作台、订单、商品、收银、桌台、会员/员工、门店设置、页面内容编辑，全部入口连接实际接口。
- [ ] 商品表单支持真实新增、编辑、SKU价格库存；订单支持状态操作及现金收款，按钮按状态/权限控制并处理后端拒绝。
- [ ] 收银购物车从catalog选择，调用quotes/orders/cash-payment，挂账/扫码等未实现能力不显示伪操作。
- [ ] CMS支持保存草稿、发布、预览当前已发布内容和版本冲突反馈；不声称实现完整拖拽装修。
- [ ] 接入短促过渡、骨架、提交禁重、键盘焦点、减少动态效果设置；14px最小文案和移动宽度可用。
- [ ] 运行test/build；之后Playwright真实点击新增商品、编辑库存、下单现金收款、刷新验证及跨店权限。
- [ ] 独立review后修复并提供可核查报告。


Read docs/architecture/api-contract.md for exact routes/payloads. Own apps/merchant-web only plus docs/tasks/web-report.md. Do not modify root package or pnpm-lock.yaml. Root coordinator installs when package.json ready. Backend may still be implementing so use contract, no static mock data.
