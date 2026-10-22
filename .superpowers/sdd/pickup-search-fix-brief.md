# Pickup Task2 查号规模修复

读取此文件作为全部修复需求。Task2独立审查 Needs fixes，唯一Important：packages/mini-core/src/pickup.mjs先扫描全部历史订单，超过2000单时拒绝，因此2001历史单即使当天目标在首页也不能核销查号。未获用户批准的规模例外。保留其余Task2行为，不扩展现金退款。

## 绑定约束
- 保留development/public所有数据、会话、备份、恢复库；禁止源库seed/reset/SQL写入及造单/收款。
- 一个实现者，只改此查号缺口相关API/shared测试/必要组件/report/API文档，不动root README/config/progress/requirements/acceptance。
- 金额/预约/库存/历史订单/旧10位号不可改变。商户只能查实时授权品牌/门店；顾客不能借谓词读取他人订单。
- 保留requestId/页面失败反馈、scope epoch、卸载及切店晚响应隔离、14px。

## 实现合约
给现有GET /orders增加可选pickupNumber与pickupServiceDate，查号必须明确storeId；完整号码（支持Q至少4位序号及原10位十六进制，规范化大写）、合法YYYY-MM-DD。两个字段应一起传，非法/不完整400；未传保持普通列表兼容。服务端在真实授权where内加mode=PICKUP、号码相等、日期条件：新单用pickupServiceDate；旧单字段null按createdAt的Asia/Shanghai本地日期半开区间。无权store403。顾客保留userId边界，不能因query覆盖。严格拒绝数组/对象/非法字符串，不靠客户端过滤。
返回沿原items/total/page/pageSize有界分页，stable createdAt+id排序；匹配量最多一页仍可容纳实际老号碰撞，不把读取全历史当必要。两个商户shared直接请求该谓词，移除全历史扫描2000门槛，界面不再声称扫描全部历史；处理不完整/失败，不能把局部结果当完整。若total大于一页，可对匹配集分页或显式分页结果UI，不能静默隐藏。

## TDD与验证
先在已有隔离pickup测试runner增加真实HTTP/SQL case：>2000无关本店历史订单时，目标新号/日期仍200准确；旧10位号Shanghai跨UTC日边界；店/日同号区分、顾客归属、CLERK/跨店、无配对参数/非法日期400。所有夹具只允许安全test_pickup随机schema，不在source制造2001记录。观察RED再实现。
修改 packages/mini-core/tests/pickup.test.mjs 覆盖实际新query、>2000无关不影响、失败/晚响应隔离；原客户集成与选择/核销测试通过。相关测试: node apps/api/tests/pickup-runner.cjs; mini-core test; Web test; API tsc（只执行tsc，禁止prisma generate），Web build/双mini H5+mp构建如改组件。
API源码变更需要编译后root精确重启3000，执行 pnpm --filter @restaurant/api exec tsc -p tsconfig.json；不得调用API build的prisma generate，除非root先停API明确许可。无需schema迁移。

## 输出
更新docs/tasks/pickup-ui-report.md追加完整修复报告：RED/GREEN命令输出、文件、API合约、测试/编译结果、自查、限制、提交。显式暂存自己的文件，保留root未提交及两个旧reviewdiff。提交Git身份Codex/codex@local.invalid。返回DONE状态、提交、短测试汇总。新实现完成后root会独立复审并真实页面验收。
