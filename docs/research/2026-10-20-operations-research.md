# 本地账号与数据库运维补充调研

原业务调研136份来源记录保持不变；本次额外6份来源单独记录在 `data/research/operations-sources.json`，均实际HTTP200。页面原文缓存及官方工具压缩包位于被忽略的data目录。

## 官方备份与恢复依据

- [PostgreSQL16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)：并发使用数据库时也能形成一致备份；custom archive适用于pg_restore。备份不是直接复制正在写入的数据目录。
- [PostgreSQL16 pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)：`--exit-on-error`遇错误停止；`--no-owner --no-acl`避免恢复旧的所有权/权限，恢复到新数据库后仍需实际核查。`--single-transaction`可使恢复原子提交。
- [PostgreSQL密码文件](https://www.postgresql.org/docs/16/libpq-pgpass.html)：PGPASSFILE避免把密码放入命令行；Unix要求0600，Windows由调用方保证目录访问限制，不能以mode0600声称已经限制Windows ACL。
- [Windows官方下载入口](https://www.postgresql.org/download/windows/)明确将Windows安装包导向EDB；[EDB binaries](https://www.enterprisedb.com/download-postgresql-binaries)提供安装内容压缩包。

本机embedded-postgres16.14包仅包含initdb、pg_ctl、postgres，PATH也未发现pg_dump/pg_restore，因此不能直接承诺现有数据库包已有备份能力。本次从EDB页面16.15行的Windows x86-64链接 `https://sbp.enterprisedb.com/getfile.jsp?fileid=1260623` 跳转并下载官方压缩包，未从第三方镜像获取。

```text
https://get.enterprisedb.com/postgresql/postgresql-16.15-5-windows-x64-binaries.zip
bytes: 373254386
sha256: 43bb45f173a6f08cf1d29a97a6d8deb119e8e8093a24c00d2d1001a0ccaa8281
```

SHA256是本机下载后的完整性记录，不是发布者独立签名。压缩包仅提取pg_dump、pg_restore、客户端DLL及许可到 `data/runtime/tools/postgresql-16.15/pgsql`，实际运行两条 `--version` 均为16.15。没有运行安装器、启动第二个数据库或修改系统PATH。数据库服务仍为16.14；客户端同主版本16。

原始许可保存在 `docs/research/licenses/edb-server_license.txt` 与 `edb-commandlinetools_3rd_party_licenses.txt`，工具二进制不提交Git。工具下载和version验证不等于备份恢复验收；后续脚本及真实演练按local-operations计划实施。

## 员工身份实现依据

本地员工登录采用Node内置scrypt、随机salt、固定受控参数和timingSafeEqual，没有因示例实现引入额外认证框架。会话摘要存库，授权/停用每次在服务端读取，修改门店或密码时撤销旧会话。版本条件与关系更新、审计同一Serializable事务完成。实际隔离HTTP/DB证据和边界见staff-api-report，不以密码哈希单元测试代替权限与事务验收。

现有体验OWNER仍为明确开发身份；首位真实管理员已补齐离线受控初始化，禁止公开OWNER注册。OWNER凭据登录与初始化实际DB/HTTP测试已一并通过，另有协调器随机schema的真实CLI/SQL验收；实现报告见bootstrap-report，尚未部署生产。后续OWNER密码恢复仍待实施。
