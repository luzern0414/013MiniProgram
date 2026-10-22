# 现金退款阶段记录

日期2026-10-20。现金部分/全额退款已完成API、两商户界面、顾客凭证、独立审查及本地真实页面/PostgreSQL验收。以下前期段落保留当时状态，最新结果见末尾；不代表微信退款、完整财务对账或交班完成。

## 执行前状态

用户没有AppID/微信商户号/HTTPS/服务器，已明确先完成本地功能。现金退款是商户已向顾客实际交还现金后的登记，不能代表微信原路退款。

源development13订单、7现金18900分；public4订单；顾客重登后8会话。验收鸡腿饭SKU cmvge0p0n00043mlsxb4ni7em可售12/预占0，小份7/0、大份4/0、卤蛋3/0。预约首时段held0/confirmed1，Q0002完成仍保留CONFIRMED；所有旧备份/恢复演练库保留。此为付款期限009修复后的事实，新模块迁移前须重新抓原列hash并备份，不能拿这组数字当未来迁移保留证明。

## 隔离RED

cash_refunds_api报告已在随机test_cash_refunds_748fdd90ba12 schema观察真实HTTP新端点404（期望201）形成RED，夹具清理由CREATE成功与OID/owner保护。此报告待实现完成后的独立审查；不能代替运行库页面验收。

## 后续验收

协调器完整清单.superpowers/sdd/cash-refunds-acceptance.md；包括原收款三金额不改、Web部分退款→商户H5退剩额→顾客重读/SQL、重复及超额、未知结果原key恢复、权限、库存和CONFIRMED保留。跨日/跨品牌夹具只在隔离库做，不篡改源库交易时间。完整财务对账、导出、挂取单、交班仍在90项台账内单列推进。

## Task1 API已实现和独立审查

cad8697/6dcba7c，cash_refunds_api_review独立只读审查结论Spec compliant/Approved，无Critical/Important/Minor。报告docs/tasks/cash-refunds-api-report.md：专项10/10、原现金/领域10/10、预约7/7、付款期限8/8、规格10/10、编译HTTP6/6及tsc通过。010新增累计和退款凭证，原002 CHECK增量支持PARTIAL与全退闭单；新表默认明确UTC，直接SQL原28800秒偏移RED修复为0。原收款、菜品快照不改，退款不返库存、不释放CONFIRMED。

root核对PID29824 node dist/src/main.js并停止后，分两次明确授权generate，端口3000保持维护窗口。没有授权或运行源库010迁移。独立审查无法证明的源库迁移保留/真实页面/恢复闭环待root执行，不据此标新需求verified。

## 备份恢复额外缺陷，迁移前修复中

root重新检查保留脚本发现旧stable递归把Date视为空对象，旧before/after的“全部原列hash”不包含真正的时间值；原非时间字段证据有效，时间字段需补充，不能继续把原hash当完整时间保留证明。新010保留脚本已明确timestamp原文本/Date序列化，但尚未捕获迁移前基线。

为补足009前时间证据，root尝试恢复原备份backup_4f30126725837641927885debc7ec5be到全新随机库。两次（一次原CLI、一次只改诊断输出的副本）均摘要比较失败；仅本轮失败新目标由原安全清理删除，原备份、源库、旧恢复演练库未改。output/playwright/restore-summary-diagnostic.json显示schemas下全部行数/金额/库存/fingerprints一致，336约束仅ProductAttributeGroup_bounds_valid的嵌套AND括号在pg_restore重解析后展平，文本比较误判。不能通过删除约束比较或改manifest绕过，独立backup_constraint_fix按TDD修复中。完成审查和真实恢复后，再进行009时间对照及010备份迁移。

## 恢复修复及真实备份闭环

上述为发现缺陷时的状态。修复fe7b31e增加保守纯数据CHECK比较，仅规范化严格子语法中的AND结合括号，其他摘要与约束元数据保持精确比较；首轮专项33/33、补强29/29。独立backup_constraint_review发现JS Unicode空白会掩盖PG列名变化，e803338以真实RED修复为PostgreSQL ASCII空白，新增Unicode标识符实际语义/恢复负例，专项28/28。报告docs/tasks/backup-constraint-restore-fix-report.md；87ac91f后复审Spec compliant/Approved，无Critical/Important/Minor。没有执行manifest文本，也没有删除全部CHECK比较。

root随后使用原009前dump（SHA256仍72821b973e18465bfbf67830cc9d43cf7ec0282eaa956e6fadb67449e07c35c5）真实恢复成功，保留restore_faab27b9f1da6f6e22e053a0aeb15f21。脚本自动撤销恢复库全部非系统schema共29会话；源development8/public5会话未动。只读对照output/playwright/pickup-restore-original-columns.json使用服务端to_jsonb保留原时间精度，比对development/public43表、恢复后379条旧行，无旧行缺失，13张含时间表中221条可比行的时间值全部一致。恢复库Session按安全策略清空，不能将其视作原会话时间值对照。

仅有已记录后续业务变化：Q1超时关闭引起订单状态/预占释放、库存及slot held变更；Q4新quote/order/reservation/event与日序号递增，以及超时审计。未发现旧时间字段变化。此证据补足009前快照到当前的非Session时间保留，但不能倒推早期007/008所有时间值在当时已被哈希覆盖。旧证据文件保留，不重写历史。

## 010真实迁移和恢复运行

1. API暂停期间新脚本cash-refunds-migration-preservation.mjs保存43表399行全部原列基线，OID1114/1184保留原文本，Date显式ISO序列化，不复用更早时点。
2. 新备份backup_a7726b904c7e9fb00d3d00aa07ed7fa5，SHA256 96c71efe309373c9343017e5683da0dc8c6d752963745d709f3e173f3417d972；真实恢复到保留库restore_105b743a988118cb684a4af90e76f285。只读原列对照cash-refunds-prerestore-original-columns.json：43表、386条非Session原行全部一致，无时间差异/旧行缺失；Session恢复清空，源会话保留。
3. pnpm local:migrate exit0，仅development应用202610200010_cash_refunds；未reset/seed/切库。after比较43表399行全部原列（含时间）一致，preserved:true。CashRefund新表为空，旧7笔CashPayment.refundedFen均默认0；source13订单/7现金18900分/public4订单/development8会话保持。证据cash-refunds-migration-before/after.json及cash-refunds-migrated.json。
4. root fresh tsc exit0，pnpm local:api:start会话86816，监听PID28108，真实GET /api/v1/health返回200且database=connected。Prisma既有package.json配置弃用提示仍记入整分支审查，未声称输出无提示。

此处只完成Task1源库落地，不代表页面退款通过；UI任务和真实三端操作继续。

API重启后，root从已有Web浏览器会话执行真实只读请求：overview200，paidRevenueFen18900/refundFen0/netRevenueFen18900（requestId901147ce-a2ff-4621-a87b-2ef8732669e9），与SQL当日7笔现金合计一致。原Q0002订单详情200（requestId033da5e8-1a9b-4adf-a466-6677505a44f8），仍COMPLETED/PAID/NONE，原现金3080/5000/1920、累计0、净实收3080、明细[]。此为旧订单接口兼容读取，不是退款界面点击验收。

## Task2实现、独立审查与实际验收

实现0f5eb4d/报告a837194；cash_refunds_ui_review只读审查Spec compliant/Approved，无Critical/Important/Minor。共享行为95/95、Web22/22及Web/双mini H5/mp-weixin五构建通过，证据见docs/tasks/cash-refunds-ui-report.md。真实操作仅针对新建且备注可识别的A/B/C验收单，原13单及其7笔现金未退款。没有直接SQL写业务数据、seed/reset或删除旧备份/恢复库。

| 新单 | 入口与履约 | 原现金：入账/实收/找零（分） | 真实退款与最终事实 |
| --- | --- | --- | --- |
| A `cmvgtf24g00033mos4amdhahm`，R17925087327996F6C2E901B | 顾客H5小份菌菇饭+少辣+卤蛋；明日12:30–13:00，Q0005；Web收款 | 2180/3000/820 | Web退1分，商户H5退剩余2179分；2笔凭证，CANCELLED/PAID/SUCCEEDED，净0 |
| B `cmvgtn6rf000n3mosci263epq`，R1792509112058034FBE24C1 | 顾客H5鸡腿饭，即时Q0002；Web收款、制作、出餐、核销完成后退款 | 3080/4000/920 | Web退3080分；1笔凭证，保留COMPLETED/PAID/SUCCEEDED及原完成事件，净0 |
| C `cmvgtxcbn001d3moseq545q7n`，R17925095858264B2E142521 | Web收银创建1.23元商品，即时Q0003；商户H5退款 | 123/200/77 | 商户H5退123分；1笔凭证，CANCELLED/PAID/SUCCEEDED；Web收银“刷新现金凭证”显示全退、净0及订单关闭 |

A下单201 requestId046afdfa-c649-4fd8-a537-c33e9cb08296；收款201 dcfb0df6-e4f2-47dc-95ec-c05d53fe702a。B下单201 e754b933-fc44-4b8a-9d73-634ff016fcbe、收款201 79eb69dd-5d3f-4bc8-9371-c1e8f321bb9b；制作/出餐201 ae9da2eb-b05d-4d6b-b617-df152bb433f4 / d118462c-99a4-49b9-a4de-100be51fde01，核销201 475f96da-9ca9-4b84-a7dc-79dccbc03a62。C下单201 cce790f7-a3bb-40f6-9ac4-211db9fe3199，收款201 4c41ffea-53c0-4c79-8e14-e25bfb695704。

### 未知回执、慢写、断网与真实会话失效

- A Web退款真实抵达服务端并提交1分后，由浏览器网络路由丢弃回执。刷新触发原生beforeunload提示；接受刷新后自动发现并打开原单，恢复记录仍为unknown/1分。GET虽显示同一笔退款，仍要求“恢复原退款并核对结果”，没有自动清锁。离线GET显示网络失败并保留原尝试；恢复后显式POST与存储原key/金额/原因逐项相同，201 requestId4bd097d7-5761-4bc4-8723-6ca64470cb20；SQL新增退款0、事件0、审计0。
- A H5剩余退款真实201 requestId105877be-8995-4c44-af9c-0d5f6a7bddaa；拦截只延迟真实回执以检查期间门店、返回列表、刷新状态及全部底部导航均disabled=true，原尝试在POST之前已可靠存储且key/金额/原因一致。确认后记录才清除。
- B全退也在服务端提交后丢弃回执（201 requestId6562b616-fb81-4044-a21c-133a6f22fc72）；导航禁用，点击关闭仍保留详情。随后通过真实auth/logout撤销本人Web当前会话，再点击原订单读取，真实401使界面回到登录；原unknown/3080记录保留。通过页面“进入体验工作台”重新登录后自动发现原单，GET显示全退仍不解除unknown；原key/金额/原因显式重放201 requestId5946524c-afe4-40de-8b8d-470220d43365，SQL退款、事件、审计均无新增。未篡改会话期限或源交易时间。
- C商户H5首次POST在到达服务端前断网，随后GET也断网；恢复GET后旧错误清除，unknown原尝试完整保留、导航仍锁。显式原key/金额/原因恢复201 requestIdc113829b-94b7-4d11-8d99-697b2cd34ce0；2次浏览器发送中仅后一次抵达API，数据库仅1笔退款。此流程也实际复验了下述清错修复。

脚本output/playwright/cash-refunds-{web-lost-a,web-recover-a,mini-full-a,web-lost-b,expired-b,web-replay-b,mini-recover-c}.cjs。网络注入仅制造延迟/丢回执/失败，成功订单与退款均由真实API及数据库产生，没有用伪造成功响应代替业务。

### 金额、权限与无副作用拒绝

真实Web新表单金额初始空；不确认已交还现金时提交disabled=true。对B输入40.00、0、-1、0.001，分别出现超额/大于零/两位小数提示，未进入核对页，POST计数0。A实际1分钱成功，可退额按21.80而不是实收30元，找零没有重复扣减。

真实接口拒绝（直接请求用于检验服务端，不能替代页面验收）：CLERK403 FORBIDDEN，requestId47b5269a-0254-4452-a90c-f95119813a46；传湖滨店403，9c0556ab-d8fb-4c60-91dc-6b750c717f8d；0/-1/0.5分400 VALIDATION_ERROR；已全退再退1分409 REFUND_EXCEEDS_REMAINING，87a52d48-c87a-466a-a2aa-51287ba28858；A已关闭再accept409 STATE_CONFLICT，38e0a01a-9e1d-4761-99cc-62c71bbc34ae。CLERK页面能读B真实全退凭证，登记退款按钮数量0。拒绝后SQL仍15订单/9笔现金24160分/3退款5260分，详见cash-refunds-negatives.json；C此后才创建，不能把两个时点混用。

同key异载荷、不同key争最后余额、跨品牌/撤权、未收款/非现金及跨日净流出由已审查Task1隔离真实PostgreSQL/HTTP专项覆盖；未在源库伪造跨日时间、另一品牌或修改权限来凑验收。

### 只读SQL、凭证、刷新与重新登录

cash-refunds-sql-check.mjs在项目标记/loopback55432保护下使用REPEATABLE READ READ ONLY。cash-refunds-assert-snapshots.mjs比较每单收款后、退款前后的完整原现金字段（累计除外）、菜品快照、总价、状态、全商品/加料库存、全部预约及slot计数，要求每新增退款恰1事件和1审计；同时核对无关现金流水完全不变。以下均exit0：

- cash-refunds-assert-a-lost.json：1分，新增1退款/1审计；a-replayed：新增0；a-full：累计2180、2退款/2审计，未完成全退关闭。
- cash-refunds-assert-b-lost.json：累计3080、1退款/1审计，COMPLETED保留；b-replayed：新增0。
- cash-refunds-assert-c-full.json：累计123、1退款/1审计；原123/200/77未改。

A退款前后小份6/0、卤蛋2/0，以及slot4 held0/confirmed1与CONFIRMED记录均完全不变，退款没有返库存或释放预约。B/C同样对其各自收款后快照证明库存不变；不能用更早下单前库存当退款基线。

三端均真实读取A两笔及B已完成全退的金额、原因、时间；顾客退出后重新体验登录、重新进入B，仍COMPLETED、累计3080、净0。顾客实际GET200 requestId12d12f6b-8856-4ebd-87c5-edb880e58a6b，退款对象只有id/amountFen/reason/createdAt，不含staffId/key/hash。

B完成时overview200 requestId581afdaf-5c1c-4880-a37f-a1583fee0cea：24160入账/5260退款/18900净。C后最终SQL为development16订单/10现金24283分/4退款5383分、净18900，public4订单、development8会话。最终overview200 requestIdc2eccde0-1144-4d66-bfd0-75c09f88ecae同为24283/5383/18900，订单16。原历史7笔现金除各自新增累计0字段外保持；旧Q0002最初只读兼容已在上节记录。

### 页面发现项、修复及复验

1. A离线GET后恢复读取时旧NETWORK错误残留；d5e71b2在当前上下文有效GET完成后清旧error，不解除unknown锁。新增行为测试先RED后GREEN，专项15/15；C真实复验显示alerts=[]、原attempt完整保留、导航仍disabled，原请求恢复后才清记录。
2. 商户详情旧“现金收款凭证”与新组件重复原三金额；同提交移除旧块，唯一完整CashReceipt放应收下方。C实际现金凭证数量1、旧标题数量0，原三金额/明细完整。fbe9a0c报告后cash_refunds_ui_review复审Spec compliant/Approved，无问题。

最终root fresh运行node --test packages/mini-core/tests/*.test.mjs：96/96、0 fail、exit0；对应Web22/22及五构建证据在实现报告，修复后merchant-mini H5/mp-weixin又分别通过。最终三端现金凭证可见文字计算字号最小14px，无小于14；输入原生标签和reduced-motion按实现/审查保留。查看截图cash-refunds-cashier-full.png、cash-refunds-customer-completed-full.png、cash-refunds-merchant-c-full.png，已实际目视检查。截图在忽略的output/playwright目录，不含密钥。

运行服务曾两次出现uni开发服务缓存旧共享模块（首次refundAmount导出缺失，修复后服务仍返回旧load实现）。root分别核对自有merchant5175进程再精确重启，并从实际服务内容/页面复验确认新代码。API未因此停止。自动化过程中有错误定位名称、uni子span被父按钮拦截和HMR重置造成的等待超时，改用实际入口/父按钮重试；这些失败不标通过。登录撤销脚本首次将浏览器fetch Response.status误用为函数，撤销已实际发生；修正后继续检查真实登录失效与原请求恢复，没有重发退款造成重复。

## 本模块边界

现金退款子能力implemented/executed/verified_local成立，productionVerified=false。完整REQ-011财务对账/导出、REQ-015服务端挂取单、REQ-087班次关联、REQ-090交班仍未完成；不能将本模块当90项整体交付。微信登录/原路退款、真机和生产未配置或验证。sessionStorage/uni存储被用户清除后的恢复范围、损坏恢复记录需人工核对等限制见实现报告，不能声称永久跨设备退款恢复。后续按已准备挂单取单计划继续。
