# 餐饮多端主题与模块热插拔设计稿

日期：2026-10-21
状态：用户已确认方案 B，本稿等待书面规格审阅
适用项目：同一品牌多门店餐饮系统
依据：docs 截图、D:\\Codes\\开发规范.txt、现有总体设计、三端实现与开源调研
调研原始记录：data/research/experience-config-sources.json

## 1. 目标

本规格为现有顾客小程序、商户小程序和电脑后台增加统一的视觉主题与业务模块开关。发布主题或开关模块不需要重新提交小程序审核，也不允许后台向客户端下发任意页面、组件、脚本或 CSS。

交付结果包括：

- 四套可区分餐饮品牌气质的预设主题：现代餐桌、黑标餐厅、鲜活青春、手绘食堂。
- 品牌默认主题和三端独立覆盖；用户小程序、商户小程序、电脑后台可以选择同一主题或不同主题。
- 允许品牌管理员覆盖品牌色、Logo 和圆角强度；所有可覆盖值在发布前校验。
- 以可信编译期注册表声明模块、目标端、依赖、权限、导航位置和生命周期规则。
- 品牌按端设置模块默认状态，门店可覆盖非必需模块。
- 发布后客户端在下一次启动、回到前台、切换门店或主动刷新时取得新配置，无需替换小程序代码包。
- 配置保存、预览、发布、版本历史、审计和回滚；历史发布内容不可原地修改。
- 网络失败、旧客户端、错误配置、门店差异和进行中订单均安全降级。

## 2. 非目标与明确边界

- 不通过后台切换四套完全独立页面。所有业务页面共享组件和状态逻辑，主题通过语义令牌、有限样式变体和固定资产包实现。
- 不引入完整的多套组件库。当前自研组件继续作为业务界面主体，避免 TDesign、Vant、Wot UI 和 NutUI 混装造成包体、事件、样式与可访问性冲突。
- 不允许配置 schema 指定组件路径、JavaScript、外链样式、任意 HTML 或原始 CSS 属性。
- 不提供门店级主题覆盖。主题作用域是品牌默认加端级覆盖；门店只覆盖模块状态。
- 不承诺所有在线用户在同一秒切换。热插拔定义为服务端发布后无需新版本代码，客户端下次配置同步时生效。
- 不使用 AppID、支付、真机或生产资源伪造验收。微信开发者工具和真机验证继续作为独立门禁。
- 不自动修改或回填历史订单、现有页面内容、现金账本和门店业务数据。

## 3. 截图与现有界面的设计承接

用户小程序继续围绕门店选择、点餐、订单和个人中心；商户小程序继续突出待处理订单、经营数据和快捷工具；电脑后台继续采用侧栏经营分组和密集表格。现有截图中的绿色主色、暖白底色、橙色操作强调、快捷入口和经营图表是“现代餐桌”主题的基线。

主题不会改变业务信息顺序、金额语义、权限和支付反馈。它改变颜色、字体层级、圆角、边框、阴影、图标装饰和范围受限的动效。四套主题在 390px 宽度移动端和 1440px 桌面端都必须保持标题、正文、金额和状态清晰。

## 4. 四套语义主题

| 预设 ID | 名称 | 主色 | 画布与表面 | 强调色 | 视觉性格 | 默认动效 |
| --- | --- | --- | --- | --- | --- | --- |
| MODERN_TABLE | 现代餐桌 | 深松绿 #1F5E4A | 暖白 #FBF8F1 / 白 #FFFFFF | 熟番茄 #C95332 | 自然、清晰、信息密度适中，适合正餐和咖啡 | CALM |
| BLACK_LABEL | 黑标餐厅 | 炭黑 #1B1A18 | 象牙白 #F6F1E7 / 白 #FFFFFF | 香槟铜 #B38A4A，酒红作状态点缀 #6D1E2B | 克制、精致、低圆角、强留白，适合高端餐厅 | CALM |
| FRESH_YOUTH | 鲜活青春 | 电光蓝 #175BE6 | 冰蓝 #F3F8FF / 白 #FFFFFF | 草莓粉 #FF5C8A，青柠用于非文字装饰 #B6F36B | 明快、活泼、大按钮、高对比标签，适合茶饮快餐 | SPRING |
| DOODLE_CANTEEN | 手绘食堂 | 深墨 #2E302A | 奶油黄 #FFF4D6 / 白 #FFFFFF | 南瓜橙 #E65A24，薄荷青 #69D3C5 | 2px 描边、偏移阴影、宽圆角，适合亲子与社区餐饮 | PLAYFUL |

“黑标餐厅”的黑色主要作为侧栏、页头或高强调容器，不把全站改成低可读性的纯黑。“手绘食堂”使用固定发布的内联图形或本地资产，不依赖外部字体绘制。

### 4.1 语义令牌

所有端使用前缀 rs- 的语义变量。固定主题在构建时提供完整值；远端只选择固定预设和少量经过校验的覆盖项。

| 令牌类别 | 必需令牌 | 规则 |
| --- | --- | --- |
| 品牌色 | color-brand、color-on-brand、color-accent、color-on-accent | 默认预设完整提供；品牌只覆盖 color-brand 和 color-accent |
| 表面 | color-canvas、color-surface、color-surface-subtle、color-overlay | 必须保证正文、边框和浮层对比度 |
| 文字 | color-text、color-text-muted、color-text-inverse | muted 正文仍不小于 14px，并在画布上满足 4.5:1 |
| 状态 | color-success、color-warning、color-danger、color-focus | 同时配图标或文字，禁止只靠颜色传意 |
| 圆角 | radius-control、radius-card、radius-sheet | 由 radiusScale 推导并限制在安全范围 |
| 间距 | space-1 至 space-8 | 采用固定比例，不允许远端传任意数值 |
| 字体 | font-body、font-display、text-xs 至 text-display | 移动端继续使用系统字体栈，正文与辅助文字实际显示不小于 14px |
| 动效 | motion-fast、motion-base、motion-slow、easing-standard | 只作用于 opacity 和 transform 等合成属性 |
| 控件 | touch-target、focus-ring、control-height | 主触点最小 44px，管理端桌面主控件高度不小于 40px |

现有 CSS 中的 primary、ink、paper 等变量迁移为 rs- 语义变量，并保留短期兼容别名，直到三端全部切换并通过回归。CSS 类只消费语义令牌，不直接读取后台颜色。

### 4.2 品牌覆盖

品牌级配置包括：

- defaultTheme：四套固定预设之一。
- logoUrl：可选 HTTPS 地址，必须属于部署配置中的可信图片域名；空值显示品牌首字标。
- primaryColor：可选十六进制颜色；服务端用白或深色前景计算最高对比度，仍不达标则拒绝发布。
- accentColor：可选十六进制颜色，规则同主色。
- radiusScale：0 至 1.5；0 为直角，1 为预设原始圆角，1.5 为上限。

色值覆盖不改变成功、警告、危险三个语义色的原始对比要求。后台预览即时显示对比度结果，并明确提示不达标的文字或控件；不达标的草稿可以保存，但不能发布。Logo 只进行 URL、协议、域名、文件扩展名和尺寸展示约束，不在服务端主动抓取远程图像，避免 SSRF。

### 4.3 主题继承

解析顺序固定为：

1. 编译内置安全默认令牌。
2. 已发布品牌默认主题。
3. 当前端的主题覆盖；未覆盖时继承品牌默认。
4. 当前端的品牌色、Logo、圆角覆盖。
5. 设备级“减少动效”偏好，只能减少动画，不能增强动画。

主题选择按端保存为 INHERIT 或 PRESET。INHERIT 不是保存当前主题快照，而是在运行时引用品牌默认，因此品牌默认以后变化时继承端也会更新。

## 5. 动效系统

动效档位是 CALM、SPRING、PLAYFUL，品牌可设置默认档位，端可覆盖。

| 场景 | CALM | SPRING | PLAYFUL |
| --- | --- | --- | --- |
| 页面或标签进入 | 120ms 淡入加 4px 位移 | 180ms 淡入加轻微回弹 | 220ms 淡入加 6px 位移 |
| 加购反馈 | 120ms 压下 | 160ms 数字缩放 1.05 | 220ms 数量图标轻弹一次 |
| 底部面板 | 180ms 平滑上移 | 240ms 柔和回弹 | 280ms 上移，遮罩轻微缩放 |
| 成功反馈 | 图标淡入 | 图标弹入 | 图标和一条短装饰线进入 |
| 列表逐项出现 | 不使用 | 最多 4 项错峰 | 最多 6 项错峰 |

关键金额、支付状态、错误和权限界面不使用持续动画。动画只改变 opacity、transform 和颜色，不改变布局尺寸；列表动画有数量上限。H5 和电脑端遵守 prefers-reduced-motion；小程序提供设备本地“减少动效”设置，并在运行时支持媒体查询时同步系统偏好。减少动效时保留即时颜色和文字反馈，取消位移、弹跳和错峰。

## 6. 模块注册表

### 6.1 注册表是代码的一部分

模块定义包位于 packages/experience。模块 ID、目标端、依赖、默认导航槽、后端权限标识和生命周期规则由代码发布，后台只能配置已经存在且当前构建可用的模块。数据库中的模块 ID 不能直接转换成组件路径或路由。

每个定义包含：

| 字段 | 含义 |
| --- | --- |
| id | 稳定大写下划线 ID，发布后不可改变 |
| surfaces | 支持 CUSTOMER_MINI、MERCHANT_MINI、MERCHANT_WEB 的哪些端 |
| required | 是否不可被品牌或门店关闭 |
| defaultEnabled | 编译安全默认值，发布配置缺失时使用 |
| dependsOn | 必需依赖模块 ID |
| conflictWith | 不允许同时启用的模块 |
| requiresConnection | 是否已具备构建内的真实 API 与页面能力 |
| navSlot | 固定导航或快捷入口槽位，不包含任意 URL |
| permission | 查看或写入所需服务端权限 |
| inFlightGuard | 停用前需要检查的进行中业务 |
| componentKey | 编译期常量，用于界面映射；不进入远端配置 |
| legacyAccess | 停用后仍允许的已有订单或账务操作 |

### 6.2 当前将接入的模块

| 端 | 可配置模块 | 说明 |
| --- | --- | --- |
| 用户小程序 | DINE_IN | 堂食与桌码下单；依赖 CATALOG 和当前桌台上下文 |
| 用户小程序 | PICKUP | 即时自取与预约自提入口；依赖 CATALOG |
| 用户小程序 | DELIVERY | 配送点单；该模块真实 API 和配送规则完成前保持 unavailable |
| 用户小程序 | MEMBER_CENTER | 会员、余额、积分和权益聚合入口；底层会员功能按实际完成状态开放 |
| 用户小程序 | COUPON、RESERVATION、QUEUE | 对应真实模块完成后才登记为可用，不显示空壳入口 |
| 商户小程序 | CASHIER | 门店收银 |
| 商户小程序 | CASH_SHIFT | 现金开班、交班和差额 |
| 商户小程序 | PICKUP_ADMIN | 自提核销与容量管理 |
| 商户小程序 | TABLE_BOARD | 桌台状态 |
| 商户小程序 | MEMBER_ADMIN、STAFF_ADMIN、ANALYTICS | 会员、员工和经营数据入口 |
| 三端管理 | CONTENT_EDITOR | 白名单页面内容编辑 |
| 电脑后台 | EXPERIENCE_STUDIO | 主题与模块配置本身，仅品牌所有者可用 |

基础身份、订单记录读取、既有订单履约、售后访问、账本事实和系统安全入口是必需能力，不通过业务开关移除。CATALOG 只要至少一个点餐渠道启用就由依赖闭包保持可用。

模块注册表只声明当前构建中真实存在的功能。尚未完成的优惠券、预约、排队或配送模块不得被后台误开启，也不得用静态空页面冒充完成。

### 6.3 求值算法

模块最终状态按以下规则计算：

~~~text
compiledDefault
→ brandSurfaceDefault
→ storeOverride, when editable
→ dependency closure
→ role and permission
→ store serviceModes and external integration readiness
~~~

- required 模块无论远端值为何都保持启用。
- 非必需模块可由品牌配置默认关闭；门店配置可在当前构建 available 时覆盖开启或关闭。
- 启用模块时自动检查 dependsOn；缺少依赖则发布或门店保存失败，并返回需要先启用的模块名称。
- 门店已有 serviceModes 继续是业务事实。即使品牌配置打开 DELIVERY，门店没有 DELIVERY 时用户端仍不可选。
- 权限只能收窄最终结果。CLERK 不能因品牌模块开启而获得 OWNER 的配置权限。
- 外部能力未配置时，对应模块标记 unavailable，并显示可行动的“尚未开通”状态；不显示假按钮。

### 6.4 导航与入口

微信原生 TabBar 只在静态 pages.json 中定义，不适合运行时增删。项目继续使用现有自定义底部导航，由已求值模块生成可见导航项。后台不能提交任意路由，只可调整注册表声明为可排序的导航槽顺序。

- 用户端核心导航保留首页、订单和我的；点餐入口仅在至少一个点餐渠道启用时出现。
- 商户端核心导航保留工作台、订单和门店；商品、收银、桌台等入口按权限与模块求值显示。
- 电脑后台侧栏根据模块与权限过滤，直接输入隐藏页面 URL 时仍由服务端拒绝新增操作。
- 当前页面或标签被停用时，切换到仍可用的首个导航项并提示“该服务已调整”。
- 已打开页面在拿到新配置后不崩溃；不可继续创建新订单或业务记录，但已有订单与账务仍可访问。

### 6.5 历史订单与进行中业务

停用不是删除。已创建订单、退款、班次、挂单、桌台会话和会员账本必须保留原入口中的可恢复路径。

- 关闭点餐渠道后，用户仍能查看本人历史订单；商户仍能查看和履约该渠道的进行中订单。
- 模块关闭后立即拒绝新的开班、挂单或开台操作，但已有操作进入 recoveryOnly 状态并在原导航位置保留恢复入口。
- CASH_SHIFT 存在未结班次时仍可发布关闭，但商户端显示仅用于关闭和核对的交班入口；最后一条班次结清后入口才完全消失。
- CASHIER 的待核对挂单或丢回执恢复项沿用现有持久恢复记录，不因模块关闭而清除；恢复完成后再次回到隐藏状态。
- TABLE_BOARD 的未结束桌台会话继续可完成结算；运营人员不能借停用模块抹掉在用桌台，也不能开启新的堂食桌台业务。
- 注册表为每个需要历史兼容的模块声明 legacyAccess。没有安全恢复路径的模块若被检测到未完成业务，才返回 MODULE_DRAIN_REQUIRED 并拒绝停用。
- 服务端区分“禁止创建新业务”和“读取/完成既有业务”，不能用一个全局开关把所有订单接口一并关闭。

## 7. 总体架构与数据流

~~~mermaid
flowchart LR
  Registry[编译期主题与模块注册表] --> Validator[配置校验与求值器]
  Admin[Experience Studio 草稿] --> API[NestJS Experience 模块]
  API --> DB[(PostgreSQL 发布版本与门店覆盖)]
  DB --> API
  Registry --> API
  API --> Public[public-config 求值结果]
  Public --> Customer[顾客小程序]
  Public --> MerchantMini[商户小程序]
  Public --> Web[商户电脑后台]
  Customer --> Guard[模块权限与依赖守卫]
  MerchantMini --> Guard
  Web --> Guard
  Guard --> Business[订单/商品/收银/会员业务服务]
~~~

服务端是业务开关的权威来源。前端过滤入口用于体验，后端守卫用于安全；两者共用同一注册表和求值函数。

### 7.1 共享包

新增 packages/experience，职责保持单一：

- module-registry：唯一模块定义。
- theme-presets：四套固定主题和完整令牌。
- config-schema：校验远端配置、主题覆盖和门店覆盖。
- resolver：品牌默认、端覆盖、门店覆盖和能力约束求值。
- style-runtime：把已求值主题转换成 CSS 变量和固定主题类名。
- experience-runtime：缓存最后可用配置、检测版本变化并提供 can(moduleId)。
- tests：纯函数与共享契约测试。

共享包使用当前工作区可从 uni-app 和 Vue Web 编译的模块格式。若编译链需要，增加声明文件，不复制第二份状态枚举。

### 7.2 API 模块

新增 apps/api/src/modules/experience，分为 controller、service、validation、repository 和 policy。控制器只解析输入和身份，发布事务、依赖闭包、版本冲突与审计由 service 管理。

## 8. 数据模型与版本生命周期

数据库新增四个模型。迁移只创建配置和审计结构，不改写订单、现金、地址或旧 Page 数据。

### 8.1 ExperienceDraft

- id：主键。
- brandId：唯一；每个品牌一份当前草稿。
- config：经过 schema 校验的 JSON。
- version：草稿修订号，每次成功保存加一。
- updatedById、updatedAt：最后编辑人和时间。

首次没有草稿时，后台从最新发布版本或编译安全默认构造编辑态；只有管理员点击保存才写入草稿。

### 8.2 ExperienceRelease

- id：主键。
- brandId、version：联合唯一，版本只递增。
- config：发布时草稿的不可变副本。
- schemaVersion：配置 schema 版本。
- checksum：规范化 JSON 的 SHA-256。
- publishedById、publishedAt：发布人和时间。

发布使用数据库事务，锁定当前草稿，校验 expectedDraftVersion，创建 release，写 ExperienceAudit。相同发布幂等键和相同请求体返回同一 release；同键异体返回冲突。

### 8.3 StoreModulePolicy

- storeId：主键。
- overrides：只保存被门店修改的模块状态。
- revision：并发保护版本。
- updatedById、updatedAt：最后编辑人和时间。

保存门店覆盖使用 expectedRevision 条件更新，写独立审计。品牌发布不能自动覆盖门店修订。

### 8.4 ExperienceAudit

记录品牌 ID、可选门店 ID、端、动作、actorId、before、after、releaseVersion 和 createdAt。动作至少包括 DRAFT_SAVE、PUBLISH、ROLLBACK、STORE_OVERRIDE_UPDATE，以及存在未完成业务且没有安全恢复路径时的停用拒绝。

### 8.5 配置示例

~~~json
{
  "schemaVersion": 1,
  "brand": {
    "logoUrl": null,
    "theme": {
      "presetId": "MODERN_TABLE",
      "overrides": {
        "primaryColor": null,
        "accentColor": null,
        "radiusScale": 1
      }
    },
    "motion": { "level": "CALM" }
  },
  "surfaces": {
    "CUSTOMER_MINI": {
      "theme": { "mode": "INHERIT" },
      "motion": { "mode": "INHERIT" },
      "modules": {
        "DINE_IN": { "defaultEnabled": true },
        "PICKUP": { "defaultEnabled": true },
        "DELIVERY": { "defaultEnabled": false },
        "MEMBER_CENTER": { "defaultEnabled": false }
      }
    },
    "MERCHANT_MINI": {
      "theme": { "mode": "INHERIT" },
      "motion": { "mode": "INHERIT" },
      "modules": {
        "CASHIER": { "defaultEnabled": true },
        "CASH_SHIFT": { "defaultEnabled": true },
        "PICKUP_ADMIN": { "defaultEnabled": true },
        "TABLE_BOARD": { "defaultEnabled": true },
        "MEMBER_ADMIN": { "defaultEnabled": true },
        "STAFF_ADMIN": { "defaultEnabled": true },
        "ANALYTICS": { "defaultEnabled": true }
      }
    },
    "MERCHANT_WEB": {
      "theme": {
        "mode": "PRESET",
        "presetId": "BLACK_LABEL"
      },
      "motion": { "mode": "PRESET", "level": "CALM" },
      "modules": {
        "CASHIER": { "defaultEnabled": true },
        "CASH_SHIFT": { "defaultEnabled": true },
        "TABLE_BOARD": { "defaultEnabled": true },
        "MEMBER_ADMIN": { "defaultEnabled": true },
        "STAFF_ADMIN": { "defaultEnabled": true },
        "ANALYTICS": { "defaultEnabled": true },
        "CONTENT_EDITOR": { "defaultEnabled": true }
      }
    }
  }
}
~~~

~~~json
{
  "schemaVersion": 1,
  "overrides": {
    "CUSTOMER_MINI": {
      "PICKUP": true,
      "DELIVERY": false
    },
    "MERCHANT_MINI": {
      "TABLE_BOARD": false
    }
  }
}
~~~

远端 JSON 中未知模块、未知预设、多余字段或不支持的目标端均视为校验错误。发布服务拒绝错误配置；公共客户端对存量坏数据采用最后可用配置，再退回编译默认。

### 8.6 回滚

历史 release 永不修改。回滚读取目标历史 release，写为新的草稿，然后按普通发布生成新版本。例如从版本 8 回滚到版本 5，会生成内容相同但版本号为 9 的新 release。这样审计顺序、客户端缓存和并发行为保持简单。

## 9. API 契约

### 9.1 公共配置

扩展现有 GET /api/v1/public-config，避免小程序启动时额外请求：

查询参数：

- surface：CUSTOMER_MINI、MERCHANT_MINI 或 MERCHANT_WEB。旧客户端未传时暂按 CUSTOMER_MINI 兼容，新版本三端全部显式传入。
- storeId：可选；提供时应用该门店模块覆盖和门店服务方式。

响应在现有品牌、环境、首页内容之外增加：

- experienceVersion：当前发布版本号；无发布时返回 0。
- resolvedAt：服务端求值时间。
- theme：已求值的固定预设 ID、令牌和有限覆盖，不返回原始草稿。
- motion：已求值档位。
- modules：以模块 ID 为键的 enabled、available、reason 和 navigation 槽位。
- navigation：由注册表和服务端能力生成的白名单导航项。
- degraded：是否存在无法使用的已声明能力；不会伪报成功。

公共配置不再依赖某个门店必须已有 Page 才能返回主题和模块。Page 缺失时 home 使用空业务内容，不影响品牌、门店和外观配置。

响应使用 Cache-Control: no-store，保证门店覆盖和主题发布在下一次同步生效。配置体积保持小于 20KB，不加入商品列表或个人数据。

### 9.2 管理接口

| 方法与路径 | 用途 | 权限与并发 |
| --- | --- | --- |
| GET /api/v1/merchant/experience | 读取草稿、发布版本、注册表和门店覆盖摘要 | 品牌 OWNER |
| PUT /api/v1/merchant/experience/draft | 保存整品牌草稿 | OWNER，expectedVersion，Idempotency-Key |
| POST /api/v1/merchant/experience/publish | 原子发布草稿 | OWNER，expectedDraftVersion，Idempotency-Key |
| GET /api/v1/merchant/experience/releases | 分页读取版本历史 | OWNER |
| GET /api/v1/merchant/experience/releases/:version | 查看历史快照与差异输入 | OWNER |
| POST /api/v1/merchant/experience/rollback | 把历史版本生成为新发布 | OWNER，expectedDraftVersion，Idempotency-Key |
| GET /api/v1/merchant/experience/preview | 按草稿和门店求值预览 | OWNER，不缓存 |
| PUT /api/v1/stores/:storeId/module-policy | 保存门店模块覆盖 | OWNER 且拥有该品牌门店，expectedRevision，Idempotency-Key |

品牌级接口不能只靠某个门店授权推断；AuthService 增加品牌 OWNER 校验。CLERK 可以读取自己的已求值配置，但不能写品牌草稿、发布、回滚或修改门店覆盖。

### 9.3 错误码

- EXPERIENCE_VERSION_CONFLICT：草稿版本已变化。
- STORE_MODULE_POLICY_CONFLICT：门店覆盖版本已变化。
- THEME_PRESET_UNKNOWN：预设不在当前构建。
- THEME_CONTRAST_FAILED：覆盖色导致不可读。
- THEME_OVERRIDE_INVALID：颜色、Logo 域名或圆角越界。
- MODULE_UNKNOWN：模块未注册。
- MODULE_UNAVAILABLE：当前构建或外部能力不支持。
- MODULE_DEPENDENCY_UNSATISFIED：依赖未启用。
- MODULE_DISABLED：新业务操作被模块开关拒绝。
- MODULE_DRAIN_REQUIRED：存在未完成业务且该模块没有声明安全 legacyAccess，不能停用；当前订单、收银、班次和桌台均声明恢复路径，因此不以此错误阻止普通开关。
- EXPERIENCE_CONFIG_INVALID：发布快照无法解析，服务端不继续写入。

错误响应沿用现有 { error, requestId } 结构。业务接口在 MODULE_DISABLED 时返回可读中文信息和当前配置版本，不暴露内部模块路径。

## 10. 后台 Experience Studio

电脑后台新增“外观与模块”。这是品牌所有者入口，不放进普通门店设置。

### 10.1 页面结构

1. 顶部显示当前草稿版本、已发布版本、最后编辑时间、预览和发布按钮。
2. 一级标签为品牌默认、顾客小程序、商户小程序、电脑后台。
3. 品牌默认标签编辑 Logo、默认主题、主色、强调色、圆角强度和默认动效。
4. 三个端标签以“继承品牌默认”起始，可选择独立预设、端级动效和模块默认状态。
5. 设备预览区提供 390px 小程序外观和桌面布局切换，使用真实组件与已求值数据，不使用截图假数据。
6. 模块列表按点餐、履约、收银、会员、内容和设置分组，展示必需、依赖、不可用、权限和进行中保护。
7. 底部发布摘要列出受影响的端、由关到开和由开到关的模块、需要处理的依赖和门店覆盖数量。

发布按钮只在当前草稿通过 schema、对比度和依赖校验后可用。保存草稿不改变公共配置；发布成功后返回新版本并刷新历史。

### 10.2 主题预览

四张预设卡并排展示真实颜色和代表性组件，而不是仅显示四个色点。选择后可调整品牌色、强调色和圆角；Logo 支持可信 HTTPS 地址输入和即时预览。后台明确显示以下检查：

- 主按钮文字与按钮背景对比度。
- 正文和辅助文字与表面颜色对比度。
- 焦点环和非文字控件边界对比度。
- 44px 触控区、14px 最小正文。
- 减少动效预览。

预览切换不发出业务写请求。切换到生产已发布内容时，使用只读求值接口；草稿预览必须携带管理身份，不允许公共客户端获取。

### 10.3 门店覆盖

门店覆盖页以门店为行、可覆盖模块为列，显示“默认开”“默认关”“门店覆盖开”“门店覆盖关”。发生覆盖的单元格高亮，并可清除覆盖恢复品牌默认。

保存前显示预计影响的进行中业务。依赖不满足或模块 unavailable 时拒绝保存并指出门店与模块；有安全 legacyAccess 的模块可关闭并进入 recoveryOnly，没有安全路径时才以 MODULE_DRAIN_REQUIRED 拒绝。门店覆盖保存后立即成为新的 revision，不进入品牌草稿。

### 10.4 交互与费用

主题卡选择、模块开关和预览切换使用 SPRING 档位下的短反馈，但后台数据表编辑仍保持克制。拖拽排序只在注册表声明可排序时启用，并使用固定槽位；不会生成任意路由。删除、发布和回滚不使用娱乐化动效。

## 11. 客户端运行机制

### 11.1 初始化与更新

1. 应用启动先加载编译安全主题，避免白屏和闪烁。
2. 调用 public-config 时携带当前 surface、storeId 和客户端构建版本。
3. 配置成功且版本变化后，一次性解析主题、动效、模块和导航，再更新根样式与可见入口。
4. 配置写入本地最后可用缓存，缓存键包含品牌 ID、surface 和 storeId。
5. 应用回到前台、切换门店、用户主动刷新或配置版本变化时重新同步；不要求用户重启小程序。
6. H5 与 Web 每个页面复用同一解析结果，禁止各组件自己读取原始远端 JSON。

网络失败时继续使用最后可用配置；首次安装且无缓存时使用编译默认。客户端顶部只显示简短“正在使用上次样式”而非打断点餐。配置请求失败不影响订单读取，但新增业务仍由业务 API 做真实校验。

### 11.2 主题应用

小程序在根 view 绑定经过白名单转换的 CSS 变量，并设置固定主题类名。Web 将变量写到应用根元素。预设专属的边框、阴影和装饰只能来自当前打包的 CSS，不接受远端规则。

主题同步过程中不重建购物车、表单、输入焦点或已加载订单。只有导航项变化时才调整选中标签；当前表单未提交时先保留原值并显示可用性提示。

### 11.3 模块变化

- 关闭模块后隐藏首页卡片、快捷入口、侧栏项和底部导航项。
- 若用户正停留在被关闭模块，显示状态说明和返回可用入口；不强制清空页面历史直到用户确认。
- 购物车保留，渠道关闭后结算按钮变为不可用并说明原因；重新启用后仍需重新报价。
- 进行中订单继续显示状态和履约操作，不受历史披露详情的模块开关影响。
- 后端仍会对每次新建和状态变更做模块、权限、门店、营业和状态机校验。

### 11.4 客户端版本兼容

响应包含最低客户端 schema 版本。客户端遇到更高 schema 版本时忽略未知字段并保留已知能力；遇到缺少必需模块定义时使用编译默认。服务端至少保留一个发布周期的向后兼容，避免已发布旧包瞬间失效。

## 12. 安全、隐私与可维护性

- 后台配置只能引用注册表 ID，不接受任意组件、脚本、CSS、路由或代码 URL。
- 公共配置只包含品牌级视觉、模块状态和公开导航，不包含员工、会员、订单或财务数据。
- 品牌管理接口强制品牌 OWNER；门店覆盖同时校验品牌归属和门店授权。
- 配置写入、发布、回滚和门店覆盖全部审计；敏感原始请求不写入日志。
- Logo URL 只允许 HTTPS 和部署配置声明的可信域名；客户端图片加载失败显示首字标。
- 对比度和尺寸校验在服务端发布时再次执行，前端预览不是唯一门禁。
- 所有 JSON 使用严格字段白名单和长度上限；配置规范化后再计算 checksum。
- Redis 不是配置事实来源。PostgreSQL 发布版本是权威数据，缓存失效只会让客户端稍后生效。
- 模块注册表变更遵循稳定 ID 规则。旧模块停用后至少保留历史订单和审计映射；不得复用旧 ID 表示新业务。

## 13. 测试与验收

### 13.1 共享包单元测试

- 四套预设的必需令牌完整，390px 与桌面预览均可计算。
- 主按钮、正文、辅助文字、焦点和非文字控件对比度达标。
- 品牌默认、端 INHERIT、端 PRESET、端 motion override 的合并顺序正确。
- 门店覆盖不能关闭 required 模块，不能启用 unavailable 或未知模块。
- 依赖闭包按固定顺序求值，循环依赖在注册表测试中失败。
- 导航只包含白名单槽位，禁用模块不会留下死链接。
- 减少动效将 SPRING 和 PLAYFUL 降为无位移反馈。
- 坏配置、未知字段和超长 URL 被拒绝；本地最后可用配置仍可读取。

### 13.2 API 与数据库集成测试

- 草稿保存不改变 public-config；发布后才返回新版本。
- 两管理员并发保存只有 expectedVersion 匹配者成功。
- 同幂等键同体只生成一个 release，异体返回冲突。
- 回滚生成新版本号且历史 release 字节级不变。
- 品牌默认主题被三端继承，端覆盖只影响对应端。
- 门店 A 的覆盖不影响门店 B，非品牌 OWNER 修改被拒绝。
- 模块依赖不满足时发布失败且事务不留下半成品。
- 关闭点餐模块后新建接口返回 MODULE_DISABLED，已有订单读取和履约仍成功。
- 有未结班次时关闭 CASH_SHIFT 后，新开班请求返回 MODULE_DISABLED，已有班次的查看、核账和关闭仍成功；结清后 recoveryOnly 入口消失。
- public-config 不泄露草稿、员工、会员和财务字段。
- 无 Page、无 release 的门店仍返回 compile safe default 和真实门店服务能力。

### 13.3 三端真实页面验收

- 顾客 H5 依次切换四套主题，在 390px 实际检查首页、菜单、规格面板、购物车、订单和个人中心。
- 商户 H5 检查工作台、订单、商品、收银、班次和门店，确认关闭模块后快捷入口与导航消失。
- 电脑后台检查主题预览、保存、发布、历史与回滚，刷新后发布版本持久存在。
- 同一品牌不同门店分别覆盖 PICKUP、TABLE_BOARD 等模块，切店后入口与业务 API 结果一致。
- 直接访问隐藏业务操作时服务端拒绝，已有订单详情仍能打开。
- 主题切换不丢购物车、表单输入和当前订单。
- 深浅背景、金额、状态、错误、禁用、焦点、空状态和加载状态在所有主题下可读。
- prefers-reduced-motion 和本地减少动效打开后无位移、弹跳和错峰动画。
- 小程序 H5 与 mp-weixin 构建通过；微信开发者工具和真机验证另列，不以浏览器结果替代。

### 13.4 验收证据

每个实现任务保留失败测试、通过测试、独立规格审查、独立质量审查、真实页面操作和只读 SQL 结果。新增迁移在应用源库前先完成新备份和隔离恢复验证。项目报告分别记录已编写、已运行、已测试通过、已微信真机验证和已生产验证，不能混用。

## 14. 实施顺序

1. 主题令牌、四套预设、共享注册表、校验器、求值器和单元测试。
2. Experience 数据模型、迁移、品牌 OWNER 权限、草稿、发布、回滚、门店覆盖和 API 集成测试。
3. 电脑后台 Experience Studio、实时预览、依赖提示、版本历史与真实数据库操作。
4. 顾客小程序根主题、动态导航、点餐渠道、个人中心模块与配置失败降级。
5. 商户小程序和电脑后台侧栏、快捷入口、收银相关 drain 保护及恢复入口。
6. 三端 H5 联动、双小程序构建、对比度/动效/断网/旧配置回归和书面验收。

现有 Page 继续负责首页文案和内容，新 Experience 只负责主题、动效和模块状态。迁移阶段若尚无正式 release，可只读兼容现有 Page 的 primaryColor；首次发布新版本后由 Experience 配置成为权威来源，不写回旧 Page。

## 15. 完成标准

本子系统未完成，除非：

- 四套主题在所有三端真实页面可切换并可读。
- 品牌默认与三端覆盖、门店模块覆盖均有持久化和权限保护。
- 所有开关由公共配置展示并由后端业务守卫执行。
- 草稿、发布、版本历史、回滚、并发冲突和审计闭环通过。
- 配置失败使用最后可用值或编译安全值，不阻断订单历史。
- 模块停用不丢失历史订单、账务和进行中业务。
- reduced-motion、44px 触控区和 14px 正文门禁通过。
- H5、Web、双小程序构建和本地业务验收有证据；微信真机与生产状态如实记录。

## 16. 开源与技术参考

本项目目前复用以下项目的设计逻辑，不直接复制业务代码：

- [Tencent tdesign-miniprogram](https://github.com/Tencent/tdesign-miniprogram)：组件、CSS 变量主题与微信小程序兼容边界，MIT。
- [Wot Design Uni](https://github.com/Moonofweisheng/wot-design-uni) 与 [NutUI UniApp](https://github.com/nutui-uniapp/nutui-uniapp)：uni-app/Vue3 多端组件和动态主题方案比较，MIT。
- [Vant Weapp](https://github.com/youzan/vant-weapp)：成熟微信小程序组件与交互模式参考，MIT。
- [Flagsmith](https://github.com/Flagsmith/flagsmith)：远端配置、分段、发布管理与客户端配置同步逻辑，BSD-3-Clause。
- [OpenFeature JS SDK](https://github.com/open-feature/js-sdk)：默认值、求值上下文和供应商中立接口，Apache-2.0。
- [Style Dictionary](https://github.com/style-dictionary/style-dictionary)：单一语义令牌来源与跨端输出，Apache-2.0。
- [Vue.Draggable.Next](https://github.com/SortableJS/vue.draggable.next)：后台可排序槽位的候选拖拽实现，MIT；只有后续页面装修任务确实需要时再引入并复核维护状态。
- [W3C WCAG 2.2 Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[W3C Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)、[MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) 与 [uni-app TabBar API](https://uniapp.dcloud.net.cn/api/ui/tabbar.html)：对比度、动效降级和动态导航边界。

候选库即使许可证允许，也不在本规格中授权整体替换现有 UI。任何实际依赖引入仍需版本兼容、包体、安全、构建和真机行为验证。

## 17. 已确认决策与剩余资源条件

已确认：

- 方案 B：语义主题套件加可信模块注册表。
- 同一品牌多门店。
- 品牌默认加三端覆盖。
- 品牌默认加门店模块覆盖。
- 预设主题加品牌色、Logo、圆角强度可改。
- 本地先完成功能。
- 前台需要有动效和交互，同时支持降级。
- 模块停用后小程序不展示入口，后端仍强制验证。

仍需真实环境资源才能完成的验证：

- 两个微信 AppID 对应的开发者工具与真机运行。
- 微信支付商户号、证书、回调域名和真实小额交易。
- 生产 HTTPS API、对象存储和合法请求域名。
- 真实打印机、语音设备和已签约配送供应商。

这些资源不阻塞本地主题、模块、配置、H5 验证和小程序构建，但不能据此宣称真实微信或生产验收完成。
