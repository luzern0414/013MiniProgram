# Task2 实际恢复后的正式订单显示修复

基线4ba9586c73f6db2b3075174ba4e7be4fdb54dc95。先读原Task2 brief、原报告、D:/Codes/开发规范.txt及debug/TDD/verification技能。不派子代理。

root真实验收通过A保存/刷新/慢取取消/两员工409，B创建/更新/取消已提交丢回执及离线GET保留。当前真实C草稿 cmvgwpsuu000h3mds7ibwcsp2：OWNER原数量1/报价3080的/orders网络在发送前断开，保留未知转单；CLERK将C改2份后真实报价6160，并用授权API转出唯一UNPAID订单 cmvgwqvkj000r3mdsrgmgpokc（DINE_IN01桌），然后OWNER点击读取原操作结果。真实order GET成功，正确释放旧quote/submittedFen、输入61.60可编辑，恢复期间现金请求0；但 .cart-panel 仍显示旧cart的1份/30.80，mutation.error旧NETWORK也仍展示。已核查根因：recoverDraft只apply financial event，没有将正式订单行展示与旧编辑袋分开，也没有清旧mutation错误。不能声称恢复成功同时显示原本地选择为正式订单内容。

修复要求：形成正式order后，面板对收银员展示真实order.lines的商品/规格/属性/加料/数量/价格快照及真实服务上下文（可用明确只读订单明细，保留原本地cart作为未知请求审计线索，不能重新计价覆盖历史）；不得显示旧编辑袋像当前订单明细。避免复制完整金融状态机，沿现有组件结构最小改动。真实成功核对绑定订单后清除陈旧NETWORK错误，失败/未核对完成不能清锁或假成功；原未知现金同单重读仍保留冻结额及key；真实订单现金金额仍实际order为准。on restore/refresh已有order也按同一只读事实展示。

补真实行为RED→GREEN，优先沿已有actual Cashier SFC setup测试/实际调用桥接测试；对显示使用真正render的行为断言或实际可测派生数据并确保template接线，禁止源码字符串断言。至少旧cart1/3080→order.lines2/6160显示2/6160、真实旧属性快照、恢复成功清旧NETWORK/失败保留、旧未知金融保护。

只必要Web/shared/types/tests和追加 docs/tasks/cashier-drafts-web-report.md；不得源写/收现金/退款、停服务、generate、迁移、升级依赖；不碰root文档/ledger/brief及两个catalog diff。root当前待付订单付款时限原16:38:43Z+15min，若自然关闭也不改时间或重开，不为赶付款删改事实。最终Web suite/typecheck/build一次；shared若改才共享suite。报告真实RED/GREEN命令输出，Codex身份提交，返回DONE+commit+一行测试及限制。复审后root再真实页面与SQL验收。
