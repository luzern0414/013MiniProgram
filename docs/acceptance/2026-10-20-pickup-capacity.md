# 预约自提阶段记录

日期：2026-10-20。对应REQ-007/008，本模块本地HTTP/PostgreSQL及三端H5业务验收已通过；微信真机、真实微信支付和生产未验证。下文保留逐阶段事实，早期“未执行”描述为当时状态。

## 已执行的运行库保护

1. 只读脚本 `output/playwright/pickup-migration-preservation.mjs before` 保存development/public既有39张业务表、339行；排除迁移管理表，每张表保存当前列名、规范化行哈希和行数。保存位置 `output/playwright/pickup-migration-before.json`。后续比较仅取这批原列，不能因为迁移新增列而误报，更不能跳过原有配置版本或交易字段。此基线在规格验收新增3订单之后抓取，未沿用更早284行基线。
2. 实现者在隔离test_pickup随机schema中确认缺政策端点404形成RED。根核对3000监听PID33668命令为 `node dist/src/main.js`，只停止该自有进程并确认端口释放后，允许生成Prisma客户端。没有允许迁移、seed/reset开发库；浏览器暂时无法读取API为这一维护窗口的真实结果。
3. 根运行 `pnpm db:backup` exit0，导出 `data/backups/backup_3798a8f9c5942149242f90c73fa9c5f2/database.dump`，SHA256 `f2770e5ced7b50365d0d36aa63920911c4374ffd53fd05ef660988734e4199d0`，manifest同目录。此次证明导出和摘要成功，未额外恢复验证此份备份。

现存业务基线：development8订单、现金5笔12740分，public4订单；规格验收样例小份7/0、大份4/0、卤蛋3/0（可售/预占），配置revision9。原保留恢复库及其他备份均保留。

## API审查及迁移已执行

Task1 `d0d4815`，独立 `pickup_capacity_api_review` 结论 Spec compliant/Approved，无Critical/Important。专项源码/构建各6、领域9、分类6、规格10、员工3、bootstrap4、源码HTTP1、构建R1 HTTP11及build/tsc通过，报告 `docs/tasks/pickup-api-report.md`。Minor：新服务/辅助函数长行可读性、既有Prisma package.json配置弃用警告，记录整分支清理。根核查未变PublicBrand/assertStore、main全局Envelope/Errors与requestId，未发现边界缺口。

根审查后运行 `pnpm local:migrate` exit0，仅对development应用008；再运行保留脚本after，39表339行原列序列化哈希一致。后来发现此脚本将Date序列化为空对象，因此该哈希仅证明非时间原值及行数一致，不证明时间字段原值保留，见末尾证据范围修正。此前迁移前也运行过after检查且一致，不能混同为迁移后的证据；正式比较在迁移成功后重新执行。API重启会话50198，真实health200/databaseconnected。浏览器已有OWNER会话真实读取政策200（关闭、revision0、上海时区、提前15分钟/14天），经营与公开时段列表均200/[]。读取不创建时段。规格最终业务只读重新核对，8订单/5现金12740/public4及样例7/0、4/0、3/0保持。

## 未执行

三端界面、运行库预约选择与收款/核销、并发最后名额、取消/超时释放、权限和异常恢复均待Task2实现及审查后进行实际页面验收。隔离API测试不代替这些操作。详细清单 `.superpowers/sdd/pickup-acceptance.md`。

根曾在API停止后尝试补拍规格收银已完成详情，真实读取失败导致脚本等待详情超时；没有业务写入，也未将其当作预约或规格的新通过证据。此前规格真实交易/SQL证据保持，待API恢复后可再次只读打开详情。

没有微信AppID、支付商户号、HTTPS域名或服务器。用户明确先做本地功能，生产/微信真机/真实支付保持未验证。

## UI运行准备

根核对旧小程序进程分别为customer PID28792 / merchant PID29820，仅停止这两个自有uni H5进程并重启。新会话customer38366、merchant72731监听5174/5175；真实HTTP读取两端mini-core入口均200且包含新增pickup.mjs导出。此操作修复开发服务缓存，不涉及订单或配置写入。

## UI首轮实施及审查

6661112/3d8be6f实现三端配置、选择、核销与查号；共享78/Web20及五构建通过，报告docs/tasks/pickup-ui-report.md。独立pickup_ui_review判定Needs fixes：按全历史扫描的2000单限制导致规模增长后必需查号功能不可用；没有用户批准的范围例外，根要求服务端门店+号码+履约日期谓词并补真实隔离>2000历史单回归。专项修复进行中，尚未开始源库时段配置或预约交易。

只读页面尝试：HMR曾重置Web导航使截图落在dashboard、后续pickup定位超时，未作成功证据。H5日期picker首次鼠标拖拽未得到目标日期，正在核对真实触控路径；仅改变查看日期，无业务写入。

H5日期操作定位已解决：uni picker打开后，等待容器展开，真实鼠标wheel在日列每次正向滚动一步，再点击“完成”；门店查看日期已实际从2026-10-17改为2026-10-21并触发真实GET。此前mouse拖拽或CDP触控虽然视觉滚到21日，但确认值未更新，不作为成功路径；wheel路径确实更新页面日期。该操作只读时段，没有配置或订单写入。后续顾客同类picker采用已验证的wheel交互。

## 查号复审与真实预约已执行

修复27b6342/报告cd6a15b，独立pickup_ui_review复审Approved，无Critical/Important/新增Minor。实际API精确停止PID5424 node dist/src/main.js并重启session63649；未生成Prisma或迁移。源码服务再次发现mini pickup.mjs仍含旧maxPages，核对自有customer26672/merchant1928后仅停止两者并重启8703/25356；HTTP确认已无旧门槛且含pickupNumber谓词。

Web真实启用政策revision1/提前15/14天。慢PUT期间门店与导航disabled=true。生成2026-10-21 11:00–13:00、每30分钟、容量2，共4时段预览后提交；拦截真实201已提交响应并abort回执，POST计数仅1，页面保留草稿且锁导航。真实重新读取得到4时段并清可重发预览，截图pickup-web-slots-created.png。时段依次cmvgpn17w00033mysvsqid38h、cmvgpn17x00053mys792qedcj、cmvgpn17y00073mysvp2dyorj、cmvgpn17z00093mys0yincx55。源订单仍保留，只新增实际验收行为。

顾客H5真实购物袋、日期picker、时段选择、报价、提交：
- Q0001 / cmvgpnggn000f3mys93jxxkfy / R179250240616607819D9C2C，2026-10-20T13:20:06.167Z创建，3080分，约明日11:00–11:30，计划自然等待15分钟到期；未修改source付款时限。
- Q0002 / cmvgpo3u9000k3mysiso77m1t / R17925024364646A348323F7，13:20:36.465Z创建，同窗口3080。只读pickup-held-sql.json证明两HELD、首slot held2/confirmed0，SKU14→12且reserved2。

根在另Web真实关闭首slot revision1，held2仍保留。原Q0002继续Web现金5000/应收3080/找零1920成功，13:23:20.764Z生成cash cmvgprmm4000p3mys68mpydp3，转CONFIRMED；接单→出餐→核销。先输错号Q9999请求400（浏览器请求记录），再输Q0002双击时真实POST已提交后丢回执；页面锁到“读取订单并核对结果”，重读后展示COMPLETED/5事件（只有一个完成事件）。重复核销API201仍同5事件。后续SQL pickup-completed-sql.json及pickup-cash-confirmed-sql.json记录真实变化；完成不释放confirmed1，Q0001仍held1。

测试脚本两个文案假设不符曾超时：收款已成功后错误等待“接单制作”，实际为“接单并制作”；核销已成功后错误等待“重新读取订单”，实际为“读取订单并核对结果”。根通过只读SQL确认前次结果，未重复收款/重新建单；按实际按钮恢复并继续。顾客列表number文字带“·到店自取”，首次exact短number定位超时；改真实完整文本后刷新详情同窗口/Q0002/完成5事件，截图pickup-customer-q2-completed.png；Web截图pickup-web-q2-completed.png。

权限：CLERK Web政策表单input的matches(':disabled')=true，无保存按钮（fieldset自身isDisabled不反映子输入继承，已查原生有效状态）；直接PUT403、跨店GET403。容量降到1低于首slot held1+confirmed1返回409 STATE_CONFLICT。H5真实重新读取同政策及明日4窗口/占用，标签“至少提前”点击聚焦INPUT#pickup-lead-experience-store-a-native；截图pickup-merchant-slots.png。

配置冲突：Web把提前改20生成policyrevision2；H5保留旧rev1、草稿16真实PUT409，requestId e642e215-a11f-483b-ad3d-86040fbb451a，导航锁定且输入16保留。拦截GET离线失败后仍锁且有requestId，恢复真实GET后对照草稿，再明确保存15成功revision3。未把读取失败当保存成功。

最后名额实际源库竞争：Web将第二slot容量1/rev1。顾客身份与OWNER收银身份各真实报价，Promise.all并发建单，返回201/409 PICKUP_SLOT_FULL；不是两个不同顾客，不将本场景表述为双顾客验收。赢家顾客Q0003 / cmvgq4i0w001d3mys7simi8vc / R17925032013435D8DFC97A7，13:33:21.345Z，连续取消两次均201但仅一个取消事件、reservation RELEASED；失败一方未留下订单。SQL pickup-race-cancel-sql.json记录，第二slot归零，原Q0001/Q0002占用不受影响。

仍待自然到期、Web收银选择/旧报价、merchant实际查号、部分参数边界/重新登录等余下清单，不标REQ007/008 verified_local。

## 收银旧报价、即时分号及商户H5履约

Web收银真实选择明日第二时段并报价，再改第三时段，旧报价立即消失。重新报价后另一页面关闭第三时段，原页面建单409 PICKUP_RULES_CHANGED，原选择保留，没有偷偷改为即时，也没有产生订单或现金凭证。用户明确点击尽快取餐后真实建单/现金4000分，应收3080、找零920，得到今日Q0001 / cmvgqcn4h001p3mysrx8ya8sm / R17925035812004281952A5D（OWNER收银身份），与明日Q0001按履约日分别分号。脚本pickup-cashier-slot-quote.cjs、pickup-cashier-stale-quote.cjs、pickup-cashier-instant.cjs，截图pickup-cashier-instant.png。

商户H5按今日/Q0001真实查到该订单，接单制作、标记备好时逐次确认原生弹窗，随后错误Q9999核销400、正确Q0001核销201，最终COMPLETED/PAID且5事件仅一个完成事件。脚本pickup-merchant-instant-fulfill-confirmed.cjs及截图pickup-merchant-instant-completed.png。首次遗漏弹窗确认的脚本只等待超时，没有发接单请求；随后确认真实请求完成，不将超时当通过。新只读pickup-instant-completed-sql.json确认12订单、7现金18900分、public4订单/7会话；验收鸡腿饭stock11/reserved1，仍由明日Q0001持有，Q0002完成CONFIRMED不释放。

## 真实自然到期发现缺陷（未通过）

明日Q0001创建于2026-10-20T13:20:06.167Z，实际经过15分钟仍PENDING_PAYMENT/HELD。只读pickup-expiry-stored-text.mjs发现数据库TimeZone=Asia/Shanghai，createdAt原值13:20:06.167而paymentExpiresAt原值21:35:06.155，实际差8小时14分59.988秒。无时区timestamp默认从now()+15分钟转换时带入数据库当地时区，导致超时晚8小时。没有修改源库时间、订单或库存来制造通过。修复brief .superpowers/sdd/payment-deadline-fix-brief.md要求统一UTC创建时刻/15分钟期限，既有生效期限取stored与created+15较早值，009只改默认且保留旧行。修复及独立审查、备份、增量迁移、原Q0001自动关闭释放复测均完成后才能登记此项通过。

## 边界、身份隔离及重登

pickup-negative-source.cjs对真实API执行：时段不带时区、25点、跨日、容量1001均400；与已有时段重叠409；带startsAt修改已有时段400。顾客访问OWNER今日Q0001详情403，按同号/今日查询200但items空/total0；CLERK跨店核销403。拒绝请求没有形成新业务行。

顾客真实退出登录，再通过体验顾客登录入口重新登录，进入既有Q0002；原预约窗口/Q0002/完成5事件保持。拦截该详情GET离线后显示网络失败及编号、保留原事实，解除拦截点击刷新真实读取恢复。脚本pickup-customer-relogin-start.cjs、pickup-customer-relogin-finish.cjs。恢复脚本返回时仍有加载提示，后续读取同完成详情稳定，不把点击本身当响应完成。

商户H5真实填旧10位号4150BFE352、按下单日2026-10-20查号，GET精确参数200/total1，打开原completed详情，旧现金3080/5000/找零1920和5事件不变。pickup-old-number-submit.cjs。第一次fill后立刻click捕获到旧Q0001查询，没有将其当旧号通过；拆开填入/点击并核对实际URL与完整响应后才记录旧号查号通过。

## 009保护、修复复测及最终本地结论

def6feb实现，独立payment_deadline_review判定Spec compliant/Approved，无Critical/Important。专项8/8、预约7/7、领域9/9、tsc通过；详细真实RED/GREEN及两种会话时区迁移测试见docs/tasks/payment-deadline-fix-report.md。Minor仍为CRLF转换提示，列入整分支检查。

根核对3000监听PID28468命令node dist/src/main.js后精确停止，保存全新原列基线output/playwright/payment-deadline-migration-before.json：43表392行。备份data/backups/backup_4f30126725837641927885debc7ec5be/database.dump，SHA256 72821b973e18465bfbf67830cc9d43cf7ec0282eaa956e6fadb67449e07c35c5，导出及摘要验证成功；当时未恢复此份，后续恢复与时间字段补核单独记录。旧备份及恢复库均保留。pnpm local:migrate只应用009；随后after重新比较43表392行序列化hash一致，但旧脚本未覆盖Date实际值，不能称全部原列原值一致。重启前只读确认原Q0001仍pending且原污染deadline未改，避免把自动关闭混同为迁移修改历史。

API新会话48408重启后health200/database connected，原Q0001在2026-10-20T13:50:59Z由真实sweeper自动关闭。顾客实际刷新列表打开详情显示“超过付款时限，订单自动关闭”，截图pickup-customer-expired.png。只读payment-deadline-source-check.json与pickup-final-sql.json确认CANCELLED/CLOSED、RELEASED、inventoryReleased=true、关闭事件1/ORDER_EXPIRED审计1，鸡腿饭stock12/reserved0；原storedDeadline21:35:06.155保留，未回写历史。重复跨30秒扫描后仍同1事件/1审计、库存12/0，Q0002 CONFIRMED及confirmedCount1保持。

真实API再创建第二窗口Q0004 / cmvgqs0tg00063m0g64zmop19 / R179250429878716B7A2CA1E，旧Q0003取消后未复用号。同幂等key重放仍同order/Q0004，连续取消两次仅一取消事件和一次RELEASED。新单createdAt13:51:38.787、deadline14:06:38.787，精确900秒，SQL默认也明确UTC。脚本pickup-sequence-replay.cjs。此单为HTTP补充验收，不冒充额外页面建单。

最终development13订单、7现金18900分、public4订单、8会话（顾客重登新增会话），鸡腿饭12/0、小份7/0、大份4/0、卤蛋3/0。第二窗口held0/confirmed0、首窗口held0/confirmed1；日序列明日last4、今日last1。旧备份描述各自时刻，不要求其与新交易后的库相等。

REQ-007/008仅标verified_local。并发源库实际为顾客与OWNER收银两个身份，未声称两个独立顾客账号；隔离专项提供容量并发及权限回归。当前固定体验登录只有一个顾客身份，尚未进行双微信顾客真机竞争。叫号凭证在商户页面可读并核销，未接入订阅消息/打印机播报。后续现金退款与完整财务对账不属于本模块完成结论。

SQL时间证据补充：早期pickup-sql-check.mjs由node-pg默认把timestamp without time zone按Windows当地时区转Date，slots.startsAt的JSON字符串因此比数据库原文本早8小时。该输出只用于计数/状态，不能当时段UTC原值；原API/订单window快照与页面时间不受影响。新增pickup-sql-raw-utc-check.mjs将OID1114保留原文本，pickup-final-raw-utc-sql.json确认四时段原值为2026-10-21 03:00/03:30/04:00/04:30，分别到03:30/04:00/04:30/05:00，对应北京时间11:00–13:00。保留旧文件，不静默改写早期证据。


旧迁移哈希证据范围更正：旧stable将Date转成空对象，008/009哈希相等只覆盖非时间原值及行数。退款迁移前已修复备份恢复误判，并真实恢复009前原dump到restore_faab27b9f1da6f6e22e053a0aeb15f21。服务端JSON原列只读对照43表379条恢复后旧行，无旧行缺失；13张含时间表中221条可比行时间原值全部一致。Session因恢复安全策略清空不在时间对照内；Q1超时/Q4新建等后续业务差异单列解释。完整方法、恢复记录及限制见[现金退款阶段记录](2026-10-20-cash-refunds.md)。这不倒推早期007/008当时已完成时间字段哈希验证。
