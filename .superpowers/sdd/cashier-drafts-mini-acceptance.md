# Task3 root真实跨端验收准备

这是待执行清单，不能当作验收结果。实施基线4970b52；Task3单实现者cashier_drafts_mini，只在独立Approved后源库写。API/服务控制归root，源SQL只读，历史备份/恢复库不动；不要重复Task1/Task2已完成事项。

## 当前真实基线

Task2最终快照output/playwright/cashier-drafts-web-task2-final.json与逐行断言web-final-preservation.json：18订单/11现金30443分/4退款5383分/public4订单/development10会话，4草稿10审计。A cmvgw9zrv00033mdsffvhlhee DRAFTrev1，Web tab0已读取同版并quote2180；B CANCELLEDrev2，C CONVERTEDrev2订单COMPLETED/PAID，D CONVERTEDrev1订单CANCELLED/CLOSED，不复活或重新收退款。正式验收前重新抓只读快照，数字只是此时点，不能倒写数据保持基线。

A原小份SKU cmvgjl8io000a3mjkrs3u2cs6、少辣 d2d60349-2619-4c38-bb2b-de6b1860949d、卤蛋56ad4df0-374d-422c-bb22-cffb77442f41、DINE_IN桌码EXPERIENCE-A-1、note另一有效店员保存的新版本。菌菇饭配置revision11，少辣已恢复enabled；小份可售6/reserved0、卤蛋可售2/0。不要在源SQL修改库存或时间。

## 审查后步骤

- [ ] 核对实际H5提供最新shared导出和新收银组件；如果uni缓存旧源码，root先查对应端口/进程命令，仅重启自有merchant H5，不动DB/API及另一小程序。五标签Date必须真实流逝，与host近似，不沿用历史固定clock。
- [ ] 现有商户OWNER tab2启动新收银入口，确认无待核对旧现金/退款锁被绕过。读取当前草稿列表及A，恢复原选择/名称/模式/桌码/note，图片/估价标识准确；响应和SQL匹配。
- [ ] H5将A数量改2、note改可识别跨端文字并保存；按实际结果记新revision。Web tab0仍旧rev1，修改自己的note后保存得到409，输入保留，远端版本可核对；明确重载后才替换。H5刷新/重新登录可发现A，原选择不丢。挂单阶段业务十表hash应保持，只有草稿/审计及真实登录会话变化。
- [ ] 先做非空袋取单取消、明确替换与慢读取取消/迟到响应检查。不要在未知写期间清存储或另开同身份绕过锁；失败保留requestId。
- [ ] 真实H5保存并核价，以服务端当前合计为准（若配置未变，2×2180=4360）；检查原选项、数量、堂食桌台；不提前假定已经成交。一次转换绑定唯一orderId，恢复原key只该单，无自动现金。若实施分开下单和现金，必须明确两次动作。
- [ ] 另一Web端读取CONVERTED与同一真实订单、真实2件/金额，不能重建或显示旧购物袋。H5原订单现金入口明确输入实收（可用50.00，实际找零按当前服务端金额），一次收款，履约完成。顾客不能读取非本人订单或草稿。
- [ ] 只读SQL核对A唯一转换、草稿revision/审计、SKU及加料恰2份变动、现金恰1笔、堂食不消耗预约/取餐号、原18订单及原收退款按有意履约变化精确区分。不要将历史付款状态合法变化误说成全部业务原行hash一致。
- [ ] H5单独新E草稿慢保存→真实提交后丢回执→刷新待核对入口→离线GET失败继续锁→明确原key/原body恢复同ID，审计不重复；不用多次创建来规避CLI回执超时。取回后明确取消E或保留用途，记录实际状态，不删记录。
- [ ] H5会话401需保留原unknown、重登后原身份恢复，不在证据中记录token/密码；跨店/顾客/撤权与两员工转换竞争已有隔离证据者清晰标注，源实际未执行不能写成真机并发通过。
- [ ] 截图实际查看，390px、>=14px、reduced-motion、替换/取消确认、页面滚动和按钮可达；H5不是微信开发者工具或真机。五构建与suite沿最终实现报告，必要更改后只重跑受影响范围。

完成后更新docs/acceptance/2026-10-20-cashier-drafts.md、README/config、data/requirements/features.json及progress，按真实全项判断REQ079/080 verified_local；原90目标继续。班次设计/计划已准备在2026-10-21-cash-shifts文件，未派发也未实现，不在本Task3验收期间改金融规则。
