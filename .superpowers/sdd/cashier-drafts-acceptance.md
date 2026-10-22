# 挂单/取单实际验收执行清单

本清单由root执行；逐步结果以docs/acceptance/2026-10-20-cashier-drafts.md为准。Task1已审查、011已部署；Task2缺陷修复独立Approved且真实Web验收收尾，Task3待实施。源库业务只能真实页面/API写，SQL只读。原16订单/10现金24283分/4退款5383分/净18900、公有4订单必须保留；当前新增C已收款完成及D取消订单，总18订单，不能把原基线当当前总数。未知写入不能靠清存储解除。源备份及恢复库全部保留。

## 已知真实资源与基线

- API3000 session75442/PID29008；Web5173 PID21632；顾客5174 session5991/PID33580；商户5175 session33803/PID31280。重启前重查可执行路径/命令和端口，不凭旧PID停止。
- Web OWNER tab0、顾客tab1、商户OWNER tab2、Web CLERK tab3、另一Web OWNER tab4。令牌只在page.evaluate内部读取，不打印、不写入证据。
- 菌菇饭商品 `cmvgjl8io00093mjk1nf64hmm`，小份SKU `cmvgjl8io000a3mjkrs3u2cs6` 可售6/预占0，大份SKU `60798aac-99ba-45fd-bb0e-540b4354d0db` 可售4/0；少辣属性 `d2d60349-2619-4c38-bb2b-de6b1860949d`，卤蛋 `56ad4df0-374d-422c-bb22-cffb77442f41` 可售2/0。所有实际动作前重读，不把此时点库存当永久值。
- 01号桌 `EXPERIENCE-A-1`；预约政策enabled/revision3、上海时区，slot实际日期需要重新读取，不能硬编码“明天”。选择失效预约须保留原ID并提示，不改即时。
- readonly snapshot脚本 `output/playwright/cashier-drafts-business-snapshot.mjs <label>`、无业务变化断言 `cashier-drafts-assert-draft-only.mjs <before> <after>`。证据均拒绝覆盖。resumed快照已经核对重启前后十张关键业务表原行hash完全一致，草稿0、审计0；正式保存前再抓fresh基线。
- 本轮执行可能跨上海午夜：overview按实际上海业务日统计，午夜后旧日24283/5383分不会出现在新日汇总。用源库凭证总额证明旧数据保留，用凭证各自发生日期核对当日展示，不能为保持昨日数字修改时间或伪造每日统计。预约日期、取餐号也按实际服务日核对，不按号码字符串跨日期合并。

## Task2 Web审查通过后

实际断点（2026-10-21）：Task2范围完成。A cmvgw9zrv00033mdsffvhlhee DRAFTrev1，小份/少辣/卤蛋/堂食01桌，quote2180，保留Task3跨端使用。B CANCELLEDrev2。C CONVERTEDrev2，订单cmvgwqvkj000r3mdsrgmgpokc COMPLETED/PAID，6160/7000/840。D CONVERTEDrev1，订单cmvgx2cr100173mdsvxmmzj06 CANCELLED/CLOSED，无现金，预占释放。配置少辣已从临时停用恢复，revision11/enabled=true。最终18订单/11现金30443/4退款5383/public4/session10/草稿4审计10；证据cashier-drafts-web-final-preservation.json。Web旧标签3仍可能保留C未付快照，实际刷新GET可核对完成，不能再收款。

Task2独立审查、真实保存/刷新/非空袋替换与慢读取取消、双员工409、create/update/cancel unknown、beforeunload、离线GET、转单丢回执同key恢复、明确现金履约、失效选项保留与恢复、390px/14px/焦点/reduced-motion均已记录。存储损坏/失败及dispose/锁边界按任务报告隔离测试，不声称源浏览器全部重演。截图已实际查看；REQ079/080待Task3闭环再评定。
## Task3独立审查后跨设备闭环

- [ ] H5商户新增收银入口可发现，独立选菜/属性/加料/堂食或自取/预约均读当前API，不将已有订单现金入口伪装成独立收银。
- [ ] Web A保存→H5取单恢复→H5编辑保存→Web旧版本409保留输入→重读新版本。非空袋替换确认两端一致，刷新和重登能发现服务端草稿。
- [ ] H5或Web一次转正式订单，另一端看到CONVERTED及同orderId；库存/加料/HELD/Q号精确一次变化，原key恢复无重复。原13及退款新增3笔旧订单快照不改。
- [ ] 手机已转订单明确收现金→服务端原金额/实收/找零→完成履约，顾客仅能访问本人订单，无法列出员工草稿。
- [ ] 至少实际一次慢写与已提交丢回执、真实离线恢复、会话401及重新登录恢复；原收款/退款/取餐/草稿busy OR合并，不相互解锁。实际双员工竞争不足时明确用Task1隔离夹具证明，不写“真机竞争通过”。
- [ ] Web及双mini H5/mp-weixin五构建和共享/相关行为测试有最终报告；uni共享缓存若旧，核对HTTP实际源码后root精确重启对应H5，不能更新全部依赖或重置源库。
- [ ] root最终只读SQL、真实页面刷新/重登、请求/响应/订单ID/草稿ID/版本/审计/统计及异常记录进入docs/acceptance/2026-10-20-cashier-drafts.md。

完成以上才核对REQ079/080是否verified_local；REQ015其余收银功能、REQ090交班、微信真机/支付和生产仍单独推进，不标全goal完成。
