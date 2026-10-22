# 现金退款真实验收发现项修复

前提：Task2 a837194已独立审查Spec compliant/Approved。root实际UI已完成A部分0.01/剩余2179退款和B已完成3080退款，未知原key重放/SQL通过。这是本任务验收修复，不新增交易能力。

1. `packages/mini-core/src/cash-refunds.mjs` 的load成功后未清除此前网络错误。root真实先中断GET、后恢复GET，最新明细和unknown提示已返回，但NETWORK旧错误仍显示。先用`packages/mini-core/tests/cash-refunds.test.mjs`行为测试重现RED；成功的当前上下文GET应清旧error，unknown原attempt/key/blocked仍保留、notice仍要求原请求核对；失败GET继续保留原attempt/锁/错误。不得顺手凭GET判定退款成功；confirmed/rejected原语义保持。必要时开始新load时清旧提示但不能伪造成功；异步上下文不变。
2. `apps/merchant-mini/src/pages/index/index.vue` 在订单详情原有“现金收款凭证”三行，新增CashReceipt又重复展示同一原入账/实收/找零。实际A全退显示两块。按开发规范“删除重复描述/统一组件”，移除旧重复展示，保留唯一完整CashReceipt（含原三金额、退款汇总、明细），放在合理的应收/履约操作位置。不要移除待现金收款或其恢复流程，不写死数据，不改现金单状态/按钮权限。顾客/Web若未重复不用改。

保持全部主brief约束`.superpowers/sdd/cash-refunds-ui-brief.md`：真实API/整数分/14px/reduced-motion/未知保存/多busy合并。不得改后端/迁移/生成客户端；不得源库写、造单、退款、启停服务、改变依赖或lock。root将继续只读及拒绝接口验收，不与实现者写文件冲突。

运行新增测试RED→GREEN、完整cash-refunds.test.mjs，若共享会话契约变动再选择相关行为测试；merchant-mini双H5/mp-weixin构建、diffcheck。不要重复运行已通过且不受本修复影响的Web/customer全构建。报告追加`docs/tasks/cash-refunds-ui-report.md`：准确RED/GREEN、命令输出、范围、自查、commit。只显式暂存本人文件及report，两个旧catalog reviewdiff永不暂存。最终DONE + commits + 一行验证。独立复审由root安排。
