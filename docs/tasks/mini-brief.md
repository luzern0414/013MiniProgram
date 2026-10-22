# Dual mini-program implementation task

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


### Task 4: Customer and merchant mini programs

**Files:** apps/customer-mini/*, apps/merchant-mini/*, packages/mini-core/*。
**Consumes:** API合约；**Produces:** H5联调端5174/5175，微信dist/dev/mp-weixin构建产物。

- [ ] 使用同一锁定版uni编译器，不混用@dcloudio包版本；创建两个独立manifest/pages文件。
- [ ] 客户端真实选店、分类菜单、SKU/加料弹层、购物车、报价、订单提交、订单详情/取消、我的。
- [ ] 商户端登录门店授权、工作台、订单状态操作/现金收款、商品售罄、营业开关。
- [ ] 共享transport处理网络失败、超时、401、requestId；业务内容不写死，开发入口只在API明确dev环境下提供。
- [ ] 构建为微信小程序和H5；小程序模板使用view/text/button等跨端组件，避免依赖DOM。
- [ ] 行为测试先验证购物车按门店隔离和加料组合指纹；成功后实现购物车持久化与切店确认。
- [ ] 真机尚未运行如实标记；H5点击通过只代表H5链路。
- [ ] 独立review后修复，记录构建命令与产物。


Read docs/architecture/api-contract.md. Own apps/customer-mini,apps/merchant-mini,packages/mini-core only plus docs/tasks/mini-report.md. Coordinator handles root dependencies/lockfile and running API3000. Contact when manifests ready. No hardcoded business data, use dev seed only viaAPI. Actual user spec warm white / ink / restrained orange. Backend experience primary currentlygreen but editable, do not override API configured theme. Build H5 ports5174/5175 and mp-weixin. Avoid empty fake functionality.
