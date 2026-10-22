# 现金班次与交班本地验收

状态：API、shared/Web和商户小程序三任务均已独立审查通过，012源迁移、双商户真实页面与跨端收款/跨班退款/关班恢复及SQL保护已核对。REQ087现金收款本地完整验证；现金交班只是REQ090的子集，微信、余额、挂账等其他渠道及应收未完成。

## 范围与源数据保护

设计/计划：docs/superpowers/specs/2026-10-21-cash-shifts-design.md、docs/superpowers/plans/2026-10-21-cash-shifts.md。根代理执行清单：.superpowers/sdd/cash-shifts-root-acceptance.md。每店一个共享活动班，店主开关班，店员读/收款，退款沿店主权限；旧凭证不猜填归属，旧金额/时间/操作者/快照保持。

API派发基线6e6bc5f；报告docs/tasks/cash-shifts-api-report.md，提交1d873cf；独立审查包output/cash-shifts-api-review-6e6bc5f-1d873cf.diff。root控制generate前精确API停机、独立审查后的fresh原列基线/新备份/实际新库恢复/对照/下一增量迁移及健康。不能使用旧011备份或验收结果代替本轮迁移证据。

挂单阶段最后只读快照mini-task3-final（本模块未来须另抓fresh）：19订单、69事件、12现金34803分、4退款5383分、public4订单、10会话、7草稿19审计。A新正式单已完成/付款，B/E/F/G草稿已取消，C已转完成单，D已转取消单；无验收unknown或未付单。小份SKU可售4/预占0，卤蛋可售0/预占0；不能用SQL回填库存以方便测试。

## 待执行门槛

- [x] Task1隔离API/迁移/约束/并发/旧列原时间/原幂等回归、独立审查。
- [x] 源fresh基线、新备份、真实恢复及原列对照；仅下一迁移；旧凭证shiftId=null；API健康。
- [x] shared/Web实现与独立审查、真实开班/现金/关班/版本冲突/unknown恢复及只读SQL。
- [x] merchant-mini独立实现审查、跨端班次收款/关班/跨班退款/不可变快照及SQL。
- [x] 权限、负应有/找零/边界、网络/401/存储、不同key竞争和原key恢复按真实范围记录。
- [x] 390px/min14/reduced-motion/键盘和操作可达、截图实际查看；README/config/requirements同步。

用户已确认尚未准备AppID、支付商户号、HTTPS域名和服务器，先完成本地功能。本记录不表示微信开发者工具、真机、微信支付或生产已验收。

## 实施中记录

Task1首次隔离HTTP有效RED：无班新现金实际201、期望409，班次端点尚不存在。实现者请求generate后，root核对3000监听PID29008、命令node dist/src/main.js为本项目原API，精确停机并确认端口释放；允许一次模型就绪后的Prisma generate，不允许源迁移或启动新API。45张旧表500行全部原列/原时间fresh基线已保存cash-shifts-migration-before.json。

额外预实施安全备份backup_29a745536c55d7075a95870b5549bcdc成功，SHA256 68fedd14092f86a0f3f29b1dd65f34ce72d60dac8fd56ae9ff74a3482e8f42e5；仅export已验证，尚未真实恢复，也不冒充独立审查后的迁移关卡。源码/随机夹具实施继续，源API停机、源库未迁移，前端开发服务保留；源金融写暂不进行。

## Task1独立审查和源迁移关卡

API提交1d873cf，cash_shifts_api_review给出Spec compliant/Approved，无Critical/Important。Minor：新专项仍打印旧“RED missing payment”诊断，预期审计失败日志和Prisma配置弃用/更新提示使输出有噪声，列入整分支收尾triage；未删除或隐藏失败证据。UI恢复与可访问性仍属Task2/3及root验证。

审查后重新确认3000无监听，fresh approved-before为45表500行。新备份backup_23ad7db3851e09da75c1b7f67df0267a，SHA256 d6411703589c4005973d96c582d9e8d63dfa7a7cce87456bf587bb4ce5ecef31，实际恢复到保留数据库restore_68bc47dbe18668fe88752edd137cff10，恢复过程撤销31条跨schema会话。原列/原始UTC时间对照43张非Session表485行全部一致；development源会话10/public5保持，恢复库两表均0。仅012迁移应用development，approved-after确认全部45表500行旧列原时间完全保持。

只读核对：CashShift0，原12现金34803分/4退款5383分全部shiftId=null。证据output/playwright/cash-shifts-approved-migration-before.json、cash-shifts-approved-prerestore-original-columns.json、cash-shifts-approved-migration-after.json、cash-shifts-source-migration-check.json。tsc exit0后启动API session64034/PID33744，health200/database connected（requestId2617d383-42dd-46d8-bbb2-62e3268ee8c8）。原会话真实GET current200 shift:null（f7eead71-979b-4053-ba92-da33c5644db5），list200 total0（2601720e-1a63-4e06-8888-0180615c23ce）；原A完成单GET200（12d2d97d-2a0c-4adf-a2c4-f5a8f41175ae），现金4360/交5000/找640、shiftId:null；当天overview10520/退款0/净10520/orderCount3。未执行新开班、收款或退款。

Task2于99f6cd6派发shared/Web唯一实现者，未交付/审查；Orders现金入口将最小接入已有Cashier恢复，不自动收款，不用交班解锁其他unknown。root已抓ui-before只读一致性快照：19订单69事件/12现金34803分/4退款5383分/7草稿/0班次0班次审计，会话10/public订单4。证据output/playwright/cash-shifts-ui-before.json，后续真实UI变更须逐行核对历史原记录。REQ090仅API现金子集进度，90项状态12 verified_local/15 in_progress/63 planned，production0。

## Task2交付与只读页面检查（尚未业务验收）

提交f4bbb69，报告docs/tasks/cash-shifts-web-report.md：shared178/178、Web74/74、vue-tsc/Vite build均exit0；最终测试夹具关闭HMR后无WebSocket/Vue警告。独立审查包output/cash-shifts-web-review-99f6cd6-f4bbb69.diff，尚待结论。root只读进入新交班页面，真实显示当前无活动班与历史0；未开班或收退款。桌面1440/scroll1440/min14。首次390截图发生在sidebar resize过渡中，不作失败或完成证据；等待sidebar退出后稳定390/scroll390/min14，确认开班按钮x19..371可达，新区域reduced-motion检查true。实际查看cash-shifts-web-empty-desktop.png及cash-shifts-web-empty-mobile-stable.png；卡片内容贴边、标题/正文间距不齐已记入待审查统一视觉改进，不能只凭没有横向溢出认定视觉验收完成。脚本cash-shifts-web-empty-read.cjs、cash-shifts-web-empty-stable.cjs。

独立审查结论Needs fixes：Important为已有收银恢复提示时，App只在dashboard采用持久shift pending，CashShifts未挂载导致shiftBusy未覆盖新现金/导航/切店/退出。具体路径为未付订单保留→开班unknown→刷新回Cashier；不得仅提高交班路由优先级而覆盖其他现金unknown。Minor为已确认卡片留白。新唯一修复者于c465c75派发，brief.superpowers/sdd/cash-shifts-web-fix-brief.md；要求实际load组合恢复RED/GREEN、独立持久OR锁和可达恢复路径，并追加原报告、复审后再真实业务验收。源无新增班次/收退款。

## Task2最终复审与真实Web验收

修复c5e0108已由cash_shifts_web_review独立复审，Spec compliant / Approved，无Critical/Important或新增Minor。实际App/Cashier/Orders组合RED→GREEN覆盖持久pending/损坏、缺导航hint、原现金/退款/挂单unknown和班次锁OR，原下单恢复不顺带新收现金；受影响89/89及Web类型/Vite构建通过，详见docs/tasks/cash-shifts-web-report.md。修复后截图已实际查看：桌面1440/scroll1440/min14，390/scroll390/min14，正文inset分别24px/25px与20px，reduced-motion通过。

root实际无班点击新收款：前置GET在创建订单之前拦住，保留商品、备注和实收2.00元，导航开班可用。只读web-preopen-check与ui-before全部业务行一致，仍19订单/12现金/4退款。最初脚本错误等待/orders导致超时；此处没有新订单或现金POST，不能称为源现金端点409（该409由Task1隔离HTTP覆盖）。

本轮W班cmvh2klvc00033m1carw9wpyu，期初100分：真实开班POST201/requestId330925ab-4600-43ab-928c-3f3b4619a48f后丢弃回执；slow期间导航/切店/退出均锁。原开班pending持久保存，离线读取未发POST且保持锁，刷新后聚焦恢复区。在线读取活动班仍不清原开班pending；明确恢复原开班后201/requestId8b69e120-0732-4902-b050-b931e857889c，原key/原body相同、返回同ID/revision0，未新开第二班。首次DOM即时采样导航仍忙，后续稳定读取已解锁；没有清存储绕过。源码89项覆盖复合未付单恢复，本次浏览器刷新保留的是未下单购物车，不能混称同一路径。班次401范围仍只在隔离控制器测试覆盖，本次未额外执行真实401。

另一OWNER窗口预读W revision0，实点输入1.00元；CLERK真实页面只读，无开关按钮。回原购物车明确重新核价后，创建W订单cmvh2mq7s00093m1cqaersdss / R179252420716080BBCDA8B7（201/requestId59d75e3e-a758-416b-a0a3-70a1d5551959），仅商品“验收响应·仅一次”标准1份、堂食01桌、备注“现金交班Web独立验收W：新单123分，仅本单验证班次”。现金201/requestIdccfbc323-950c-4520-924e-1c0a938b43c8：入账123、实收200、找零77、shiftId=W。班次只加123分。

旧窗口明确关班使用revision0，真实409 SHIFT_CHANGED/requestIdf51ad2fc-c229-478e-904a-1d8b6b4db54e，实点1.00与空原因保持，GET显示新应有223分，不自动重关。明确重读并实点2.23元后，二次确认201/requestIda21134ca-20c7-458e-a2a0-3986c1bec480，发送revision1，CLOSED revision2；固定快照收1笔123、退0、期初100、应有/实点223、差额0。Modal初始焦点在关闭按钮，Shift+Tab留在弹窗，Escape返回核对关班按钮。刷新默认回工作台，再明确进入交班，历史与原快照仍可查，无pending。

W订单通过真实订单UI接单、出餐、完成，最终COMPLETED/PAID。首次接单脚本误等复数/transitions超时；先读取已制作中后，仅执行剩余出餐/完成，未重发接单。出餐requestIdda51aed3-b483-4408-b516-b6e6e88ce57c，完成ef57bb6c-a6e4-4c72-aeec-4dadca1c3485。SQL只读web-final及逐行断言cash-shifts-compare-web.mjs确认旧19订单、69事件、12现金、4退款、7草稿和预约配置原记录保持，原shiftId=null；仅新增W订单、5事件、1现金、1班次、2开关审计。对应SKU cmvgk6lwn001s3mjktumarv7i库存1→0、reserved0→0，其他SKU及所有modifier保持；不能回填此合法消耗。首次比较脚本误用所有表都有id，修正PickupPolicy/PickupReservation/PickupSequence自然键后断言全部通过，不是源业务变化。

最终20订单74事件/13现金34926分/4退款5383分，净29543分；public4订单、development10会话保持；无活动班和本轮未付订单。证据output/playwright/cash-shifts-{web-preopen-check,web-final,web-preservation-result}.json及cash-shifts-web-{open-w,offline-w,recover-w,stale-read-w,pay-w,conflict-w,close-w,complete-w}.cjs。Task3小程序和跨班退款尚待实施；REQ087/090仍in_progress，90项计数不变，production0。

## Task3实现、首轮独立审查与只读UI检查

Task3于4a6917a派发cash_shifts_mini，提交4161492；报告docs/tasks/cash-shifts-mini-report.md。首轮mini-core205/205、Web85/85和五构建通过；最终后续受影响111/111、商户H5/mp-weixin双构建通过，未重复无关suite。独立cash_shifts_mini_review结论Spec issues / Needs fixes：merchant.js现金STATE_CONFLICT分支await原订单GET后没有再次校验作用域。隔离fixture复现GET等待期间session-expired后，迟到成功仍发布原订单、切路由并清原cash-attempt。root已读取代码确认；于4161492派发唯一cash_shifts_mini_fix，brief.superpowers/sdd/cash-shifts-mini-fix-brief.md，修复/复审前不执行Task3源金融写。

root只读检查先遇到开发服务旧模块缓存：源码index.mjs已有shiftAmount/readShiftAttempt，而5175旧v=32e786cc返回内容缺少导出、新query或/@fs路径则有导出。按systematic-debugging核对PID31280完整命令确为本项目merchant-mini uni -p h5 --port5175，仅精确停该进程并重新pnpm local:merchant；新session53124/PID28192，API3000/Web5173/customer5174保留。禁用该页浏览器缓存并刷新后，真实新页面与交班入口可读，未清业务storage或篡改token。最初run-code正则双转义导致定位超时，改为文件内uni-button字面正则后成功，不是界面缺入口。

只读进入交班读取原W闭班快照：期初1.00、收1.23、应有/实点2.23、差0，与Web一致；无活动班、没有开班写。cash-shifts-mini-readonly-visual.cjs得到390/scroll390/minFont14，按钮高度至少49px、布局换行可达，reduced-motion=true；实际查看cash-shifts-mini-readonly-390.png。截图恰明细读取收尾按钮为灰，待真实验收稳定后另拍，不将加载帧当作功能失败或完成金融验收。当前Task3仍待Important修复、独立复审及真实跨端交易/SQL，不能标verified_local或真机通过。

## Task3最终复审与真实跨端验收

修复43c7495已由原独立reviewer复审，Spec compliant / Approved，原STATE_CONFLICT迟到GET Important关闭，无新增发现；完整报告output/cash-shifts-mini-fix-rereview.md。修复聚焦RED15失败→GREEN17/17，最终受影响128/128及商户H5/mp-weixin双构建见docs/tasks/cash-shifts-mini-report.md；不重复已通过的无关suite。以下为root随后真实UI/API与只读SQL验收，不能以隔离测试代替。

fresh mini-before：20订单/74事件、13现金34926分、4退款5383分、7草稿、1已闭班/2交班审计、public4订单、development10会话。Web明确开A班cmvh3vegn000s3m1cdydsam9f，期初0、revision0，POST201/requestIdbdf529cb-a628-46f2-b7a8-55823ebf67ed。

商户H5新选真实可售“验收新品·菌菇饭”小份1份、清淡、不加料，到店自取/尽快，挂单名“交班跨端验收”，备注“交班跨端验收：新单用于A收款与B部分退款，仅本单”。生成正式订单cmvh41im800123m1co0jfdn16 / R1792526576767280BF1A957 / Q0006，报价1880分，POST201/requestIdfe944bbf-9100-449b-bd08-bcddad0170c8。明确实收20元并二次确认，现金POST201/requestId3e413989-3888-40f0-bc47-b4333ee314d7：amount1880/tendered2000/change120，shiftId=A。Web重读活动班显示1笔1880，应有1880；未把实收或找零重复计入。

新单经商户H5接单制作→标记备好→输入Q0006核销，最终COMPLETED/PAID。Web实点18.80元，确认清点后明确关A，POST201/requestId6684b689-b86b-4eca-b7ce-c9126779fc2f，CLOSED revision2、收1880/退0/应有1880/实点1880/差0。mini随后读取A关闭快照一致，readonly mini-a-closed保存关班事实。

mini开B班cmvh48dpf001n3m1c6znqtj5q，期初0；route.fetch真实提交201/requestIdbd32765b-39a9-497f-88db-24798cb64581后仅丢弃回执，等待handler结束再解除路由。slow期间导航、切店和退出均锁；原pending存uni storage。刷新经真实beforeunload确认后发现原pending，离线读取0次POST且原记录保留。用原session真实POST /auth/logout撤销（201），页面读取current真实401并回登录，pending保持；同体验店主重新登录后仍发现原记录。在线GET读到B OPEN仍未清原开班pending，0次新开班；明确“恢复原开班”以原key/原body重放，201返回同B ID/revision0，只有这次明确重放1次POST，成功后pending清除。脚本cash-shifts-mini-{open-b,offline-b,expire-b,recover-b}.cjs；没有伪造401、篡改token或清存储。

仅对本轮新单明确退100分，原因“本地交班验收：仅本轮新单退还1元核对跨班归属”，确认现金已退还后POST201/requestIda2972101-d314-4f5c-bb5f-7ebd38f07c26。凭证cmvh4byir001t3m1c2eqfcnx3归B，原收款仍归A；订单COMPLETED/PAID/PARTIAL，累计退100、净1780。B重读收0/退100/应有-100，负应有合法。实点0、空原因点击核对被前端明确拦住，没有关班；填写明确本地验收差额原因后，二次确认关班201/requestId34fe6b60-7336-4256-a58a-87ee19194cea，CLOSED revision2、实点0/差100，未生成虚假金额调整。

readonly mini-final与逐行断言cash-shifts-compare-mini.mjs通过：原20订单、74事件、13现金、4退款、7草稿和W关闭班逐行完全保持；只新增本轮1订单/6事件/1现金/1退款/1转单草稿/2班次/4开关审计。A完整原始关闭行与退款前mini-a-closed完全一致。仅小份SKU cmvgjl8io000a3mjkrs3u2cs6 stock4→3/reserved0→0及当天取餐序号5→6是合法业务变化，其他SKU/Modifier和预约配置/容量/凭证原样，不回填库存。比较脚本初次误断言CashRefund.orderId，实际关系为paymentId，按真实schema修正后通过，未改源数据。

最终21订单80事件、14现金36806分、5退款5483分、净31323分；public4、会话10（撤销原会话后同身份重登）保持总数；3班全CLOSED，无本轮未付单或金融pending。证据output/playwright/cash-shifts-{mini-before,mini-a-closed,mini-final,mini-preservation-result}.json。导航解锁后Web刷新与mini历史均读到3个关闭班，A快照仍1880，B退款100。

cash-shifts-mini-final-visual.cjs实测390/scroll390/min14/reduced-motion=true，实际查看cash-shifts-mini-final-{a,b}-390.png，文字换行正常；滚动到B最后关班时间后bottom682.86，底栏top763.23，内容实际可达，初次截图下沿不是不可滚动遮挡。Web键盘/跨设备close409、角色只读由Task2真实验收；跨店/顾客/撤权、不同key竞争及事务SQLSTATE/审计回滚由Task1隔离HTTP/PG验证，不混称本次源并发操作。此次未新增其他渠道或微信真机验收。

期间几次Playwright等待超时分别为未填写挂单名称的前端校验、uni包装元素/前导空白定位、未处理uni确认弹窗和误等旧quote/redeem路径。每次先读取当前UI/事实，只执行未完成的明确步骤，没有因超时重发金融写或创建第二笔验收订单。原记录SQL保护与唯一新增数量已交叉核对。

REQ087按“实收、找零、收银员、班次账本可对账”标verified_local；REQ090仍in_progress，其他渠道实收/退款和应收未实施。90项为13 verified_local/14 in_progress/63 planned，production0。接着推进地址簿及配送模块，全项目goal继续active。
