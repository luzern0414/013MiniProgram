# Catalog Task2 coordinator acceptance checklist

Executed against real pages/API/PostgreSQL after implementation, with independent review Approved. Full results: docs/acceptance/2026-10-20-catalog-settings.md.

Runtime: API3000/development migration006, Web5173, customerH5 5174, merchantH5 5175. Owned API session48186; exact listener command `node dist/src/main.js`. Existing browser default tabs0WebOWNER,1customer,2merchantOWNER,3oldWebemployee/login. Use `npx --yes @playwright/cli`; getByText exact for uni buttons, getByLabel native input only. API Web token in sessionStorage `merchant-token`; never print tokens/passwords.

Before: orders5/cash3 total8380; existing acceptance SKUprice3080/stock14/reserved0; publicorders4; CMS title一餐好饭，认真现做. Migrated units杯4references、份7references. Do not assume future unrelated changes are defects; capture current baseline before acceptance.

- [x] Web商品页进入分类与单位，创建验收分类/验收单位；通过真实商品表单新建验收新品，价格18.80，库存9，关联新分类/单位。使用明确“验收”前缀，不冒充实际经营数据。
- [x] 商户H5商品页刷新读取新商品、单位及分类；H5新建另一条可识别的验收商品或基础编辑其分类/单位，再Web重读；编辑器不能重建现有SKU。输入标签唯一、点击聚焦。
- [x] Web改单位名，商户H5刷新可见；停用单位后旧商品编辑其他字段能保留当前单位，新建商品不能选择该停用单位；恢复单位。
- [x] 商品可重新归类；只有确实无引用的空分类/单位能删除，引用删除409保留编辑内容和原因。刷新后验证已删除/仍保留。
- [x] 分类可见范围null/数组/[]可编辑，设置仅梧桐里后，顾客湖滨菜单确实无该分类；切回梧桐里可见。
- [x] 顾客通过真实点单面板生成包含该新品的报价；Web停用分类；顾客沿用旧报价下单被409拒绝，刷新后菜品消失。恢复分类后可重新报价，不必额外开一笔现金订单。
- [x] 第二Web会话同时编辑同一单位；第一保存后，第二保存冲突锁定，必须显式重新读取才能再编辑，不自动覆盖。
- [x] Web或H5模拟写入响应丢失（让真实API成功后中断返回），提示结果未知且不自动重发；刷新能核对实际写入，不出现假成功。
- [x] 网络不可用时加载/保存错误明确，恢复后能重读；提交中H5切店/导航/关闭锁定。
- [x] 真实CLERK会话读取共享配置只读，无假可用写入；服务器越权仍403。部分OWNER授权已由API隔离测试覆盖，不篡改开发库OWNER权限去制造该场景。
- [x] SQL检查Category.enabled/allStores/revision、visibility映射、Unit关系/版本/引用计数、审计。原有订单现金总额、原SKU库存和CMS保持；新验收商品及配置修改明确列出，不要求整库与旧备份完全一致。
- [x] 记录准确页面截图（PNG不以文本读取），运行相关测试/build证据及独立审查结论；更新docs/acceptance、README/config、REQ030/031四状态和progress。微信真机/生产始终false。

After completion: 下一模块是docs/superpowers/plans/2026-10-20-product-options.md，不重新派发已完成API。完整90需求/goal仍active；不以本模块结束整个项目。
