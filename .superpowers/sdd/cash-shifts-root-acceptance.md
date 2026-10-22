# 交班 root 待执行验收

本文件包含准备清单与执行进度。用户授权先本地功能，无微信AppID/支付/域名/服务器。API/012迁移与Web真实验收已完成；以docs/acceptance/2026-10-21-cash-shifts.md实际记录为准，下面原计划不作完成声明。

## 依赖与门槛

- 挂单Task3最终显示修复、独立审查及源恢复复验收尾后才派发API，同一时刻一个实现者。
- API需要generate时先核对3000监听PID及完整进程命令，只停本项目API；运行中的旧前端可保留但不要发送金融写。源SQL只读，正式写通过UI/API。
- 源迁移前先独立Approved；使用output/playwright/cash-shifts-approved-preservation.mjs before抓审查后的fresh基线，再新备份并实际恢复；cash-shifts-approved-restore-preservation.mjs <restore名>比较非Session旧列/原时间；只应用下一012，再运行approved-preservation.mjs after。两脚本已node --check但未执行。预实施cash-shifts-migration-before.json及backup_29a745536c55d7075a95870b5549bcdc不能代替这一关卡；不删除旧备份/恢复库。
- 保留全部旧CashPayment/CashRefund行；新shiftId必须null，历史凭证仍能原key返回且无活动班限制。源快照数字在停机时重新抓，不把当前19订单/12现金34803/4退款5383写成未来固定断言。

## 审查后真实 UI/SQL

- Web店主活动班为空，首次新收/退409 SHIFT_REQUIRED不得形成假unknown导航死锁；原实收/退款输入保留，明确开班再返回原单操作。
- Web店主开A班，记录期初、操作者、版本、审计；CLERK只能读，顾客/跨店拒绝。
- 新建可识别独立验收订单，仅此单用于跨班退款。mini明确收款，核对应有仅加amount，不加tendered也不重复扣找零。Web重读正确版本及汇总。
- 店主另一设备以旧revision关班409保留实点/原因，明确重读后才新确认；正确关班保存快照，历史单后续退款不改A快照。
- mini店主开B班，对上述独立验收单明确部分退款；B只记本次退款、可以出现负净额/负应有，原销售仍A。非0差额必填原因，实点为0合法。
- 源Web和mini至少一次真实提交后丢回执；刷新可发现原pending，离线GET/401保持，显式原key/body恢复同ID，真实监听无自动下一班/收退款。不靠清存储或另身份绕过锁。
- 关闭/新增金融写竞争以真实两端或独立随机DB夹具准确标范围，不能用UI单线程演示冒充并发验证。
- SQL检查旧原记录、旧shiftId null；所有新收退款唯一归属、revision及审计符合实际，不将合法新流水变化当成迁移破坏；关闭快照不可变、无闭班迟到流水。
- 迁移健康后、首笔UI写前运行output/playwright/cash-shifts-business-snapshot.mjs ui-before；后续按唯一label抓阶段快照，拒覆盖。该脚本已node --check，仅准备，未连接源库；使用READ ONLY一致性事务，保存原业务行/班次/审计及真实合计，班次原key/hash排除。旧行保留和允许的验收单变化另行按实际ID断言，不能只看总数。
- 截图实际查看、390px无横向溢出、字号>=14px、reduced-motion、可达操作和键盘；运行记录的suite与五构建按实际变更范围不盲重复。
- 更新README/config/requirements/acceptance/progress；REQ090仍需其余渠道/应收，不将现金子集当全部verified_local。90项目标继续active。

## 分阶段最小业务路径（未执行）

Task2只在独立Approved、源迁移和健康后执行。先抓ui-before，选择真实仍可售商品创建带“交班Web验收”备注的独立订单，记录服务端订单ID和准确金额，不使用已有已付单。无班首次现金明确SHIFT_REQUIRED，核对页面保留订单/实收但允许导航开班；请求若仍unknown先核对原凭证，不以清存储绕过。开独立W班测试提交成功后丢回执、离线读取和刷新发现，再恢复原key/body，记录唯一ID。回原订单明确收一次现金，以服务端金额/实收/找零核对应有；先前读到revision0的另一页面关闭应409且保留输入，明确重读后关W班并核对固定快照。完成新单履约，抓web-final。各次工具超时先GET核对，不能补发另一key制造重复交易。

Task3独立Approved后先抓mini-before，使用另一个“交班跨端验收”新订单；Web开A班→mini明确现金→Web刷新→关闭A→mini读取A已关闭→mini开B→只对本次新验收订单部分退款。B期初0可以真实出现负应有，实点0与非零原因按实际差异填写。关B后A快照仍完全一致；新单按真实业务完成，确认所有验收pending已核对、无未付单和活动遗留班，再抓mini-final及逐行旧记录保留。该路径只说明拟验证范围，不预写任何成功结论或固定测试金额。

## 2026-10-21接续状态

- Task1 1d873cf独立Approved，012源迁移/新备份实际恢复/旧45表500行原列时间保护已完成，不重复迁移。
- Task2 f4bbb69/c5e0108独立复审Approved，root Web验收完成，文档提交4a6917a。W班cmvh2klvc00033m1carw9wpyu CLOSED revision2，期初100/收123/退0/应有及实点223/差0；W单cmvh2mq7s00093m1cqaersdss COMPLETED/PAID，不得重付或退款。旧19订单原记录保护通过，最终20订单/13现金34926/4退款5383/public4/会话10。样品SKU已售完0，不回填。
- Task3唯一实现者cash_shifts_mini已于4a6917ac8bba3813e13846016fa0d6eb7485729c派发，brief.superpowers/sdd/cash-shifts-mini-brief.md，报告docs/tasks/cash-shifts-mini-report.md。实现后须独立审查再源UI写。
- 后续选择真实仍可售商品，最多一笔独立新订单，不用旧W或历史A退钱。计划Web开A期初0→mini收新单（以服务端实际报价为准）→完成履约→Web关A并保存快照→mini开B期初0（真实提交丢回执、刷新/离线/真实撤销原会话后重登恢复原key/body）→只退本轮新单部分款→B负应有、实点0与真实验收差额原因→关B，A固定快照完全不变。若工具超时先读订单/班次事实，禁止重复开/收/退。
- mini真实401须通过原session的真实/auth/logout撤销，再触发GET401；不能仅伪造401响应或覆盖token。会话数量变化准确记录，旧业务仍需逐行保护。
- 新订单库存合法消耗，不回填；先抓mini-before，再抓mini-final，按自然键/ID比较旧记录。财务事实排除key/hash输出。完成后按REQ087实际范围复核，REQ090各渠道/应收仍不完整。

2026-10-21 final: Task3 fix43c7495 independent Approved; actual crossclient A/B flow and readonly preservation COMPLETE, see acceptance latest section. Do not replay old pending instructions above. A cmvh3vegn000s3m1cdydsam9f CLOSED1880, B cmvh48dpf001n3m1c6znqtj5q CLOSEDexpected-100/count0/diff100, only neworder cmvh41im800123m1co0jfdn16 COMPLETED/PAID/PARTIAL100. Final21orders/14cash36806/5refund5483/public4/session10/3closed; no financialpending. No refill smallSKU3 or sample0. Next addressbook planning; full90 goal active.
