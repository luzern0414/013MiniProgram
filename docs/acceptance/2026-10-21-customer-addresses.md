# 顾客地址簿本地验收

状态：地址簿API Task1已派唯一实现者，尚未交付、审查或源迁移。用户确认没有AppID/支付/域名/服务器，先完成本地功能；地址簿不表示配送报价或商家配送已经可用。

设计依据：已批准总体方案A及docs/superpowers/specs/2026-10-21-delivery-address-design.md。实施固定合同：docs/superpowers/plans/2026-10-21-customer-addresses.md；Task1 brief .superpowers/sdd/customer-addresses-api-brief.md，报告docs/tasks/customer-addresses-api-report.md。

## 源保护门槛

- [ ] Task1严格合同、归属/品牌/角色、容量/默认并发、幂等与CAS、软删及旧操作返回当前事实、操作日志原子性、013旧列原时间保护、隔离schema所有权和独立审查。
- [ ] 审查后fresh源旧列/raw时间快照、新备份、实际恢复及全部旧非Session列/时间比较；仅013迁移development，再核对旧列/时间与API健康。
- [ ] Task2共享控制器与顾客UI实际行为、恢复/损坏/身份/定位、旧订单锁OR及独立审查。
- [ ] 源真实页面新增/编辑/默认/删除与刷新SQL，两个页面旧版本409保留输入、丢回执/离线/真实401及同身份原key/body恢复；旧业务逐行保持。
- [ ] 390px/14px/操作可达/动效，实际查看截图；README/config/requirements/ledger同步。

root准备的customer-addresses-approved-{preservation,restore-preservation}.mjs已node --check，尚未连接源或输出验收结果；只有独立API Approved后运行。不得用现金012旧备份/恢复证据代替013关卡。所有SQL只读，正式地址写由真实顾客UI/API执行，禁止源seed/reset或回填库存，不删除旧备份和restore数据库。

前模块完成时源参考：21订单/80事件、14现金36806分、5退款5483分、8草稿、3已关闭班/6交班审计、public4订单、development10会话；此处是参考，不代替迁移前fresh事实。现金A班cmvh3vegn000s3m1cdydsam9f及B班cmvh48dpf001n3m1c6znqtj5q均已关闭；本轮已完成验收单cmvh41im800123m1co0jfdn16已部分退款100分，不再用于地址测试或资金写。菌菇小份库存3、样品规格0都是合法销售结果，不得回填。

地址簿只推进REQ006的前置依赖，配送规则/计价和员工配送任务继续独立实施。未完成事项准确保留；不将构建/隔离HTTP、浏览器模拟坐标等同微信真机定位、真实道路配送或生产验收。
