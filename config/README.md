# 运行配置

截至2026-10-20，本机 PostgreSQL16.14、API、商户 Web 和双小程序H5已联调，微信产物构建通过。当前没有生产域名、部署服务器、微信 AppID 或支付商户号。用户确认先完成本地功能。

## 环境与配置来源

`scripts/local.mjs` 优先读取根目录 `.env.local`，不存在时读取 `config/environments/development.env.example`，最后由进程环境变量覆盖。文件仅支持一行一个 `KEY=value`，不支持插值或 shell 命令。`.env.local` 和真实密钥均被 Git 忽略。

`pnpm local:*` 是本地辅助命令，拒绝生产环境。直接运行 `apps/api` 时必须由部署环境注入变量，不自动加载此目录模板。

| 当前实际使用的键 | 用途 |
| --- | --- |
| NODE_ENV | development/test/production；生产拒绝开发身份和体验种子开关 |
| DATABASE_URL | Prisma PostgreSQL连接，必须显式提供 |
| HOST / PORT | API监听地址和端口，本地127.0.0.1:3000 |
| DEV_AUTH_ENABLED | 非生产显式true才允许固定开发身份登录 |
| DEV_SEED_ENABLED | 非生产显式true才允许体验品牌种子 |
| PUBLIC_BRAND_ID | 对外公开的唯一品牌，开发为experience-brand；多品牌未指定时拒绝服务 |
| CORS_ORIGINS | 生产浏览器允许的来源，逗号分隔；本地允许联调 |

当前会话使用32字节随机令牌，数据库只存SHA256摘要，12小时过期；没有使用JWT签名密钥。微信配置仍未被当前适配器消费，填入密钥也不会启用支付。后续配置以对应模块实现、校验和实际联调为准，设计项详见批准的设计稿。

## 本地数据库

专用实例只监听127.0.0.1:55432，数据库restaurant_dev，数据位于 `data/postgres`，不提交Git。开发模板中的账号仅用于这个本机实例。数据库工具核对所有权标记、服务实际data_directory和PostgreSQL主版本，拒绝修改其他实例。

```powershell
pnpm install
pnpm db:start
pnpm db:verify
pnpm local:migrate
pnpm local:seed
pnpm local:api:start
```

最后一条使用已有构建；首次先运行 `pnpm --filter @restaurant/api build`。Windows上Prisma生成器会锁定运行中API使用的DLL，重新build前先停止本项目API。

当前交互开发使用 `development` schema；早期 `public` schema保留API验收记录，不作为新的界面体验数据。种子创建明确标识的体验品牌、两家体验门店和四个固定开发账户，重复执行不重置库存、订单或装修。生产不得运行种子。

`pnpm test:integration` 为每次验收创建随机 `test_acceptance_*` schema，执行迁移和种子，在独立API进程验证，结束后清理。它只连接经过所有权验证的本项目实例。后端包自己的集成测试另要求显式 `test_*` schema。

停止API用运行终端的Ctrl+C；停止专用数据库用 `pnpm db:stop`。不要删除data/postgres来解决启动问题。

## 本地备份与隔离恢复

```powershell
pnpm db:backup
pnpm db:restore -- <上一步输出的database.dump绝对路径>
```

命令只用于本机开发：读取根`.env.local`，不存在时使用`config/environments/development.env.example`，进程变量优先；配置格式同`local:*`。拒绝production，连接必须为127.0.0.1:55432、restaurant_dev用户和restaurant_dev数据库。`DATABASE_URL`的schema参数不限制备份范围：备份整个数据库，保留development、public及其他现存用户schema。每次核对工作区所有权标记、服务器实际data_directory、PG16和数据库所有者；命令不接受自定义主机、源库或目标库参数。

本机官方EDB PostgreSQL16.15客户端位于被忽略的`data/runtime/tools/postgresql-16.15/pgsql/bin`，需同时保留相邻DLL。服务器仍是16.14。下载来源、完整性和许可见[运维调研](../docs/research/2026-10-20-operations-research.md)与THIRD_PARTY_NOTICES；复制工作区到其他机器后需按记录重新准备工具，脚本不会联网下载或修改PATH。

备份采用custom archive和导出的repeatable-read快照。pg_dump与清单共用同一快照，可在本地API持续运行时导出。新建随机`data/backups/backup_<random>`目录，输出`database.dump`、`sha256`和最后原子发布的`manifest.json`。清单包含PG/工具版本、快照标识、各用户schema逐表行数、现金合计、库存、CMS/订单快照指纹及约束。MD5指纹只用于恢复一致性比较；归档SHA256用于损坏检测，均不是可信签名。归档包含实际业务和凭据数据，只能交给可信运维人员保管，不能上传Git或公共网盘。

Windows会将`data/backups`及每次运行目录的DACL保护为当前运行账户可访问，清除原有继承及其他主体授权，随后检查真实ACL、文件链接及父目录；同目录新文件仅继承该私人目录权限。受信任所有者为当前账户、SYSTEM或本机Administrators。该操作会收紧已有备份根目录权限，不适合多人共享目录。POSIX要求当前用户所有、目录0700和文件0600。数据库密码只通过短期受限PGPASSFILE交给客户端，不放入命令参数或输出；临时passfile成功/失败都会清理。没有对开发模板密码新增公开记录；如使用真实凭据，放入被忽略的`.env.local`并限制文件访问。

恢复先检查归档、私人权限、SHA256、工具主版本和目录清单，再创建全新`restore_<32位随机hex>`数据库。名字碰撞即失败，没有覆盖目标参数。使用`--exit-on-error --no-owner --no-acl --single-transaction`；新库对比全部清单后删除所有恢复会话。源库会话及业务数据保留。成功输出新库名并在备份目录记录验证结果，不切换DATABASE_URL，不启动API。备份时以当前账户接管恢复对象所有权，原角色/ACL不会重建。

恢复比较仍严格校验全部摘要及约束元数据。PG重解析有时会展平CHECK中的嵌套AND，比较器仅对列名/整数比较组成的AND接受结合括号差异，使用PostgreSQL ASCII空白规则；OR、NOT、值/列变化或不支持的不同语法均拒绝。不能删除约束比较或修改manifest促成通过；复现与独立审查见[修复报告](../docs/tasks/backup-constraint-restore-fix-report.md)。

失败时，仅在数据库OID、当前所有者和本次随机标记都一致时删除新建目标；无法确认则保留，记录`restore-<target>.failed.json`并提示人工核查。不要把保留库当作已验证结果，也不要删除所有restore_*库来清理。成功恢复库保留供人工检查，确认不再需要后由运维按具体名称核对所有权再删除。

运行`node --test tests/runtime/backup.test.mjs`可执行隔离PG16真实演练；测试仅创建/清理带本次标记的随机test_backup_*及restore_*数据库，含独立public/development业务数据。需要本项目数据库已启动，不要求Prisma generate或停止API。证据和限制见[备份报告](../docs/tasks/backup-report.md)。当前只验证Windows本地小库；备份未加密，长期快照/逐表计数不适合直接作为大库SLA。只恢复本项目自己生成且可信保管的归档，SHA256不能证明未知SQL归档安全。生产灾备、异地加密、对象存储、告警、RPO/RTO与微信/支付验收另行实施。

## 开发身份

customer、owner、clerk-a、clerk-b分别对应体验顾客、体验店主、两家门店各自店员。仅用于本地体验。员工操作仍由后端逐次验证门店授权。真实管理员使用下述离线初始化和员工账号登录，生产不启用开发登录。

## 首位管理员离线初始化

先由受信任的运维人员通过已有数据库管理流程准备品牌及门店，核实真实ID，再在应用主机本地运行命令。命令不依赖开发登录或体验种子，生产可用；不提供公开注册接口、默认密码或强制覆盖开关。只允许给尚不存在任何OWNER的品牌初始化一次，停用或无凭据的旧OWNER同样阻止重复初始化。授权门店必须显式列出，全部属于该品牌；未列出的门店没有权限。

密码必须为12至128字符的UTF-8文本，不含BOM、NUL或内部换行，可在末尾有一个LF或CRLF；空格会保留。文件最多1KiB，必须使用本地绝对真实路径，拒绝符号链接、目录联接、硬链接、设备/共享路径及临时公用目录。请放在工作区内已被Git忽略的`config/secrets/.owner-private`私人目录，禁止使用TEMP/TMP或/tmp。不得将密码放入命令行、环境变量、工单、公开文档或版本库。

Windows检查真实ACL，chmod 0600不足以通过。文件及其父目录必须关闭权限继承，所有者须为运行命令的账户、SYSTEM或本机Administrators；文件仅可允许这些主体访问，父目录不得允许其他主体写入、删除或修改权限。以下从工作区根目录运行PowerShell，新建私人目录后关闭继承（目录必须为新建，失败时先检查原因，不要改用公共目录）：

```powershell
$secretDir = Join-Path (Get-Location).Path 'config/secrets/.owner-private'
New-Item -ItemType Directory -Path $secretDir -ErrorAction Stop
$operator = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls.exe $secretDir /inheritance:r /grant:r "${operator}:(OI)(CI)F"
$secretFile = Join-Path $secretDir 'owner.pass'
# 用本机可信编辑器将密码保存到 $secretFile，使用UTF-8无BOM，保存后关闭编辑器。
icacls.exe $secretFile /inheritance:r /grant:r "${operator}:F"
# DATABASE_URL由安全部署配置注入，必须明确指向预期数据库和schema。
pnpm --filter @restaurant/api owner:bootstrap --brand-id <existing-id> --name <name> --account <account> --store-ids <store-id-a,store-id-b> --password-file $secretFile
Remove-Item -LiteralPath $secretFile
```

POSIX同样使用工作区内`config/secrets/.owner-private`，须使用当前账户所有、无组/其他用户权限的文件（0600），父目录由当前账户所有且无组/其他用户写权限（建议0700）。通过安全编辑器保存密码，执行同一初始化命令，再删除文件。该删除不是磁盘安全擦除；文件应位于启用磁盘加密的受管设备上。

命令严格拒绝未知、重复或缺失参数，以及空/重复门店。账号沿用员工规则：3至64位字母、数字或`._-`，保存为小写。品牌行锁、已有OWNER检查、门店校验、创建授权和`OWNER_BOOTSTRAP`审计在同一数据库事务内；并发最多一次成功。输出仅为成功或失败提示，不输出密码、摘要、令牌或数据库异常。失败时核对参数和ACL，在数据库核对品牌是否已有OWNER；不要通过删除旧管理员来绕过检查。

初始化后在商户端选择“员工账号”，使用该品牌公开配置、真实管理员账号及密码登录；OWNER和CLERK共用真实凭据与12小时会话规则。生产设置`DEV_AUTH_ENABLED=false`，无凭据的体验/旧OWNER不会被赋予默认密码。当前员工管理仅重设CLERK密码，OWNER密码恢复尚未提供，需另行设计受控恢复流程。初始密码由管理员本人设置；如代为初始化，须通过受控渠道交付。当前尚无OWNER自助改密页面。

隔离数据库测试命令（只允许`test_bootstrap_owner` schema，切勿指向development/public）：先为该schema执行现有迁移，再运行`pnpm --filter @restaurant/api test:bootstrap`。测试会清理该测试schema中的相关测试业务表。新建命令不需要Prisma生成或结构迁移；运行中API若需采用新的OWNER登录逻辑，须在批准的维护时机编译并重启，单独运行CLI不会更新已有API进程。

## 分类与单位维护

本地第6次迁移为`202610200006_catalog_settings`，已应用到development；不要重置现有数据。电脑端在“商品与库存→分类与单位”，商户H5/小程序在“商品→分类与单位”。品牌共享维护要求当前OWNER拥有全部现存门店授权，店员及部分门店OWNER只读。商品新增/基础编辑选择有效分类及单位，未改动的旧停用单位可保留；库存与价格仍由独立入口维护。

分类可见范围null代表全部当前/未来门店，空数组代表全部隐藏。停用或隐藏同时影响菜单、报价和旧报价创建；旧订单履约/取消保持可用。并发版本冲突或未知保存结果要求“重新加载并核对”，不要自动重复创建。真实页面和SQL证据见[目录验收](../docs/acceptance/2026-10-20-catalog-settings.md)。本模块没有新增环境变量或密钥。

## 商品规格、属性与加料

第7次迁移`202610200007_product_options`已在development增量执行，旧商品/SKU/加料/订单/会话数据核对保留；不运行reset或重新seed。配置API由本店有效OWNER操作，无须拥有品牌全部门店授权；既有身份通过停用保留，配置保存不覆盖原库存预占。加料库存使用可售量条件更新，价格或配置变化使旧报价返回`PRODUCT_OPTIONS_CHANGED`，仅库存维护不递增配置版本。配置未知保存结果需真实重读核对，禁止自动重复写入。

本模块没有新增环境变量或外部密钥。API与经营编辑器已独立审查，电脑“商品与库存”和商户“商品”的“规格与口味”已完成真实保存、跨端重读、并发冲突、丢回执、离线恢复和SQL核对。顾客及收银选择、旧报价拒绝、现金履约、原订单取消释放与三端历史快照也经真实页面/SQL验收；状态见[规格阶段记录](../docs/acceptance/2026-10-20-product-options.md)，本地验证不涵盖微信真机和生产。

## 预约自提

第8次增量迁移增加门店政策、明确日期时段、预约记录和按履约日期分配的取餐序列。默认预约关闭、提前15分钟、最远14天，门店时区固定Asia/Shanghai；没有新增密钥或环境变量。读取政策不自动开启预约或生成时段，已有即时自取及旧取餐号保持兼容。

API及三端UI已通过独立审查和本地页面/SQL验收，包含预约容量、现金确认、取餐核销、精确查号、冲突及未知结果恢复。009仅把付款期限数据库默认值明确为UTC；新订单使用同一UTC创建时刻加15分钟，历史生效期限取原期限与创建后15分钟较早值，每30秒扫描，保留原历史期限字段。迁移前新备份及43表392行原列hash一致已记录，旧超时预约实际自动关闭并释放一次；没有新增环境变量或密钥。完整证据与资源限制见[预约记录](../docs/acceptance/2026-10-20-pickup-capacity.md)。

uni H5开发中新增共享模块导出后，若浏览器报“does not provide an export named”，先核对实际HTTP源码与本地导出，停止本项目对应H5终端再重新启动，并在开发工具禁用缓存/强制刷新。当前保留mini-core的optimizeDeps.exclude；不要通过重置数据库或更新全部依赖处理浏览器旧模块缓存。生产构建和微信真机仍需分别验证。

## 微信及部署状态

员工账号由店主在电脑端“会员与员工→员工”或商户小程序“门店→门店员工”创建，密码12至128字符。账号、授权、停用及密码重设经API持久化；授权变化/停用/密码重设撤销该员工已有会话。登录品牌来自公开配置PUBLIC_BRAND_ID，不在客户端写死。密码不进入本地存储，配置文件中不保存员工密码。当前单进程登录限制为每IP+品牌+账号15分钟10次；多实例部署需共享限流存储。

三端本地入口分别为 `pnpm local:web`（5173）、`pnpm local:customer`（5174）、`pnpm local:merchant`（5175），均监听127.0.0.1。Web通过Vite代理调用API；小程序H5默认请求 `http://127.0.0.1:3000/api/v1`，可用各端 `.env.example` 中的 `VITE_API_BASE_URL` 修改。浏览器跨域已验证允许X-Request-Id。微信构建产物在各端 `dist/build/mp-weixin`，AppID配置在各自 `src/manifest.json`；尚未实际导入微信开发者工具。

尚未配置两个小程序AppID、合法请求域名、隐私声明、订阅模板和支付商户绑定。微信登录、微信支付、退款和配送当前返回明确不可用；H5/现金验证不能替代微信真机及真实支付验收。

本地备份和隔离恢复脚本已实现并完成隔离PG16演练；生产部署及灾备、支付回调和对象存储仍待实施；当前不提供虚构上线地址。业务菜单、价格、库存、授权和页面内容通过后端写数据库，不通过编辑config文件维护。


## 挂单后端本地进度

挂单已完成第11次增量迁移 `202610200011_cashier_drafts`及双商户本地验收，前后44张旧表437行原列含时间一致，新备份实际恢复通过。API使用当前员工/门店授权、创建幂等和版本条件更新，保存草稿不预占，转正式订单同事务唯一绑定。Web与商户H5跨端编辑/409/明确重载、转单/现金/履约及只读SQL已真实执行；手机刷新发现、原key/body恢复同ID、离线/真实401保持未知尝试与重登后明确核对、恢复显示及窄屏修复均已独立审查和实际复验。Web草稿恢复记录存当前标签sessionStorage，mini使用按身份隔离的uni storage，键为`cashier-draft:v1:<userId>`；未知结果不能清记录、换key或换账号绕过，应返回原身份/门店点击页面恢复。无需新增外部密钥，详见[挂单阶段记录](../docs/acceptance/2026-10-20-cashier-drafts.md)。

## 现金退款本地进度

第10次增量迁移202610200010_cash_refunds已应用到development，旧CashPayment累计退款默认为0，新增不可变CashRefund凭证，不重算或修改原实收/找零及菜品快照。当前本店OWNER可在两商户订单详情登记已交还现金，CLERK只读；不返库存，不释放已确认预约容量。两商户/顾客、收银凭证及真实SQL闭环已本地验收，010前新备份已真实恢复，全部旧列含时间值前后保留。Web原退款尝试保存在当前标签sessionStorage、mini保存在按身份隔离的uni storage；unknown不可清除或换key，按页面原请求恢复并真实重读。清除本地存储会失去本地恢复线索，损坏记录须店主核对；此能力不等同微信原路退款。详见[退款阶段记录](../docs/acceptance/2026-10-20-cash-refunds.md)。

## 现金班次实施进度

第12次增量迁移202610210012_cash_shifts已应用development，未改写旧凭证归属或原始时间；全新备份实际恢复和45表500行旧列前后保护已核对。每店最多一个活动班次，由有效OWNER明确开关，本店CLERK可读并收款；新现金收退款必须有活动班，原幂等凭证返回不要求当前开班。应有按期初加实际入账减退款，跨班退款归本次活动班，关班固定快照不能被后来退款改写。旧现金/退款shiftId为null，不按日期回填。没有新增环境变量或密钥；shared及双商户已独立复审，完成本地跨端收款、跨班退款、负应有差额关班、固定快照与SQL验收；mini真实提交后丢回执、刷新/离线/真实401保持及同身份原key/body恢复已核对。Web班次恢复存sessionStorage、mini存uni storage，键为cash-shift:v1:<userId>，未知操作不可清除或换key；其他渠道/应收尚未完成，见[交班阶段记录](../docs/acceptance/2026-10-21-cash-shifts.md)。
