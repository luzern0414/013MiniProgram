# 第三方来源与许可证

日期：2026-10-20。实际依赖版本以 pnpm-lock.yaml 为准；项目许可证由所有者决定，本文件不替所有者授予整个新项目许可证。

## 已使用的开发及后端依赖

- NestJS：MIT；https://github.com/nestjs/nest
- Prisma：Apache-2.0；https://github.com/prisma/orm
- PostgreSQL 16：PostgreSQL License；https://www.postgresql.org/about/licence/
- 本地备份客户端：从PostgreSQL官网指向的EDB下载页获取16.15 Windows二进制，仅提取pg_dump/pg_restore及依赖DLL，未提交二进制；原始PostgreSQL及第三方客户端许可见docs/research/licenses/edb-*.txt，来源/校验记录见docs/research/2026-10-20-operations-research.md。当前完成下载与版本执行，不代表备份恢复已经验收。
- embedded-postgres：MIT 包装器，打包的原生依赖各自遵循其许可证；https://github.com/leinelissen/embedded-postgres
- node-postgres/pg：MIT；https://github.com/brianc/node-postgres
- TypeScript：Apache-2.0；https://github.com/microsoft/TypeScript
- tsx：MIT；https://github.com/privatenumber/tsx
- Vitest：MIT；https://github.com/vitest-dev/vitest
- RxJS：Apache-2.0；https://github.com/ReactiveX/rxjs
- reflect-metadata：Apache-2.0；https://github.com/rbuckton/reflect-metadata

未在此列出每个传递依赖；安装产物保留各包原始LICENSE，发布前应由实际生产依赖生成完整SBOM和许可清单。

## 业务源码研究与模式参考

- litemall（MIT）：数据库条件减库存与订单快照思路；研究提交 a1ef964a718b7277925b19ea26afe78ea3a1d325。
- yshop-drink（MIT）：餐饮多门店、SKU、优惠和收银业务组织参考；研究提交 42f416022f5d7b51b7a581976638b1895e20407d。
- bee-api（Apache-2.0）：支付验签/解密/通知幂等流程参考；研究提交 e75d2973eb2ad551c8e03bee101a8a9ef625de42。
- bee（MulanPSL-2.0）：微信点餐和桌码交互参考；研究提交 edb27edd56fbc5d1d2a31aa408b250ff5f38ab20。

当前新业务实现按本项目合约和测试独立编写，未整包复制上述项目的业务代码、图片、商标或示例商户数据。未来如复制具体片段必须记录路径、修改、原作者版权和许可证。参考项目的许可证原文保存在 docs/research/licenses，仅保留证据不表示全部已集成。

## 实际前端复用

商户电脑端已安装并构建Vue3.5.22（MIT）、Vite6.4.1（MIT）、@vitejs/plugin-vue5.2.4（MIT）、vue-tsc3.1.1（MIT）、lucide-vue-next0.468.0（ISC，图标源另遵循Lucide原始许可说明）。界面以Vue组件定制，未安装Element Plus。

双小程序已使用uni-app（Apache-2.0；https://github.com/dcloudio/uni-app），所有@dcloudio编译包统一为3.0.0-4060620250520001，Vue3.4.21/Vite5.2.8，vue-router固定4.5.1以匹配该Vue版本。两端H5及mp-weixin构建均实际通过。未安装Wot Design Uni。fuint/URY 的AGPL及无清晰许可的项目仅作产品流程研究，未复制代码。
