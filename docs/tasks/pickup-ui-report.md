# 预约自提三端 UI — Task 2

Status: DONE_WITH_CONCERNS，三端与 shared 实现和本地行为/构建验证完成，供独立审查。真实浏览器交易、SQL、重新登录持久化、微信真机与生产验收未由本实现者执行；REQ-007/008 不在本报告中标记已验收，productionVerified=false。

派发基点 537cf2f，分支 codex/restaurant；实施期间协调器文档推进至 6e99e52。唯一任务来源 `.superpowers/sdd/pickup-ui-brief.md`，已读 Task1/API 报告、商品选择报告、实际 API 合约、开发规范与现有恢复/隔离逻辑；项目及父目录未发现适用 AGENTS.md。使用 test-driven-development、frontend-design、verification-before-completion；出现商户模板编译失败时使用 systematic-debugging 定位精确标签语法。

## 提交

实现提交：`6661112` — `feat: add pickup scheduling and verified collection across clients`，显式暂存 21 个本任务文件。本文档另行提交以记录该确定提交号，最终交接给出文档提交号。没有包含协调器 README/config/requirements/progress/acceptance/research、API/schema 或遗留 review diff。

## 实现与接口

- Web 独立 PickupSettings.vue，由主导航「预约自提」进入；商户 mini 独立同名组件，由「门店」页进入。沿用门店绿色 #35664a、浅绿 #f3f8f4、文字与边框层次，不引入新字体依赖；时段表与预览按真实窗口逐行排列，新文字至少14px。
- 两端 GET `/merchant/pickup-policy?storeId=…` 与日期范围 GET `/merchant/pickup-slots?storeId=…&from=…&to=…` 读取。OWNER 明确 PUT 政策开关、提前0–1440分钟和最远1–90天；缺政策只显示待保存草稿，由 OWNER expectedRevision=0 首次 PUT 初始化，GET 不写数据。CLERK 可读，所有编辑控件禁用且写入口受 canEdit 限制，最终权限仍由 API 判定。
- 日期、起止、间隔、容量生成完整预览，展示日期/起止/容量/总数，再显式 POST 批量创建。校验真实日历、同日递增、5–240分钟、每批最多96段、容量1–1000；不能整除的尾段不静默截断。提交 ISO 始终为有秒的 `YYYY-MM-DDTHH:mm:ss+08:00`。原时段仅 PATCH 容量/启停及 expectedRevision，没有修改已成立窗口入口。
- 时段真实 capacity、heldCount、confirmedCount、remaining 与原启停状态独立于 draftCapacity/draftEnabled；编辑输入不伪装成已保存余量。容量下限为 max(1,held+confirmed)，明确关闭不影响既有订单、完成后的确认仍计容量。
- 经营写入成功后必须再次真实 GET。STATE_CONFLICT、超时、网络及未知服务端错误都锁住后续写入与切店/导航/关闭；失败重读保留锁与原草稿。成功重读将原政策/时段编辑/创建预览放入「上次提交 / 重读前草稿」供核对；未知创建恢复后清当前提交预览，必须重新生成，已有时段不得再次创建。没有自动重发无自然键批次。
- 顾客及 Web 收银独立 PickupSelection.vue，PICKUP 下可明确选「尽快取餐」或日期时段。公开 GET `/stores/:storeId/pickup-slots?date=YYYY-MM-DD` 只用真实可选窗口/remaining，POST `/quotes` 仅附可选 pickupSlotId，不回传内部版本。选择保存在原门店作用域，沿用原购物袋与恢复机制，没有另一份未隔离购物袋。
- 更换时段清报价；重新读取发现原时段消失或读取失败时保留原预约、清可编辑旧报价并要求重新核对，不默默改即时。PICKUP_SLOT_FULL/PICKUP_RULES_CHANGED/PICKUP_TIME_UNAVAILABLE 清已明确拒绝创建的报价/pending并要求重读。超时、权限及其他不确定创建继续保留原报价/幂等键/现金冻结金额；不能切换成新交易。
- 取餐窗口始终按门店 Asia/Shanghai 展示，与浏览器默认时区无关。报价显示服务端 pickupWindow；三端订单详情与订单列表、收银结果显示订单原窗口/取餐号/履约日期。旧单 null 字段显示「旧订单」与原号码，不补造预约或重新编号；旧10位号码原样显示和提交。
- Web/商户 mini 独立 PickupRedemption.vue；READY且PAID的PICKUP动作进入输入顾客号码的表单。真实 POST `/merchant/orders/:id/pickup` `{storeId,pickupNumber}` 后 GET `/orders/:id`，更新当前订单及重读列表；连续点击仅一次POST。错号保留输入及requestId，状态变化或未知结果锁定重复写入，先真实重读订单。既有通用API未改，堂食/外送原流程保留。
- 两商户端 PickupSearch.vue 按完整号码和履约日期查本店订单。现有 GET /orders 无取餐号服务器谓词，shared 顺序读取已授权 storeId 的分页（每页100、最多20页），完成才原子展示全部匹配；失败/超限不展示局部匹配，切店/卸载忽略晚响应。老单按下单日筛选并明确标注。此处2000单限制见下方 concerns。
- 新 mini 文本输入复用现有 AccessibleInput，H5 标签唯一且聚焦真实input，微信分支不依赖浏览器DOM。经营/核销组件使用 busy/blocked 与卸载 epoch；Web有beforeunload，mini有返回拦截，组件卸载不会将晚响应写入新作用域。

## RED / GREEN 证据

1. 在实现模块前新增 `pickup.test.mjs`，动态导入缺失模块后以真实功能断言运行 `node --test packages/mini-core/tests/pickup.test.mjs`：RED exit1，9项0通过/9失败；失败均为缺少 createPickupSelection/Manager/Redemption、preview、错误分类导出的 `undefined !== function`。不是以加载中断冒充RED。实现后同9项全部GREEN。
2. 未知批量创建成功重读后仍留可直接再次提交预览：先加用例，同命令RED 9/10，actual仍有slot vs expected `[]`；修正为保留比较草稿并清待提交预览，GREEN 10/10。
3. 先增加完整授权分页查号与失败不能发布部分匹配两项：RED 10/12，createPickupSearch缺失；实现bounded扫描/epoch后GREEN 12/12。
4. 自查发现公开重读时段消失后旧报价仍在：先加消失时段测试，RED 15/16，`'q' !== null`；保留selection并通知清可编辑报价，原冻结订单不受影响，GREEN 16/16。
5. 自查未知服务端新错误代码：先加NEW_SERVER_FAILURE用例，RED 16/17，blocked `false !== true`；改成只有明确拒绝代码才允许继续，其余错误保守锁定，GREEN 17/17。
6. 共享用例另覆盖只读无写入、成功PUT但确认GET失败保持锁、scope dispose、容量/日期/时段边界、旧号核销、连续点击、未知核销先重读、2000单上界与失败不显示部分匹配。顾客实际useCustomer状态测试（隔离uni.request transport stub）补两项：真实报价携slotId、满额拒绝保留旧选择且显式改即时后才省略slotId；未知预约创建恢复后时段已不可选仍使用原quote/key恢复。

## 最终验证

全部读取命令完成输出，没有将行为测试视为实际微信/生产完成：

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @restaurant/mini-core test` | exit0，78/78，0失败/跳过；其中pickup17项、顾客预约集成2项 |
| `pnpm --filter @restaurant/merchant-web test` | exit0，20/20，0失败/跳过，原收银恢复/付款冻结回归通过 |
| `pnpm --filter @restaurant/merchant-web build` | exit0，vue-tsc + Vite，1635模块 |
| `pnpm --filter @restaurant/customer-mini build` | exit0，H5与mp-weixin均 `DONE Build complete` |
| `pnpm --filter @restaurant/merchant-mini build` | exit0，H5与mp-weixin均 `DONE Build complete`；AccessibleInput使用明确modelValue绑定后又完整执行同命令通过 |
| `git diff --check` / `git diff --cached --check` | exit0 |

构建首轮Web类型诊断为shared默认onChanged推断无参数，明确默认参数后vue-tsc通过；商户mini初轮精确报index.vue新入口闭合处`Illegal '/' in tags`，修正自闭合标签后两目标通过。最终构建仅有既有uni版本更新/托管提示。临时pnpm dlx prettier@3.6.2只格式化本任务指定文件，未修改依赖或锁文件。

生成的双方微信Pickup组件及商户AccessibleInput.js，使用精确单词模式检查，未发现 `window` / `document` / MutationObserver / beforeunload。初次宽泛大小写不敏感搜索匹配到pickupWindow字段，改为单词边界后确认无DOM辅助逻辑。

只读HTTP曾发现5174、5175的 `/node_modules/@restaurant/mini-core/src/index.mjs` 均200但缺新导出，已向协调器提供端口/内容证据，未自行stop。协调器精确重启后，本实现者重读两端均包含createPickupSelection、createPickupManager、createPickupSearch。

## 变更文件

新增：
- packages/mini-core/src/pickup.mjs、tests/pickup.test.mjs
- apps/customer-mini/src/components/PickupSelection.vue
- apps/merchant-mini/src/components/PickupSettings.vue、PickupRedemption.vue、PickupSearch.vue
- apps/merchant-web/src/PickupSettings.vue、PickupSelection.vue、PickupRedemption.vue、PickupSearch.vue
- 本报告

调整：
- packages/mini-core/src/index.mjs、tests/customer-selection.test.mjs
- apps/customer-mini/src/customer.js、pages/index/index.vue
- apps/merchant-mini/src/merchant.js、pages/index/index.vue
- apps/merchant-web/src/App.vue、Cashier.vue、Orders.vue、domain.mjs、types.ts

## 自查 / 限制 / 后续

自查对照了旧订单null窗口/旧号、门店和身份隔离、未知创建原key恢复、实际余量与编辑草稿分离、批量未知无重发、缺政策显式初始化、配置关闭后原订单履约、READY/PAID核销、错误requestId、固定时区、微信编译及H5表单可访问性。无实现阻塞，没有直接读写development数据库，没有造单、收款、seed/reset或改经营政策；协调器保留的源8订单/5现金12740分/public4与备份/恢复库均未触碰。

Concern：查号目前最多扫描20页/2000笔授权门店订单，超过时明确报不能完成全量筛选，不能保证大规模实时一致检索。应后续独立给GET /orders增加storeId+pickupNumber+pickupServiceDate服务器谓词；分页期间有并发新订单也可能改变页边界，必要时重新查询。协调器已知并接受将此列作限制，没有以当前页筛选掩盖缺口。

实际页面/SQL验收由协调器继续：Web建时段→H5重读→顾客预约→现金→制作/出餐→正确及错号核销→顾客刷新；最后名额竞争、取消/实际15分钟到期释放、关闭或版本变化旧报价、跨用户/跨店、离线未知恢复、旧号、重新登录持久化。没有AppID/支付/域名/生产资源，未声称微信真机或生产已验证。

H5日期真实操作入口：顾客购物袋「取餐时间」内「预约日期：YYYY-MM-DD⌄」和商户「门店→预约自提」内「查看 / 新增日期：YYYY-MM-DD⌄」均为uni `picker mode=date`，点击后使用真实年月日列与确认按钮；Web为原生label「查看 / 新增日期（北京时间）」+date input。本实现者未访问浏览器DOM，因此不提供未验证的DOM selector，也没有Vue状态注入或隐藏快捷入口。

## 2026-10-20 查号规模修复（独立审查 Important）

Status: DONE，实现及隔离验证完成，待协调器独立复审与真实页面验收。本节替代上文“2000笔全历史扫描”的实现及 concern；未标记 REQ-007/008、微信真机或生产验收完成。

需求来源 `.superpowers/sdd/pickup-search-fix-brief.md`，派发基点 `011eacc`。使用 systematic-debugging、test-driven-development、verification-before-completion；唯一实现者，没有另派子代理。实现提交 `27b6342`（`fix: query pickup orders by scoped number and service date`），Git身份 Codex / codex@local.invalid；本文追加报告单独提交。

### 根因与 API 合约

原 shared 为查完整号码扫描门店全部历史订单，每页100、最多20页。即使目标在首页，total>2000也拒绝，因此规模上限依赖无关历史数据。

GET `/orders` 现在接受可选配对字段 `pickupNumber` 和 `pickupServiceDate`，查号须明确 `storeId`。号码先 trim、转大写，支持 `Q` 后至少4位数字（包括 `Q10000`）或原10位十六进制，最长100字符；日期须为真实 `YYYY-MM-DD`。缺配对、空值、非法字符串、数组/对象（包括重复 query 和 bracket 字段）返回400 VALIDATION_ERROR。无权门店返回403，逐请求读取有效身份、当前门店授权和门店品牌。顾客仍保留原 userId 边界，传入其他 userId 不能覆盖。

数据库 where 在授权范围内叠加 `mode=PICKUP`、完整号码相等以及日期 OR：新单使用 `pickupServiceDate`；旧单该字段为 null 时，使用 createdAt 的上海当天 `[00:00, 次日00:00)`。没有迁移、没有更新旧号或订单。原无此配对的普通列表兼容，返回仍为 `{items,total,page,pageSize}`，每页最多100，排序增加 `createdAt DESC,id DESC` 确定性次序。

两商户组件沿用同一 shared，直接发送服务端谓词，只翻页匹配集。shared 逐页校验 total/page/pageSize、预期数量和唯一ID，全部匹配读取后原子发布；中途失败、总数改变、重复项或不完整页均不展示局部结果。移除20页/2000历史单门槛，保留原 scope generation、clear、切店/卸载晚响应隔离与 requestId 反馈；查询提示明确“该日期与号码”的匹配页。组件样式及14px未改。

### TDD RED / GREEN

- 先改 `packages/mini-core/tests/pickup.test.mjs` 再运行 `node --test packages/mini-core/tests/pickup.test.mjs`：RED exit1，18项15通过/3失败。实际 query 缺 pickupNumber/date 导致两页调用数 `1 !== 2`；2001历史回归 `false !== true`；不完整页误标完成 `true !== false`。实现后同命令 GREEN exit0，18/18。
- 在已有安全 runner 的 `pickup-capacity.test.ts` 增加真实HTTP与数据库夹具，2001笔无关本店历史单、明确新号/日期、其他店/日/用户/模式、旧号上海 UTC 跨日边界及104笔碰撞。夹具初轮违反已有日期/序号配对约束，修正夹具后才确认功能性 RED；未把夹具异常算作功能失败证据。
- 功能 RED：`node apps/api/tests/pickup-runner.cjs` exit1，7项6通过/1失败，精确断言 `server predicate must exclude >2000 unrelated histories`，实际 total `2119 !== 2`。服务端实现后同命令 GREEN exit0，7/7；输出 `Lookup SQL: 2001 unrelated histories; exact new/legacy lookup, Shanghai half-open boundaries, 104 collisions, permissions and malformed queries passed`。
- HTTP case 还验证 OWNER/CLERK、跨店403、移除授权后的实时403、顾客只看本人、伪造 userId 无效、完整新号与旧号大小写、缺配对/日期非法/重复字段/bracket对象400、无谓词普通列表200、相同createdAt时按id稳定分页，以及全部夹具订单在查号前后完全一致。
- shared 回归覆盖真实 query、新号超过4位、匹配集多页全部发布、2000以上无关历史不影响、第二页TIMEOUT保留requestId且零局部结果、不完整页/元数据拒绝、无完整号不发请求、clear/切店/卸载晚响应忽略；原选择、核销及顾客实际集成用例继续通过。

### 完整验证

| 命令 | 结果 |
| --- | --- |
| `node apps/api/tests/pickup-runner.cjs` | exit0，7/7；使用随机 `test_pickup_40e50ead2ab3`，应用8个既有迁移，结束按schema身份校验清理；迁移兼容与碰撞sentinel保护也通过 |
| `pnpm --filter @restaurant/mini-core test` | exit0，79/79，0失败/跳过，含pickup18项和原顾客预约集成 |
| `pnpm --filter @restaurant/merchant-web test` | exit0，20/20，0失败/跳过 |
| `pnpm --filter @restaurant/api exec tsc -p tsconfig.json` | exit0；仅tsc，未运行API build、prisma generate |
| `pnpm --filter @restaurant/merchant-web build` | exit0，vue-tsc + Vite，1635模块 |
| `pnpm --filter @restaurant/merchant-mini build` | exit0，H5及mp-weixin均 `DONE Build complete` |
| `pnpm --filter @restaurant/customer-mini build` | exit0，H5及mp-weixin均 `DONE Build complete` |
| `git diff --check` / `git diff --cached --check` | exit0；仅Git既有换行转换提示 |

uni 构建只有既有升级/托管提示。API dist 已编译，已通知协调器精确重启3000；实现者没有控制源进程，也没有在源页面造单、收款或执行写入。

### 文件、自查与限制

实现提交仅7个文件：`apps/api/src/modules/orders/orders.service.ts`、`apps/api/tests/pickup-capacity.test.ts`、`packages/mini-core/src/pickup.mjs`、`packages/mini-core/tests/pickup.test.mjs`、两商户 `PickupSearch.vue`、`docs/architecture/api-contract.md`；加本报告为本次完整变更。显式暂存自身文件，未包含协调器 acceptance 等未提交内容，也保留两个旧 reviewdiff。

本次所有 SQL 夹具与 seed 均在 runner 创建的安全随机 `test_pickup_*` schema，模块入口先拒绝 development/public/缺schema；未向源 development/public 写数据、seed/reset、改变会话或备份/恢复库，未改金额/预约/库存/历史订单/旧10位号码，没有退款扩展。

匹配集仍沿用API已有page<=10000上限（每页100），达到API分页能力上限还未完整时明确报错且不发布局部项；这与无关历史总量无关。跨请求分页采用稳定排序，匹配数量变化、重复或缺项会拒绝发布并要求重查，不提供数据库长事务快照。真实浏览器、重新登录、微信真机与生产验证继续由协调器负责，未将隔离测试或构建当作该类验收。
