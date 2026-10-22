# Task3现金冲突核对迟到响应修复

基线4161492bd3352d4d0105adf4debb41a10abb1f5b。原任务.superpowers/sdd/cash-shifts-mini-brief.md，报告docs/tasks/cash-shifts-mini-report.md，原审查包output/cash-shifts-mini-review-4a6917a-4161492.diff。原Task3实现已提交，独立cash_shifts_mini_review结论Spec issues / Needs fixes，尚未执行源跨端业务写。

## Important与实际路径

merchant.js cash() 的STATE_CONFLICT分支约556行：POST冲突后await GET /orders/:submitted.orderId，返回后直接order.value=actual、sheet/tab写回，并清cash-attempt，没有重新验证身份和门店。独立reviewer使用隔离fixture真实复现：持久unknown现金→POST STATE_CONFLICT→GET等待期间session-expired清会话→迟到GET成功，得到user:null、orderAfterExpiry:o1、tabAfterExpiry:orders、originalRecordRetained:false。

相邻SHIFT_REQUIRED分支已有作用域校验，STATE_CONFLICT遗漏。root已实际读取对应代码，确认风险成立。必须在GET后、任何状态/存储变更前校验原身份/门店及返回订单id/storeId；无效或不完整事实不能删除原恢复记录、发布他人/别店订单、改路由或宣称确认成功。继续遵守原现金/退款/草稿/交班OR锁，不能以本修复清其他pending。冻结原请求key/body，不新增现金。

## 实施与验证

你是唯一实现者，只修商户mini现金恢复及必要隔离行为测试，追加原报告，不改API/shared/Web/顾客源码，不做无关重构。先写聚焦RED（真实useMerchant/uni fixture，不源码正则）：GET挂起时真实session-expired、门店作用域变化；响应wrong id/wrong store不能清记录。记录失效前后原持久现金和shift记录保持，原订单不迟到发布。还须证明正常同作用域原收款/关闭单冲突仍正确恢复，其他金融锁不丢。

执行systematic-debugging、receiving-code-review、TDD、verification-before-completion；聚焦RED→GREEN，再一次受影响现金/交班恢复回归、商户H5/mp-weixin构建、diff检查。不重跑无关已通过suite。保留报告中首轮与最终复验范围区别，不把隔离行为/构建当源UI或微信真机验收。

源浏览器/API/SQL/业务与服务由root独占，禁止源请求、generate/迁移/seed/reset/停服务，不派子代理。root刚因旧缓存精确重启商户5175开发服务，session53124，API3000/Web5173/customer5174保留；不要操作。源当前20订单/13现金34926/4退款5383，W班已关闭/W单已完成，样品库存0禁止回填。

明确提交本人文件和报告，Codex/codex@local.invalid，不暂存两份旧catalog diff或root文档。最终返回状态、SHA、一行测试及报告路径；修复后由独立reviewer复审。
