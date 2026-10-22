# 商品目录后续源码调研

日期2026-10-20。沿用已确认MIT许可的yshop-drink研究提交42f416022f5d7b51b7a581976638b1895e20407d，额外实际读取4份源码，均HTTP200；URL/时间/SHA256见data/research/catalog-sources.json。与原136条及运维6条分别记录，没有把同仓库文件数计作独立项目数。

| 读取文件与局部证据 | 本项目采用及边界 |
| --- | --- |
| AppStoreProductServiceImpl.java 117–145：先按shopId取启用分类、按sort排序，再查询isShow/cateId/shopId匹配商品 | 分类状态、排序和门店过滤应在服务端统一约束。另把相同规则用于quote/create，防止隐藏后沿用旧报价下单 |
| StoreProductAttrValueDO.java 39–64：productId、sku、stock、price、unique分别建模 | 规格组合有稳定标识、独立价格和库存。采用整数分及门店商品关系，不直接移植BigDecimal到double的转换 |
| StoreProductServiceImpl.java 231–240：按productId+sku复用既有规格值；456–498事务保存商品与规格 | 编辑保留现存SKU身份与库存预占，不能为改名称重建所有SKU。规格保存需事务、版本校验和审计，历史订单使用快照 |
| StoreProductRuleServiceImpl.java 32–59：规则模板的增改删和存在性检查 | 只作为模板领域拆分参考。这段代码不能证明已校验本项目的品牌授权、引用保护及并发冲突，必须另外实现测试 |

原文件中文注释经UTF8读取出现替换字符，本轮结论只依据可核查Java标识和控制流，不从损坏的注释推断业务。没有执行这些Java项目、导入其后台或声称完成完整安全审计；本轮采用领域组织与规则模式，未复制Java实现。

实施先完成分类/单位闭环，再扩展品牌商品模板、规格属性/加料及导入。品牌共享配置的变更要求拥有全部现有品牌门店的OWNER；单店授权不能通过分类变更影响未授权门店。删除检查引用，停用保留历史，现有现金订单履约/取消不因目录停用而失效。
