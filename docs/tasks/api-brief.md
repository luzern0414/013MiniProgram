# API implementation task

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


### Task 2: API and transactional restaurant core

**Files:** apps/api/package.json, src/main.ts, src/app.module.ts, src/common/*, src/modules/{auth,stores,catalog,orders,merchant,cms}/*, prisma/schema.prisma, prisma/migrations/*, prisma/seed.ts, tests/*。
**Consumes:** DATABASE_URL和API合约；**Produces:** /api/v1 所有R1合约接口，端口3000。

- [ ] 首先编写金额/状态/授权/库存相关测试。示例：`expect(canTransition('COMPLETED','ACCEPT')).toBe(false)`；`expect(assertPositiveQuantity(0)).toThrow()`。运行看到功能缺失失败。
- [ ] 实现 Prisma schema/迁移、门店品牌/员工/商品/SKU/加料/报价/订单快照/库存预占/现金流水/审计/CMS和开发会话。
- [ ] 实现固定开发身份与明确环境保护；生产缺少微信配置必须诚实报不可用。
- [ ] 实现服务端报价、带门店校验的条件库存更新、同事务订单与事件、幂等键绑定用户与请求哈希、取消只释放一次。
- [ ] 实现员工授权、商品编辑、订单状态机和真实现金收银；改价不能影响历史订单。
- [ ] 实现数据库聚合统计、会员/员工真实查询、CMS草稿发布与版本冲突。
- [ ] 运行 `pnpm --filter @restaurant/api test`、`pnpm --filter @restaurant/api build`；运行迁移和隔离开发seed，提供API结果与测试报告。
- [ ] 外部能力尚未实现的明确限制必须写入报告，不以503作为已完成微信支付功能。
- [ ] 独立review审查权限/事务/幂等/边界，修复重要问题后再完成本任务。


Read docs/architecture/api-contract.md for exact routes and payloads. Own apps/api only. Keep modules focused and provide tests and a report at docs/tasks/api-report.md. The root coordinator handles shared workspace dependencies and database runtime; request installation once package.json is ready. Do not modify root package or pnpm-lock.yaml.
