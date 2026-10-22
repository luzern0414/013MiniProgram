# 挂单与取单验收记录

日期2026-10-20。现金退款已完成本地真实验收；本模块Task1持久化草稿与原子转单API已通过独立审查及源库迁移关卡。以下保留各阶段当时状态，最新部署结果见末尾。Web和商户mini挂取单尚未验收，REQ-079/080保持planned，不把接口通过等同完整业务验证。

依据[计划](../superpowers/plans/2026-10-20-cashier-drafts.md)、[调研](../research/2026-10-20-cashier-drafts-shifts.md)。数据基线必须在本模块实际迁移前新抓，不能复用退款前13订单/7现金时点。

## 实施维护窗口

Task1 实现者已报告隔离随机 schema 的真实 HTTP RED：部署001–010时新挂单端点404，断言预期201失败，受 CREATE/OID/owner 保护清理。root 重新核对自有 API PID28108 的 node 可执行路径及 dist/src/main.js 命令后精确停止，确认3000释放，明确授权本任务 Prisma generate。未授权源库011迁移、seed/reset或重启；源库仍001–010，维护窗口内不做页面业务验收。最终 GREEN、独立审查和新备份真实恢复尚待完成，不能据此标记业务通过。

Task2 Web 与 Task3 商户mini的单任务 brief 已准备，按依赖顺序派发；尚未开始实现，不能视为跨设备挂单已可用。

## Task1 隔离交付，独立审查中

实现 f09cc45、报告 df6abef。报告记录源码HTTP专项11/11、编译HTTP专项11/11及原现金退款10/10、预约7/7、规格10/10、领域与HTTP10/10，tsc及noEmit均退出0；原Prisma配置弃用提示与现金故障注入的预期脱敏日志均如实记录。测试不替代源库迁移或前端验收。独立 cashier_drafts_api_review 已收到原brief、完整base48a1c21至df6abef的diff包与报告，等待结论。

测试中实际复现两员工转单得到201/500：原始行锁的序列化冲突SQLSTATE40001被Prisma包装P2010。实现仅在该行锁函数将40001/40P01归一为原Db.atomic可识别的可重试冲突，重试完整事务及权限检查。源码和编译最终竞争均201/409，核对精确一笔订单及一次SKU/加料/预约/序号变化；实际直接观察的是40001，未声称人为制造过40P01死锁。此实现仍需独立审查。

## 数据保护和接口

- [x] 隔离真实HTTP RED/GREEN、迁移旧列原时间保留、身份隔离与CREATE碰撞守卫通过，独立API审查Approved。
- [x] 新备份真实恢复、源库原列/原时间基线、仅新增量迁移及保留比对通过，API真实health数据库连接。
- [ ] 保存/编辑/取消草稿前后库存、加料、容量、序号、订单/现金/退款统计均无变化，仅草稿及审计按事实新增。
- [ ] 创建同key重放一次，异载荷409；修改和取消按revision，冲突保留输入，重复取消不加审计。

## 两商户实际流程

- [ ] Web实际选SKU/必选属性/加料/数量及堂食或预约、备注，保存挂单，刷新仍在。
- [ ] 商户H5查询同店草稿并取单，完整恢复原选择；非空袋替换必须确认，不能悄悄清掉当前输入。
- [ ] H5编辑并保存，Web旧版本提交409，原输入保留，重新读取看到H5版本。
- [ ] 旧草稿价格/启用/库存/属性/预约失效后重新报价正确拒绝并保留选择，不自动替换默认选项或即时自取。
- [ ] 已保存当前版本重新报价→转正式订单一次→明确确认现金→正常履约；草稿绑定的orderId与页面/SQL一致。
- [ ] 已转换草稿只读并可进入真实订单；订单取消/到期/退款后草稿不复活为可重复转换状态。

## 异常及并发

- [ ] 慢写锁导航/切店/退出/返回，与退款/取餐/收款锁合并；任一busy=false不解另一个锁。
- [ ] 创建回执丢失保留原key，转换回执丢失保留原quoteId/orderKey，真实读取/原请求恢复不新建重复单。
- [ ] 离线、读取失败、会话过期不伪造已保存/已转单；持久恢复入口可发现，损坏存储阻止新写。
- [ ] 账号/门店隔离，组件卸载后旧响应不覆盖新上下文；顾客、跨店、跨品牌、撤权拒绝，成功幂等返回前重验权限。
- [ ] 两个有效员工/两个报价竞争同草稿，仅一个正式订单、一次库存/容量/序号变动；真实身份条件不足时明确区分隔离夹具范围。
- [ ] Web及双mini H5/mp-weixin构建、相关测试和独立UI审查通过；真实页面、请求、SQL及刷新/重登持久化证据完整。

完成时记录实际草稿、订单、审计和基线，不记录令牌或密钥。只有满足上述闭环才更新台账verified_local；不代表挂账、交班、微信真机或生产通过。

## Task2 首轮审查与真实验收前基线

Task2实现 `ac11944`、报告 `548d8ba`，共享119/Web26行为测试及Web类型检查/构建的执行证据见任务报告。独立审查结论 Needs fixes：慢速取单的取消不能阻止迟到替换；读取其他员工转换的订单后，旧报价和冻结实收仍可能影响新订单收款。两项均为Important，已派发单独修复，尚未复审，不提前执行源库挂单/转单交易验收。

2026-10-21修复前只读快照 `cashier-drafts-web-review-fix-before.json`：16订单、10现金24283分、4退款5383分、public4订单、9会话；草稿0/草稿审计0。API health200/database connected（requestId `fd2c6a41-7d51-4bcf-80ea-1921e778bf50`），草稿列表200/total0（`d5387cac-bbb6-4d6d-8937-961dd7deaa01`）；新服务日overview仍0，旧C凭证原123/200/77及123退款保留（`2758d62d-714c-4af6-a3b0-fa085c5c492b`）。这是可用性及保留证明，不能代替挂单界面验收。用户再次确认先完成本地功能，AppID、支付、域名与服务器仍未准备。

### Task2 已执行页面步骤及新增缺陷

两项修复 `ad094c4` 经原独立审查者复审，Spec compliant / Approved，无未解Critical/Important/Minor。报告包含focused43/Web36/shared120、typecheck/build及真实RED/GREEN。root随后实际页面执行，尚未完成整个Task2：

- 原tab4会话失效，使用真实“进入体验工作台”登录201后重新建立OWNER会话；未打印令牌。新验收基线 `cashier-drafts-web-before.json` 为10会话，其余原16订单/10现金24283/4退款5383/public4、草稿0/审计0不变。五标签实际时钟与host差小于10ms。
- tab0从原C全退凭证明确开始下一单，选择菌菇饭小份、少辣、卤蛋、数量1、堂食01号桌。真实保存“挂单验收A”，POST201/requestId `e65aa882-60a2-48e3-bc9b-bc49d85813e7`，id `cmvgw9zrv00033mdsffvhlhee`，DRAFT/revision0/orderId null，时间 `2026-10-20T16:25:35.322Z`。后续GET成功，页面显示真实第0版/10月21日00:25和“挂单已保存并重新读取”。
- 原选择SKU `cmvgjl8io000a3mjkrs3u2cs6`、加料 `56ad4df0-374d-422c-bb22-cffb77442f41`、少辣 `d2d60349-2619-4c38-bb2b-de6b1860949d`、桌码 `EXPERIENCE-A-1`、备注“挂单验收A：少辣卤蛋堂食”均与API及只读SQL一致。保存后 `cashier-drafts-web-after-save-a.json` 只有1草稿/1审计；Order/Event、现金/退款、SKU/Modifier、政策/时段/预约/日序号10张表全部原行hash相同。断言证据 `cashier-drafts-assert-web-before-to-web-after-save-a.json` 的businessUnchanged为true。
- 刷新并进入收银/挂单列表仍可发现A，购物袋原小份/少辣/卤蛋/桌台/备注保留。非空袋改备注后取A，明确取消保留本地输入，再明确替换才恢复服务端原备注，未写业务数据。
- 真正拦截A的详情GET，先由route.fetch获取真实回执、延迟交给页面；取单开始后点击取消，放行原响应，原本地备注“慢取单取消：原输入继续保留”、原购物袋及第0版仍保持，弹窗关闭。不是只用内存测试证明慢取单取消。
- 双员工CAS步骤首次进入CLERK空收银时，组件setup报TypeError并空白，未发出修改草稿请求。源码已定位：`restored?.quote?.cashierDraft?.id === drafts.remote?.id` 在无记录时两边undefined相等，随后读null.quote。已派发独立修复及行为回归；Task2仍在验收中，不能宣称冲突或Task3跨端已通过。

验收脚本早期因页面过渡/HMR重置和原生select的label匹配产生定位器超时，均未写业务；改为等待实际组件、按DOM真实option值选择后才完成上述保存。并发步骤的空白则有明确setup堆栈，作为真实缺陷修复，不归为工具超时或靠插入假恢复数据绕过。

### 真实冲突、未知回执及恢复正式订单

空收银修复 `4ba9586` 独立复审Approved，无Critical/Important/Minor。root实际重载CLERK后进入收银成功，空袋0件、当前营业日时段正常显示。随后实际完成：

- CLERK取A第0版，改名“挂单验收A·店员更新”、备注“另一有效店员保存的新版本”，PUT200/revision1（`b25e0b60-ece7-4390-8ea7-d716376a66f6`）。OWNER旧版PUT409 DRAFT_CHANGED（`e1af03e5-89e4-4102-abc6-d8519259f141`），原本地备注不丢，页面展示远端版本/选择，明确点击重新载入后才替换。A仍DRAFT，留待商户mini跨设备验收。
- OWNER保存B真实POST201（`92ca4868-a985-41e8-9ceb-bff292eb23f8`）、id `cmvgwmcgm00093mdseluvk30o`后拦截回执。等待期间导航/切店/退出均disabled。页面保留create原key/载荷，beforeunload真实阻止刷新，接受提醒后刷新，启动时自动进入待核对收银。明确“恢复原挂单”201（`fa5ef421-96e3-4e87-9694-b4ea6d141f0d`）返回同id/原时间，后续真实GET成功才清记录。`web-b-unknown`与`web-b-recovered`均2草稿/3审计，无重复创建/审计；与web-before比较十表hash仍相同。
- B修改真实PUT200/revision1（`b882ba4a-f40d-4234-837f-431a05b63114`）后丢回执；“读取原操作结果”只GET、写请求0，原pending字符串仍保持。明确“保留输入，按最新版本保存”只解除核对锁，没有自动再次写入。B取消真实201/CANCELLED/revision2（`132de791-9aa1-4438-aff8-226fca62d5f9`）后丢回执；详情GET网络失败仍保留原pending和锁，恢复网络后GET核对仍需明确重新载入，整个读取恢复阶段写请求0。
- C真实保存 `cmvgwpsuu000h3mds7ibwcsp2`、1份鸡腿饭报价3080。OWNER下单请求发送前网络中断，pending保留原quoteId/key、submittedFen3080，现金请求0。CLERK将同草稿改2份并在页面保存并核价6160，再通过真实授权API转正式未付订单；该API验收脚本用错Fetch Response.status()导致回执读取异常，root没有重发创建，而是GET草稿及其绑定订单核对真实结果：唯一订单 `cmvgwqvkj000r3mdsrgmgpokc`、编号 `R179251432302610DD3BA0E7`、total6160、UNPAID、DINE_IN01桌；草稿CONVERTED/revision2。GET requestId `3ab91297-40ee-4722-9c03-3e53bc2fd983`、`b2995d20-115f-407d-aac9-731eb6521ab4`。
- OWNER读取原操作结果，真实绑定核对后旧quote/submittedFen解除，实际61.60建议实收可编辑，恢复现金请求0。发现仍显示旧购物袋1份30.80及mutation旧NETWORK错误，已派发单独显示修复，未继续收现金。不得以总额正确掩盖行明细错误；Task2验收仍未完成。

`web-c-recovered-unpaid`只读SQL为17订单、原10现金24283分、4退款5383分、3草稿/8草稿审计、10会话/public4。`cashier-drafts-c-preservation-v2.json`逐行对照全部原16订单/57事件/10现金/4退款及预约/加料原值均保留；唯一SKU变化为C真实鸡腿饭预占2，可售11→9、reserved0→2，其余字段一致。旧取餐序号未变（C为堂食）。只读断言脚本首次误把stock当物理总量、以及按id索引无id的政策行导致失败，已按现有服务真实可售stock语义和整行集合修正，未修改源数据。v2明确区分旧订单/资金保持与合法新预占，不将库存有意变化写成“全部旧行不变”。

## Task1 审查及011真实部署关卡

cashier_drafts_api_review 独立结论 Spec compliant / Approved，无Critical/Important。唯一Minor为既有现金退款故障测试仍输出预期API error，纳入整分支测试输出清理台账，不改变本任务批准。报告准确区分隔离测试、前端未验及源部署待办，root 已完成以下部署项：

1. API停机期间新抓原列/原时间基线：development/public共44张旧业务表437行，证据 `cashier-drafts-migration-before.json`，不复用010前的43表399行。
2. 全新备份 `backup_06f37d5e9bc0ef155b774f1d4ddcacbe`，SHA256 `bedb959731d16623f97e2bcb70f3feea3552da82c2b22d446b377207d1088b47`，真实恢复成功并保留 `restore_191e6b68ab83b025adafdfee71d190c9`。恢复流程撤销全部恢复schema共30会话，源会话不动。只读对照42张非Session旧表423行的全部原列及原时间完全一致；development源9/public源5会话，恢复后均0，因此会话时间不在恢复对照声明内。证据 `cashier-drafts-prerestore-original-columns.json`。
3. `pnpm local:migrate` 退出0，仅development应用 `202610200011_cashier_drafts`。after核对44表437行全部原列含时间保持一致，preserved:true；新增CashierDraft为空、草稿审计0。源development仍16订单/10现金24283分/4退款5383分/净18900分/9会话，public4订单；本次实际基线会话为9，覆盖此前退款验收记录的8会话时点。未reset/seed/删除旧备份或恢复库。证据 `cashier-drafts-migration-after.json`、`cashier-drafts-migrated.json`。
4. root fresh `pnpm --filter @restaurant/api exec tsc -p tsconfig.json` 退出0；`pnpm local:api:start` session75442、监听PID29008，health200且database=connected，requestId734dead3-40bb-4da0-bb4b-8141c31303e6。Prisma既有配置弃用提示继续保留整分支台账。
5. 从已有Web OWNER会话真实读取挂单列表200/total0（requestIdd7bc71ba-0b01-43db-9ac1-9c58a627e51f）；overview200仍paid24283/refund5383/net18900/orderCount16。旧C单仍CANCELLED/PAID/SUCCEEDED，原123/200/77及1笔123退款、净0不变，读取requestIdbedf684e-e9e5-48b9-af4e-50dae67c279a。没有为了接口冒烟新增草稿或交易。

以上只完成API及数据保护关卡；Task2/3与真实跨端页面验收继续，REQ-079/080尚不标verified_local。

源API恢复后的只读补验：`cashier-drafts-resumed.json` 与 migrated 快照比较，Order/Event、CashPayment/Refund、SKU/Modifier、预约政策/时段/记录/日序号十张关键表全部原行hash相同，订单/现金/退款数量和金额不变，草稿及审计仍0、会话9。证据 `cashier-drafts-assert-migrated-to-resumed.json`。已有顾客会话真实GET员工草稿403（requestIde5916869-a305-4d90-9528-9388c5bc8722）；已有CLERK本店GET200、另一店403（requestIda03f26ca-61a7-4d21-994e-136311c90e49、bd40be47-570c-4c1d-af9f-31c5efb9db3f）。未为权限测试修改源角色或创建新登录。

### 2026-10-21跨日及验收时钟恢复

首个跨日只读脚本发现浏览器Date仍固定在之前测试的2026-10-20T08:31:49.990Z，真实host已2026-10-20T16:02Z。该次返回中的浏览器日期不作为真实服务日证据；源API与数据库时间未被修改。root按systematic-debugging对比host/page，使用Playwright clock.setSystemTime(realNow)+resume恢复本项目五个标签，差值均小于10ms。20秒后再次读取，浏览器时间真实前进到16:03:04Z、上海日期2026-10-21，overview200显示新日paid/refund/net/orderCount均0（requestId137c2c9e-3351-410d-9444-079b48710769）。

只读SQL仍有10笔现金24283分、4笔退款5383分，全部实际发生于上海2026-10-20，因此新日0与旧凭证保留一致。恢复测试时钟前后十张关键业务表原行hash完全一致、草稿0/审计0、会话9；证据 `cash-refunds-after-drafts-midnight.json`、`cashier-drafts-real-clock-restored.json`、`cashier-drafts-assert-resumed-to-real-clock-restored.json`。未改变电脑系统时间、源业务日期、权限或库存；这只修正验收工具状态，尚不代表新挂单页面完成验收。

### Task2 真实Web验收收尾（2026-10-21）

显示修复160f19b独立复审Approved，无未解Critical/Important。实际刷新C后显示服务端2件/61.60元/×2/堂食01桌及原备注，不再展示旧袋1件/30.80元，旧NETWORK提示消失；截图cashier-drafts-c-formal-order.png已实际查看。明确输入70.00并确认现金：amount6160/tendered7000/change840，requestId a82c0f9d-de81-4a06-ab54-7a12f03dbdcf。随后真实订单页面接单→出餐→完成，分别201/requestId 66377f4a-d237-4a7a-85c3-d2f576876be5、e83a47f7-6252-4638-909c-2b4ffb660373、6778f236-88c2-4a19-aa9e-246be563a5e9，最终COMPLETED/PAID；无需退款。

另建D草稿cmvgx2cml00113mdswyit7qwc，鸡腿饭1份堂食，真实转单201后丢回执（fa3fcfba-317c-4512-9203-515bd3336c6a）；明确恢复原下单201（3504fc3b-678e-49d5-81d7-de2eee749245），真实请求监听确认与原pending完全相同key及body，返回同订单cmvgx2cr100173mdsvxmmzj06/编号R179251485850878585E9902。恢复现金请求0。随后真实授权API取消未付单并在订单UI核对，最终CANCELLED/CLOSED、无现金，库存预占释放；草稿保持CONVERTED/revision1，不能复活。另一标签的旧未付快照没有自动推送；重新加载实际GET后正确显示关闭，明确开始下一单才清本地袋，未清unknown存储。

通过实际规格配置界面将菌菇饭少辣短暂停用：配置9→10，PUT200/requestId 9a874cbc-1cae-414c-9903-0439fb38ca11。重新取A时原ID d2d60349-2619-4c38-bb2b-de6b1860949d、display少辣、卤蛋、小份、01桌及备注保持，显示“少辣（原选择）/所选口味已失效”，保存并核价disabled。随后同界面重新启用并保存，配置revision11；真实GET200/requestId 7c0de471-b055-4645-87c9-ef9d6bee9dc2确认enabled=true。刷新菜单、明确替换重取A后21.80元/原少辣与卤蛋均正常；真实草稿quote201/requestId dd61cf42-f781-449f-b8bd-8470c9e48852，total2180、A仍revision1，未转换。两次配置写是有意业务变化，不纳入草稿零变化断言。原取单脚本因标签已持正式订单找不到刷新按钮，以及后续脚本读错身份存储键超时/空值，均未写草稿；恢复脚本的校验GET首次漏/api/v1而404，PUT已成功，未重放PUT，用正确GET核对恢复事实。

截图cashier-drafts-a-restored-desktop.png、cashier-drafts-a-mobile.png、cashier-drafts-replace-mobile.png均实际查看。390×844下document.scrollWidth=390、可见挂单/购物袋最小字号14px；替换弹窗初始焦点及Tab循环均在弹窗，Escape取消保留袋；reduced-motion为true时列表transitionDuration=0s。内容较长需纵向滚动，未配置商品图片保留占位，未伪造素材。存储损坏/失败、dispose、多busy锁等边界以任务报告的真实controller和SFC隔离测试证据为准，不声称所有故障都在源浏览器逐项重演。

最终只读快照cashier-drafts-web-task2-final.json及逐行断言cashier-drafts-web-final-preservation.json：原16订单/57事件/10现金/4退款全部原行保持；新增2订单、7事件、1笔6160现金，无新退款；18订单/11现金30443分/4退款5383分，净25060分；public4订单、development10会话，4草稿/10审计。唯一SKU变化鸡腿饭可售11→9/reserved0，恰为C销售2份；其余SKU、加料、预约政策/时段/预约/取餐序号原行保持。A DRAFTrev1；B CANCELLEDrev2；C CONVERTEDrev2且唯一已完成订单；D CONVERTEDrev1且唯一已取消订单。Task2 Web范围验收收尾，Task3独立实施及跨端闭环待执行，REQ079/080仍不标verified_local，整体90项目标仍active。

补充浏览器隔离存储边界验收：cashier-drafts-browser-storage-boundary.cjs在真实Web页导入实际Vite提供的共享controller，使用独立故障storage，未改应用sessionStorage或uni记录。write抛出、write不落盘导致回读不一致、已存在空串、已存在null四种均create=false/DRAFT_STORAGE，请求调用0；后两种blocked/corrupt=true。前两种尚未发送因此没有未知结果锁，保留当前输入供存储恢复后重试；没有伪造服务器成功或用清记录绕过unknown。移除回读失败等其余边界仍以任务报告的隔离行为测试为准。

2026-10-21补充呈现问题：复查已执行失效选择步骤的真实panel，hydrateDraft无法解析的内部unitPriceFen=0被Web无条件格式化成行价/整单预估¥0.00；虽然明确失效提示且核价禁用，仍会误示未知价格。已定位hydrateDraft fallback→Cashier行价及estimated模板，准备独立最小修复brief .superpowers/sdd/cashier-drafts-invalid-price-fix-brief.md，等当前mini实现提交后单实现者修复及独立审查。不会修改原选项或历史订单金额；跨端正式转换验收等此修复收尾。

### Task3实现、独立审查与真实只读取单

Task3实现8796b0d，报告移动23/23、shared143/143、Web51/51与五构建通过。独立review Needs fixes：recover('read')在其他员工已转换时更新真实order，旧local cart/quote仍在CashierPanel无条件呈现；隔离probe服务器2400/2件而旧cart1件/quote1200。root已派单独修复并要求实际Vue组件RED/GREEN，尚未审查通过，不进行源转换/收款。

root只读进入现有商户H5收银入口并GET列表/A：200/requestId327f8693-6218-40c5-9177-7b45b37a8be1，仍DRAFT/revision1，原小份/少辣/卤蛋/数量1/堂食01/note一致，页面预估21.80。初次用getByRole('button')在uni-button上超时，没有点击或写请求；改实际uni-button定位后入口可用，列表名称带版本所以exact原名等待未命中，真实列表GET已成功，随后按行定位完成取单。未伪造token/草稿/成功响应，没有保存、转换或收款。

cashier-drafts-mini-a-read-initial.png实际查看，390×844下宽390/scrollWidth390，计算字号min14；这是初始取单页面视觉，只读成功不能代替编辑冲突/丢回执/真实订单金额或金融验收。其后Web呈现修复734f640进入独立审查；真实业务验收继续等待mini显示修复和两端审查关卡。

### Web失效草稿价格修复的真实复验

734f640独立price review Approved，无Critical/Important/Minor。实际配置/取单复测：首轮因HMR后列表收起，脚本等不存在的draft-row超时，finally已通过真实UI恢复少辣，GET200确认revision13/enabled（90c4154c-c1e9-460c-a5d1-b35921a3864f），未重复写草稿或交易。原配置11→12停用→13启用是这轮失败前后明确配置写，不隐藏其发生。

修正脚本先展开真实挂单列表后，再UI停用少辣至revision14，PUT200/requestId be00a964-e673-4f62-9fb8-a0a14ef6c740；GET200/6c70fa27-33a0-4b73-8a1e-b3d323df8021确认disabled。取A保留原ID/display/少辣/卤蛋/小份/01桌，行价及预估合计两处均显示“待重新核价”，不再显示fallback0，保存并核价禁用。截图cashier-drafts-invalid-price-real.png已实际查看。

finally同UI恢复启用至revision15，PUT200/f068acf9-7dc9-4f22-97be-6c4a30b693ae，GET200/18f5f508-a1cb-47df-b9e6-284ca3231beb。刷新菜单并明确替换重新取A后行价/预估21.80，核价可用；A仍DRAFTrev1，未报价转单或收现金。只读web-price-final及assert-web-task2-final-to-web-price-final证明十张关键交易/库存/预约表hash均相同，18订单/11现金30443/4退款5383/草稿4审计10/会话10/public4保持。配置版本和配置审计是明确变化，不声称整库无变化。

### Task3真实跨端交易（2026-10-21）

显示修复5e58a2c独立复审Approved，spec及quality均通过，无Critical/Important。真实H5先执行非空购物袋取单取消，输入保持；明确替换后恢复服务端原备注；延迟真实GET回执时工作台/订单/商品/门店导航全部禁用，放行后原备注恢复。确认取单GET200/requestId88c1f559-5715-4e7b-8c18-fd3512d2bd14。

手机将A增加至2份，备注“手机跨端验收A：两份少辣卤蛋，堂食01”，PUT200/requestIdec8ece47-041b-4e34-80f1-034ce58d4c4e，revision2。电脑旧rev1提交返回409，冲突界面出现，原“电脑旧版验收：冲突时保留这段输入”保持；明确重新载入后替换成手机rev2。脚本末尾用document.querySelector选中隐藏textarea导致等待超时，随后按实际可访问输入读取确认成功，未重复提交。只读mini-before→mini-after-save-a十表全部hash相同，草稿4条不变，草稿审计10→11，18订单/11现金30443/4退款5383保持。

手机刷新后重新进入收银，从真实服务端列表取A恢复2份、小份/少辣/卤蛋/堂食01/原备注。初次在GET回执后立即读输入早于Vue应用状态而断言失败；随后实际读取正确，不重放保存。报价201/requestId3e0ec368-37d5-469f-b3d5-9199cd79bed8，配置revision15，2180×2=4360分。点击生成正式订单201/requestId78db874b-d488-40c8-922a-d4944f95d4fa，唯一订单cmvgyvec200243mdstj4t5f99，编号R1792517893201757668AB03，A为CONVERTED/revision3。手机显示服务端2份/43.60元/少辣/卤蛋/01桌并隐藏旧袋、估价与核价。电脑明确替换重取同A，显示同编号、2件、43.60元真实快照；没有收款请求。最初脚本误用弹窗按钮名超时，实际按钮为“替换当前购物袋”，纠正后完成读取，无额外写。

手机点击“查看订单与收款”，在订单详情现金入口输入50.00，确认弹窗后POST201/requestIdcac797be-b20c-458d-ab05-c80b36ace534：amount4360、tendered5000、change640。随后接单制作/标记备好/完成订单均201，requestId分别50dfab32-c7c2-4113-90e3-568808b1952f、2a77b7a4-443a-4c7f-b9f9-b1492c17d463、a75f9aa8-4fb3-4728-8167-6f62f896e8aa，最终COMPLETED/PAID。现金按钮在uni DOM保留格式化空白，初始精确正则未匹配而超时；改匹配空白后执行，未产生重复收款。

当前只读mini-a-completed：19订单/12现金34803分/4退款5383分，public4订单/源10会话，4草稿12审计。原行保护的逐项断言、手机未知写恢复、401及视觉复查仍待执行；本段不能作为Task3或REQ079/080全部完成的声明。微信开发者工具、真机与真实支付未验收，用户已明确先完成本地功能。

### Task3异常恢复、原行保护与窄屏复验

`cashier-drafts-mini-a-preservation.mjs`实际执行通过：原18订单、64事件、11现金、4退款的完整原行均保持，新增仅A的1订单/5事件/1笔4360现金。小份SKU6→4、卤蛋2→0，均reserved0且除库存/更新时间外原字段保持；其余SKU/加料不变，四张预约/取餐表hash不变。A唯一转换绑定同订单、CONVERTEDrev3；B/C/D原草稿全行保持。

真实截图发现正式订单长连续编号未断行，390px视口document.scrollWidth431；根因标题312px但scrollWidth392、wordBreak/overflowWrap均normal。c76280a最小局部断行修复经独立review Approved，既有render5/5及商户H5/mp-weixin双构建通过。实际重取A测量viewport390/scroll390、标题client312/scroll312、min14px，reduced-motion下列表animation=none。`cashier-drafts-mini-a-formal-wrap-fixed.png`及`cashier-drafts-mini-a-wrap-viewport.png`均实际查看，编号完整换行、原真实2份/43.60/桌台/备注保持，查看订单按钮可达。完整长页面截图中的固定底栏位于当前滚动位置，另用视口图核实真实标题及按钮没有被永久遮挡。

独立手机E名称“手机挂单验收E·恢复”：真实POST201/requestId26806536-4cc2-4e57-ac0c-2e74ef26594f提交后延迟再丢回执，门店与5个导航均禁用。唯一草稿cmvgz2i15002n3mdskh97v9xa/revision0；刷新触发beforeunload，初始脚本等待超时后选择正确tab2并接受确认，重新加载可发现原pending、名称及原key。明确恢复原挂单POST201/requestIdceae8b52-cfbb-4b06-bc06-65aede6e1e41，监听真实请求确认sameKey/sameBody为true、仅1次POST、返回同ID/rev0。没有通过清存储或另造key处理未知写。

E原备注改为“手机E：更新丢回执，离线与过期仍保留原输入”，真实PUT200/requestIdc5188dbe-08dd-45bc-92c9-f0c0578ea99f/rev1后丢回执；pending仍update/expectedRevision0/原输入。仅中断该GET网络，点击读取失败后原pending逐字相同，GET尝试1次。随后真实API注销该商户会话201/requestIde5b46766-2f78-42da-950d-bc06f2fbc000，再用原客户端读取得到真实401/requestId1bc9fd10-dd6b-47fe-baf1-7a4c83eb81b0，退回登录且pending逐字保持。由真实体验店主登录按钮重新建立原身份，GET200/requestId2f603bd6-0d6f-494a-8e2c-a8610ef3a1c2读取rev1后锁仍在；明确重新载入才清pending、恢复原备注和服务端名称，全程草稿写请求0。源角色/权限没有修改。

E最后通过UI明确取消201/requestIdd1c7c5ba-b2cc-42d1-8e61-5c47b80e8bd0，CANCELLEDrev2，无订单。`mini-a-completed→mini-e-completed`十表hash完全相同，5草稿/15审计，19订单/12现金34803/4退款5383/public4/会话10。恰新增E创建、更新、取消各1条审计，原创建重放没有增加草稿或审计。

恢复呈现后续：E刷新恢复创建成功时，购物袋价格30.80但名称仍“原商品/原规格”，明确reload远端后正确。根因adapter初始化pending时空catalog/display，菜单读取及replay后未重建显示字段；已交单独最小修复、隔离RED/GREEN及独立审查，再做源复验。原选择/金融事实正确不能代替显示验收，当前Task3仍未关闭。另记录Minor：开始下一单后旧“已读取正式订单”notice未清，交整分支审查triage。顾客/跨店403与转换竞争沿Task1真实权限及隔离数据库并发证据，不声称本轮微信真机竞争测试通过。

### Task3最终关卡与恢复显示复验

首个显示修复4ce91b8真实adapter RED/GREEN后共享152项通过，独立审查仍发现旧display内fallback会在后续菜单失效时覆盖已学到的名称，且测试手动display:{}绕开状态。随后730c65b保留已解析名称的一致fallback；有效RED是实际adapter和实际SFC连续“空菜单pending→有效菜单→空/失效菜单”2项均失败，GREEN2/2，相关草稿/移动/render57/57及商户H5/mp-weixin双构建退出0。独立复审spec compliant/Approved，原Important及测试绕过问题均关闭，无新增Minor。原输入/selection、价格/configurationRevision、pending/key/body、未知锁和正式订单原袋保持。

真实F首轮故障拦截脚本过早以“待核对”出现作为完成条件并在handler结束前unroute，产生route already handled工具错误；真实创建实际正常返回并清pending，不能算丢回执复验。root未重复POST；只读确认唯一F cmvgzncmk002x3mdsbwozfwcd/rev0后真实取消201/requestIdf9625f38-b3b2-4c91-887c-06fdd2f0e4ba，CANCELLEDrev1。该记录保留，不删除历史。

修正脚本明确等待原route.fetch及abort完成，再新建独立G“手机挂单验收G·显示复验”：POST201/requestIdd54b6146-ff1e-480a-b620-98adf016665d后确实丢回执，唯一草稿cmvgzrcaj00353mdsaym1to1f/rev0。真实刷新、接受beforeunload后待核对入口仍在；明确恢复原挂单201/requestIdbeb26dcc-7524-4d2a-b22f-633312546f23返回同ID/rev0，监听确认sameKey=true/sameBody=true/POST仅1。原备注“手机G：刷新重放后显示真实名称”前后相同，购物袋正确“验收菜品·桂花鸡腿饭 · 标准 ×1”及30.80元，没有原商品占位；实际截图cashier-drafts-mini-g-restored-names.png已查看。最后UI明确取消G201/requestId25c49283-ce7f-40eb-8874-955354da53eb，CANCELLEDrev1。

最终mini-task3-final只读SQL：19订单、69事件、12现金34803分、4退款5383分，净29420分，public4订单、源10会话、7草稿19审计。mini-e-completed→mini-task3-final十张交易/库存/预约表hash全部相同，F/G恰新增2草稿、创建及取消各2审计，无新增交易或库存变化。原A/B/C/D/E状态保持，所有非正式验收草稿已明确取消且历史仍可查。原18订单及金融逐行保护证据沿mini-a-preservation；A是唯一新增正式交易，已完成并收现金一次。没有残留unknown、临时停用、故障route或需处理的未付验收单。

Task3范围完成：实现8796b0d、显示5e58a2c、窄屏c76280a、恢复显示4ce91b8/730c65b均经过独立任务审查，所有Important已修复。原Task3五构建、最终受影响商户双构建及聚焦57项按各次报告实际范围记录，不将旧全suite计数冒充最终新计数。权限撤销、两员工不同报价转换竞争、失效预约/库存/属性与回滚沿Task1随机数据库HTTP专项；不是本轮微信真机并发实测。REQ079/080满足本地Web/H5/HTTP/PostgreSQL范围，标verified_local；生产、微信身份/支付和真机仍未验。REQ015完整收银、REQ090交班及90项其余范围继续，不关闭整体goal。
