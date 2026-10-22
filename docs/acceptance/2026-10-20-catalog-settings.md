# 分类与单位本地验收

日期：2026-10-20。源码提交：API `b667f2c`、修复 `e7526b8`、双端界面 `857deb7`。API 与界面均经过独立规范/质量审查，结果 Approved。范围为真实 PostgreSQL development、API3000、电脑端5173、商户H5 5175、顾客H5 5174；不包含微信开发者工具、真机、真实微信支付或生产部署。

## 实际页面操作与结果

| 操作 | 真实结果 |
| --- | --- |
| Web 新建“验收分类·时令饭”“验收碗”，再创建“验收新品·菌菇饭” | 三次POST均201；商品18.80元、库存9；列表和SQL关联真实分类/单位 |
| 商户H5重新读取并修改该商品描述，Web重新读取 | PATCH200；两端描述一致；H5商品名称标签精确定位唯一，点击后原生input聚焦 |
| H5将“验收碗”改为“验收大碗” | PATCH200；H5父商品列表自动重读，Web刷新后同步；既有SKU身份/库存保留 |
| Web停用单位、编辑原商品描述、新开商品表单 | 原单位显示“保留原单位”；PATCH200且实际请求省略unit、unitId、skus；新商品单位选项只有杯、份；随后恢复单位 |
| 删除仍有商品引用的单位 | DELETE409 REFERENCE_CONFLICT；表单名称保留，提示先调整商品或停用，包含requestId |
| H5切湖滨，真实picker选择分类/单位，创建“验收手机·湖滨菌菇饭” | POST201；18.80元、库存7；商品归湖滨，引用同一品牌分类/单位 |
| Web将分类设为仅梧桐里可见，顾客切湖滨刷新 | 原先可见的分类及湖滨新品同时消失；公开菜单确实遵守门店范围 |
| Web不选任何可见门店，再恢复全店 | 空数组显示“全部隐藏”；恢复null后湖滨顾客重新看到分类/商品；排序持久化为8 |
| 顾客真实选湖滨新品并报价，Web停用分类，再提交旧报价 | 报价201；下单409 CATALOG_CHANGED，提示分类停用或本店隐藏并附requestId；SQL订单数未增加 |
| 停用后顾客刷新，Web恢复分类，顾客再报价 | 菜单隐藏；恢复后报价201；验收后清空该购物袋，未额外收款或创建订单 |
| 创建临时分类，将A商品迁入后尝试删除，再迁回 | 有引用DELETE409；迁回后空分类DELETE200，实际商品PATCH改变categoryId；空单位DELETE200，刷新无记录 |
| 两Web页面读取同一单位版本，先后保存 | 第一保存成功；第二409 STATE_CONFLICT、保存按钮锁定；明确“重新加载并核对”后读到最新数据，再保存恢复原名称 |
| Web新建商品时让真实API提交成功，再中断返回 | 后端201，客户端提示结果未知并锁定保存；POST仅1次；重读真实GET products后关闭编辑供核对，列表/SQL仅1条“验收响应·仅一次”，1.23元、库存2 |
| 商户H5新建单位，让真实提交完成后延迟响应 | 等待期间busy-mask显示、全部4个底部导航、切店、取消均disabled；放行真实201后成功；之后通过H5真实DELETE200删除临时单位 |
| Web离线刷新设置，再恢复网络重读 | 清楚显示连接失败/重试；联网后重新读到单位，无假成功 |
| Web通过真实体验店员登录读取，直接越权请求新增分类 | 只读提示，无新增/编辑入口；后端403 FORBIDDEN；没有创建“越权应拒绝”分类 |

所有分类/单位/商品写操作来自真实页面，不以伪造接口成功替代数据库结果。响应丢失和慢请求通过Playwright的route.fetch发送真实请求后故障注入；未stub成功响应。越权请求使用页面实际会话，未在报告或输出中打印令牌。

## SQL重新查询

最终“验收分类·时令饭”：enabled=true、revision=5、sort=8、allStores=true、可见性映射空（全店语义）、商品引用3。最终“验收大碗”：enabled=true、revision=5、引用3。

| 新增验收商品 | 门店 | 价格分 | 库存 | 预占 |
| --- | --- | ---: | ---: | ---: |
| 验收新品·菌菇饭 | 梧桐里 | 1880 | 9 | 0 |
| 验收手机·湖滨菌菇饭 | 湖滨 | 1880 | 7 | 0 |
| 验收响应·仅一次 | 梧桐里 | 123 | 2 | 0 |

A新品SKU持续为`cmvgjl8io000a3mjkrs3u2cs6`，没有因改描述、单位停用或分类迁移重建。临时分类、空单位及慢请求单位均已通过真实页面删除，审计保留。分类审计CREATE2/UPDATE5/DELETE1；单位CREATE3/UPDATE5/DELETE2。商品仍引用真实Unit关系，非只修改展示文本。

独立SQL与保留恢复库对照：原有development订单5笔、现金3笔合计8380分、原“验收菜品·桂花鸡腿饭”priceFen3080/stock14/reserved0、CMS标题“一餐好饭，认真现做”、public历史订单4笔均一致。源库会话从27变为28，来自本轮真实店员登录；恢复库会话仍0，未切换数据库。新增商品/配置/报价/审计是本轮明确的验收数据，不声称整库未变化。

## 自动化、构建及过程记录

API专项6/6及领域/员工/初始化/隔离HTTP回归证据见[catalog-admin-report](../tasks/catalog-admin-report.md)。本次界面共享行为29/29（其中目录与商品11项）、Web18/18、Web构建和两小程序H5/mp-weixin四种构建均实际退出0，RED→GREEN及准确命令见[界面报告](../tasks/catalog-settings-ui-report.md)。独立审查没有Critical/Important；Minor为uni构建自带更新/uniCloud提示的输出噪声，记录待后续构建配置处理。

浏览器曾持有mini-core旧导出缓存，商户H5全刷后无法启动；调查确认HTTP源码含新导出而浏览器使用旧版本。只重启本项目5175进程并禁用该验收页HTTP缓存后恢复，API/数据库未停止或重置。验收定位中修正了getByLabel对Web select的匹配、uni-button/uni-label自定义元素、picker移动端滚轮及刷新完成前点击时序；这些脚本定位失败未冒充业务通过。顾客最初堂食未选桌号的报价400给出明确错误，改为实际自取后完成上述201→409→201链路。

慢请求锁定断言及截图先完成，清理点击遇父列表尚在重读而未打开编辑器；等待刷新结束后重新点击并真实删除200。没有重新发送原创建请求。

证据位于被Git忽略的`output/playwright/`：catalog-created-web.png、catalog-read-merchant.png、catalog-created-h5.png、catalog-hidden-customer.png、catalog-old-quote-rejected.png、catalog-version-conflict.png、catalog-product-unknown.png、catalog-mini-busy.png、catalog-clerk-readonly.png、catalog-offline.png。相邻catalog-*.cjs为本次操作脚本，catalog-sql-check.mjs与backup-sql-check.mjs为SQL复查，不输出令牌。

REQ-030/031可标记已编写、已运行、已本地验证；productionVerified始终false。品牌模板、规格组合、口味属性、加料编辑与导入仍未完成，继续既有全90项范围。
